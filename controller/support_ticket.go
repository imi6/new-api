package controller

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const supportTicketBodyLimit = 10 << 20

var supportTicketUploads = struct {
	sync.Mutex
	users map[int]struct{}
}{users: make(map[int]struct{})}

type supportTicketImage struct {
	name string
	data []byte
}

type supportTicketSubmission struct {
	category    string
	content     string
	requestID   string
	requestHash string
	images      []supportTicketImage
}

// beginSupportTicketUpload 在读取请求体之前限制全进程和单账号并发，且不为等待者缓存请求。
func beginSupportTicketUpload(c *gin.Context) (func(), error) {
	userID := c.GetInt("id")
	supportTicketUploads.Lock()
	_, exists := supportTicketUploads.users[userID]
	if exists || len(supportTicketUploads.users) >= 4 {
		supportTicketUploads.Unlock()
		return nil, common.NewMessage("Support ticket uploads are busy. Please try again later")
	}
	supportTicketUploads.users[userID] = struct{}{}
	supportTicketUploads.Unlock()

	return func() {
		supportTicketUploads.Lock()
		delete(supportTicketUploads.users, userID)
		supportTicketUploads.Unlock()
	}, nil
}

func supportTicketError(c *gin.Context, err error) {
	var message *common.Message
	if errors.As(err, &message) {
		common.ApiError(c, err)
		return
	}
	common.SysError(common.LogText("support ticket operation failed: %s", err.Error()))
	common.ApiErrorT(c, "Failed to process support ticket request")
}

func supportTicketID(c *gin.Context, field string) (int, bool) {
	id, err := strconv.Atoi(c.Param(field))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid support ticket request")
		return 0, false
	}
	return id, true
}

func ListSupportTickets(c *gin.Context) {
	listSupportTickets(c, false)
}

func AdminListSupportTickets(c *gin.Context) {
	listSupportTickets(c, true)
}

func listSupportTickets(c *gin.Context, admin bool) {
	if _, ok := requireBrowserSession(c); !ok {
		return
	}
	filter := model.SupportTicketFilter{Status: c.Query("status"), Category: c.Query("category")}
	if filter.Status != "" && !model.ValidSupportTicketStatus(filter.Status) {
		supportTicketError(c, model.ErrSupportStatus)
		return
	}
	if filter.Category != "" && !model.ValidSupportTicketCategory(filter.Category) {
		supportTicketError(c, model.ErrSupportCategory)
		return
	}
	if admin && c.Query("user_id") != "" {
		id, err := strconv.Atoi(c.Query("user_id"))
		if err != nil || id <= 0 {
			common.ApiErrorT(c, "Invalid support ticket request")
			return
		}
		filter.UserID = id
	}
	page := common.GetPageQuery(c)
	page.Page = min(max(page.Page, 1), 1_000_000)
	page.PageSize = min(max(page.PageSize, 1), 100)
	tickets, total, err := model.ListSupportTickets(c.GetInt("id"), admin, filter, page)
	if err != nil {
		supportTicketError(c, err)
		return
	}
	page.SetItems(tickets)
	page.SetTotal(int(total))
	common.ApiSuccess(c, page)
}

func GetSupportTicket(c *gin.Context) {
	getSupportTicket(c, false)
}

func AdminGetSupportTicket(c *gin.Context) {
	getSupportTicket(c, true)
}

func getSupportTicket(c *gin.Context, admin bool) {
	if _, ok := requireBrowserSession(c); !ok {
		return
	}
	id, ok := supportTicketID(c, "id")
	if !ok {
		return
	}
	detail, err := model.GetSupportTicketDetail(id, c.GetInt("id"), admin)
	if err != nil {
		supportTicketError(c, err)
		return
	}
	common.ApiSuccess(c, detail)
}

// readSupportTicketSubmission 先生成原始内容摘要，幂等命中后无需再次解码或保存截图。
func readSupportTicketSubmission(c *gin.Context, creating bool) (*supportTicketSubmission, error) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, supportTicketBodyLimit)
	if err := c.Request.ParseMultipartForm(supportTicketBodyLimit); err != nil {
		if os.IsTimeout(err) {
			return nil, common.NewMessage("Support ticket upload timed out. Please try again")
		}
		return nil, common.NewMessage("Invalid support ticket request")
	}
	form := c.Request.MultipartForm
	if form == nil || len(form.Value["content"]) != 1 || len(form.Value["request_id"]) != 1 {
		return nil, model.ErrSupportSubmission
	}
	for name, values := range form.Value {
		if name != "content" && name != "request_id" && !(creating && name == "category") || len(values) != 1 {
			return nil, common.NewMessage("Invalid support ticket request")
		}
	}
	submission := &supportTicketSubmission{requestID: form.Value["request_id"][0]}
	requestID, err := uuid.Parse(submission.requestID)
	if err != nil || requestID.String() != submission.requestID {
		return nil, model.ErrSupportSubmission
	}
	if creating {
		if len(form.Value["category"]) != 1 || !model.ValidSupportTicketCategory(form.Value["category"][0]) {
			return nil, model.ErrSupportCategory
		}
		submission.category = form.Value["category"][0]
	}
	submission.content, err = model.ValidateSupportTicketContent(form.Value["content"][0])
	if err != nil {
		return nil, err
	}
	for name := range form.File {
		if name != "images" {
			return nil, common.NewMessage("Invalid support ticket request")
		}
	}
	files := form.File["images"]
	if len(files) > model.SupportTicketMaxImages {
		return nil, model.ErrSupportImages
	}
	imageHashes := make([]string, 0, len(files))
	for _, header := range files {
		if header.Size <= 0 || header.Size > service.SupportTicketImageMaxBytes {
			return nil, service.ErrSupportImageSize
		}
		file, err := header.Open()
		if err != nil {
			return nil, err
		}
		data, readErr := io.ReadAll(io.LimitReader(file, service.SupportTicketImageMaxBytes+1))
		closeErr := file.Close()
		if readErr != nil || closeErr != nil {
			return nil, errors.Join(readErr, closeErr)
		}
		if len(data) == 0 || len(data) > service.SupportTicketImageMaxBytes {
			return nil, service.ErrSupportImageSize
		}
		digest := sha256.Sum256(data)
		imageHashes = append(imageHashes, hex.EncodeToString(digest[:]))
		submission.images = append(submission.images, supportTicketImage{name: header.Filename, data: data})
	}
	encoded, err := common.Marshal(struct {
		Category string   `json:"category"`
		Content  string   `json:"content"`
		Images   []string `json:"images"`
	}{Category: submission.category, Content: submission.content, Images: imageHashes})
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(encoded)
	submission.requestHash = hex.EncodeToString(digest[:])
	return submission, nil
}

func saveSupportTicketScreenshots(images []supportTicketImage) ([]model.SupportTicketAttachment, error) {
	attachments := make([]model.SupportTicketAttachment, 0, len(images))
	for _, image := range images {
		attachment, err := service.SaveSupportScreenshot(image.name, image.data)
		if err != nil {
			service.RemoveSupportScreenshots(attachments)
			return nil, err
		}
		attachments = append(attachments, attachment)
	}
	return attachments, nil
}

func cleanupSupportTicketForm(c *gin.Context) {
	if c.Request.MultipartForm != nil {
		_ = c.Request.MultipartForm.RemoveAll()
	}
}

func CreateSupportTicket(c *gin.Context) {
	if _, ok := requireBrowserSession(c); !ok {
		return
	}
	release, err := beginSupportTicketUpload(c)
	if err != nil {
		supportTicketError(c, err)
		return
	}
	defer release()
	defer cleanupSupportTicketForm(c)
	submission, err := readSupportTicketSubmission(c, true)
	if err != nil {
		supportTicketError(c, err)
		return
	}
	previous, err := model.FindSupportTicketSubmission(c.GetInt("id"), submission.requestID, submission.requestHash, 0, true)
	if err != nil {
		supportTicketError(c, err)
		return
	}
	if previous != nil {
		ticket, err := model.GetSupportTicket(previous.TicketID, c.GetInt("id"), false)
		if err != nil {
			supportTicketError(c, err)
			return
		}
		common.ApiSuccess(c, ticket)
		return
	}
	attachments, err := saveSupportTicketScreenshots(submission.images)
	if err != nil {
		supportTicketError(c, err)
		return
	}
	ticket, replayed, err := model.CreateSupportTicket(c.GetInt("id"), submission.category, submission.content, attachments, submission.requestID, submission.requestHash)
	if err != nil {
		service.RemoveUnreferencedSupportScreenshots(attachments)
	} else if replayed {
		service.RemoveSupportScreenshots(attachments)
	}
	if err != nil {
		supportTicketError(c, err)
		return
	}
	common.ApiSuccess(c, ticket)
}

func ReplySupportTicket(c *gin.Context) {
	replySupportTicket(c, false)
}

func AdminReplySupportTicket(c *gin.Context) {
	replySupportTicket(c, true)
}

func replySupportTicket(c *gin.Context, admin bool) {
	if _, ok := requireBrowserSession(c); !ok {
		return
	}
	id, ok := supportTicketID(c, "id")
	if !ok {
		return
	}
	ticket, err := model.GetSupportTicket(id, c.GetInt("id"), admin)
	if err != nil {
		supportTicketError(c, err)
		return
	}
	release, err := beginSupportTicketUpload(c)
	if err != nil {
		supportTicketError(c, err)
		return
	}
	defer release()
	defer cleanupSupportTicketForm(c)
	submission, err := readSupportTicketSubmission(c, false)
	if err != nil {
		supportTicketError(c, err)
		return
	}
	previous, err := model.FindSupportTicketSubmission(c.GetInt("id"), submission.requestID, submission.requestHash, id, false)
	if err != nil {
		supportTicketError(c, err)
		return
	}
	if previous != nil {
		common.ApiSuccess(c, previous)
		return
	}
	if ticket.Status == model.SupportTicketClosed {
		supportTicketError(c, model.ErrSupportTicketClosed)
		return
	}
	if ticket.MessageCount >= model.SupportTicketMaxMessages {
		supportTicketError(c, model.ErrSupportMessageLimit)
		return
	}
	attachments, err := saveSupportTicketScreenshots(submission.images)
	if err != nil {
		supportTicketError(c, err)
		return
	}
	message, replayed, err := model.ReplySupportTicket(id, c.GetInt("id"), admin, submission.content, attachments, submission.requestID, submission.requestHash)
	if err != nil {
		service.RemoveUnreferencedSupportScreenshots(attachments)
	} else if replayed {
		service.RemoveSupportScreenshots(attachments)
	}
	if err != nil {
		supportTicketError(c, err)
		return
	}
	common.ApiSuccess(c, message)
}

func CloseSupportTicket(c *gin.Context) {
	setSupportTicketStatus(c, false)
}

func AdminSetSupportTicketStatus(c *gin.Context) {
	setSupportTicketStatus(c, true)
}

func AdminBatchDeleteSupportTickets(c *gin.Context) {
	if _, ok := requireBrowserSession(c); !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
	var input struct {
		IDs []int `json:"ids"`
	}
	if err := common.DecodeJsonBody(c.Request.Body, &input); err != nil {
		common.ApiErrorT(c, "Invalid support ticket request")
		return
	}
	ids, attachments, err := model.DeleteSupportTickets(input.IDs, c.GetInt("id"))
	if err != nil {
		supportTicketError(c, err)
		return
	}
	cleanupPending := false
	if err := service.RemoveSupportScreenshots(attachments); err != nil {
		cleanupPending = true
		common.SysError(common.LogText("failed to remove deleted support ticket screenshots: %s", err.Error()))
	}
	common.ApiSuccess(c, gin.H{"deleted_ids": ids, "file_cleanup_pending": cleanupPending})
}

func setSupportTicketStatus(c *gin.Context, admin bool) {
	if _, ok := requireBrowserSession(c); !ok {
		return
	}
	id, ok := supportTicketID(c, "id")
	if !ok {
		return
	}
	status := model.SupportTicketClosed
	if admin {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
		var input struct {
			Status string `json:"status"`
		}
		if err := common.DecodeJson(c.Request.Body, &input); err != nil {
			common.ApiErrorT(c, "Invalid support ticket request")
			return
		}
		status = input.Status
	}
	ticket, err := model.SetSupportTicketStatus(id, c.GetInt("id"), admin, status)
	if err != nil {
		supportTicketError(c, err)
		return
	}
	common.ApiSuccess(c, ticket)
}

func DownloadSupportTicketAttachment(c *gin.Context) {
	downloadSupportTicketAttachment(c, false)
}

func AdminDownloadSupportTicketAttachment(c *gin.Context) {
	downloadSupportTicketAttachment(c, true)
}

func downloadSupportTicketAttachment(c *gin.Context, admin bool) {
	if _, ok := requireBrowserSession(c); !ok {
		return
	}
	id, ok := supportTicketID(c, "id")
	if !ok {
		return
	}
	attachmentID, ok := supportTicketID(c, "attachment_id")
	if !ok {
		return
	}
	attachment, err := model.GetSupportTicketAttachment(id, attachmentID, c.GetInt("id"), admin)
	if err != nil {
		supportTicketError(c, err)
		return
	}
	file, size, err := service.OpenSupportScreenshot(attachment.FileKey)
	if err != nil {
		common.ApiErrorT(c, "Screenshot is unavailable")
		return
	}
	defer file.Close()
	if attachment.Mime != "image/png" && attachment.Mime != "image/jpeg" {
		common.ApiErrorT(c, "Screenshot is unavailable")
		return
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cache-Control", "private, no-store")
	c.Header("Content-Security-Policy", "default-src 'none'; sandbox")
	c.Header("Content-Disposition", "inline; filename=\"screenshot."+strings.TrimPrefix(attachment.Mime, "image/")+"\"")
	c.DataFromReader(http.StatusOK, size, attachment.Mime, file, nil)
}
