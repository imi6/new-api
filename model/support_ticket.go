package model

import (
	"encoding/hex"
	"errors"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	SupportTicketOpen        = "open"
	SupportTicketWaitingUser = "waiting_user"
	SupportTicketClosed      = "closed"
	SupportTicketMaxContent  = 5000
	SupportTicketMaxImages   = 3
	SupportTicketMaxMessages = 100
	SupportTicketMaxOpen     = 10
	SupportTicketMaxDaily    = 20
)

var (
	ErrSupportTicketNotFound     = common.NewMessage("Support ticket not found")
	ErrSupportTicketClosed       = common.NewMessage("This support ticket is closed")
	ErrSupportTicketLimit        = common.NewMessage("You can have at most 10 active support tickets")
	ErrSupportTicketDailyLimit   = common.NewMessage("You can submit at most 20 support tickets in 24 hours")
	ErrSupportMessageLimit       = common.NewMessage("This support ticket has reached the 100-message limit")
	ErrSupportContent            = common.NewMessage("Enter a description of 1 to 5000 characters")
	ErrSupportCategory           = common.NewMessage("Choose a valid support ticket category")
	ErrSupportImages             = common.NewMessage("Attach at most 3 screenshots per message")
	ErrSupportStatus             = common.NewMessage("Choose a valid support ticket status")
	ErrSupportSubmission         = common.NewMessage("Invalid support ticket submission")
	ErrSupportSubmissionConflict = common.NewMessage("This support ticket request ID has already been used for different content")
	ErrSupportTicketStorageLimit = common.NewMessage("This support ticket has reached its screenshot storage limit")
	ErrSupportUserStorageLimit   = common.NewMessage("Your support ticket screenshots have reached the account storage limit")
	ErrSupportTotalStorageLimit  = common.NewMessage("Support ticket screenshot storage is full")
)

// SupportTicketStorageLock 串行分配所有工单图片配额，避免不同进程同时检查后突破全站上限。
type SupportTicketStorageLock struct {
	ID      int   `gorm:"primaryKey;autoIncrement:false"`
	Version int64 `gorm:"type:bigint;not null"`
}

type SupportTicket struct {
	ID           int    `json:"id"`
	UserID       int    `json:"user_id" gorm:"index:idx_support_owner_status,priority:1;index:idx_support_owner_created,priority:1"`
	Category     string `json:"category" gorm:"type:varchar(16);index"`
	Status       string `json:"status" gorm:"type:varchar(16);index:idx_support_owner_status,priority:2"`
	CreatedAt    int64  `json:"created_at" gorm:"type:bigint;index:idx_support_owner_created,priority:2"`
	UpdatedAt    int64  `json:"updated_at" gorm:"type:bigint;index"`
	LastReplyAt  int64  `json:"last_reply_at" gorm:"type:bigint"`
	MessageCount int    `json:"message_count"`
	Version      int64  `json:"-" gorm:"type:bigint;not null"`
}

type SupportTicketMessage struct {
	ID          int                       `json:"id"`
	TicketID    int                       `json:"ticket_id" gorm:"index"`
	AuthorID    int                       `json:"author_id" gorm:"uniqueIndex:idx_support_author_request,priority:1"`
	IsAdmin     bool                      `json:"is_admin"`
	Content     string                    `json:"content" gorm:"type:text"`
	CreatedAt   int64                     `json:"created_at" gorm:"type:bigint"`
	RequestID   *string                   `json:"-" gorm:"type:varchar(36);uniqueIndex:idx_support_author_request,priority:2"`
	RequestHash string                    `json:"-" gorm:"type:varchar(64)"`
	RequestKind string                    `json:"-" gorm:"type:varchar(8)"`
	Attachments []SupportTicketAttachment `json:"attachments" gorm:"-"`
}

type SupportTicketAttachment struct {
	ID        int    `json:"id"`
	TicketID  int    `json:"-" gorm:"index"`
	MessageID int    `json:"-" gorm:"index"`
	FileKey   string `json:"-" gorm:"type:varchar(40);uniqueIndex"`
	Mime      string `json:"mime" gorm:"type:varchar(16)"`
	Size      int64  `json:"size" gorm:"type:bigint"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
}

type SupportTicketDetail struct {
	Ticket   *SupportTicket         `json:"ticket"`
	Messages []SupportTicketMessage `json:"messages"`
}

type SupportTicketFilter struct {
	Status   string
	Category string
	UserID   int
}

func ValidSupportTicketCategory(category string) bool {
	return slices.Contains([]string{"api_error", "topup", "refund", "account", "other"}, category)
}

func ValidSupportTicketStatus(status string) bool {
	return slices.Contains([]string{SupportTicketOpen, SupportTicketWaitingUser, SupportTicketClosed}, status)
}

func ValidateSupportTicketContent(content string) (string, error) {
	content = strings.TrimSpace(content)
	if !utf8.ValidString(content) || content == "" || utf8.RuneCountInString(content) > SupportTicketMaxContent || strings.ContainsRune(content, '\x00') {
		return "", ErrSupportContent
	}
	return content, nil
}

func supportTicketScope(db *gorm.DB, userID int, admin bool) *gorm.DB {
	query := db.Model(&SupportTicket{})
	if !admin {
		query = query.Where("user_id = ?", userID)
	}
	return query
}

func GetSupportTicket(ticketID, userID int, admin bool) (*SupportTicket, error) {
	ticket := &SupportTicket{}
	err := supportTicketScope(DB, userID, admin).Where("id = ?", ticketID).First(ticket).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrSupportTicketNotFound
	}
	return ticket, err
}

func ListSupportTickets(userID int, admin bool, filter SupportTicketFilter, page *common.PageInfo) ([]SupportTicket, int64, error) {
	query := supportTicketScope(DB, userID, admin)
	if filter.Status != "" {
		query = query.Where("status = ?", filter.Status)
	}
	if filter.Category != "" {
		query = query.Where("category = ?", filter.Category)
	}
	if admin && filter.UserID > 0 {
		query = query.Where("user_id = ?", filter.UserID)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	tickets := make([]SupportTicket, 0, page.PageSize)
	err := query.Order("updated_at DESC").Order("id DESC").Offset(page.GetStartIdx()).Limit(page.PageSize).Find(&tickets).Error
	return tickets, total, err
}

func GetSupportTicketDetail(ticketID, userID int, admin bool) (*SupportTicketDetail, error) {
	ticket, err := GetSupportTicket(ticketID, userID, admin)
	if err != nil {
		return nil, err
	}
	messages := make([]SupportTicketMessage, 0, ticket.MessageCount)
	if err := DB.Where("ticket_id = ?", ticketID).Order("id ASC").Limit(SupportTicketMaxMessages).Find(&messages).Error; err != nil {
		return nil, err
	}
	var attachments []SupportTicketAttachment
	if err := DB.Where("ticket_id = ?", ticketID).Order("id ASC").Find(&attachments).Error; err != nil {
		return nil, err
	}
	byMessage := make(map[int][]SupportTicketAttachment)
	for i := range attachments {
		attachment := attachments[i]
		byMessage[attachment.MessageID] = append(byMessage[attachment.MessageID], attachment)
	}
	for i := range messages {
		messages[i].Attachments = byMessage[messages[i].ID]
		if messages[i].Attachments == nil {
			messages[i].Attachments = []SupportTicketAttachment{}
		}
	}
	return &SupportTicketDetail{Ticket: ticket, Messages: messages}, nil
}

func GetSupportTicketAttachment(ticketID, attachmentID, userID int, admin bool) (*SupportTicketAttachment, error) {
	if _, err := GetSupportTicket(ticketID, userID, admin); err != nil {
		return nil, err
	}
	attachment := &SupportTicketAttachment{}
	err := DB.Where("id = ? AND ticket_id = ?", attachmentID, ticketID).First(attachment).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrSupportTicketNotFound
	}
	return attachment, err
}

func validateSupportTicketSubmission(requestID, requestHash string) error {
	id, err := uuid.Parse(requestID)
	if err != nil || id.String() != requestID || len(requestHash) != 64 || strings.ToLower(requestHash) != requestHash {
		return ErrSupportSubmission
	}
	if _, err := hex.DecodeString(requestHash); err != nil {
		return ErrSupportSubmission
	}
	return nil
}

// FindSupportTicketSubmission 只重放同一作者、操作、目标和原始内容的请求，并重新检查当前读取权限。
func FindSupportTicketSubmission(userID int, requestID, requestHash string, ticketID int, creating bool) (*SupportTicketMessage, error) {
	if err := validateSupportTicketSubmission(requestID, requestHash); err != nil {
		return nil, err
	}
	var user User
	if err := DB.Select("id", "role").Where("id = ? AND status = ?", userID, common.UserStatusEnabled).First(&user).Error; err != nil {
		return nil, err
	}
	message, err := findSupportTicketSubmission(DB, userID, requestID, requestHash, ticketID, creating)
	if err != nil || message == nil {
		return message, err
	}
	var ticket SupportTicket
	if err := supportTicketScope(DB, userID, !creating && user.Role >= common.RoleAdminUser).
		Where("id = ?", message.TicketID).First(&ticket).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSupportTicketNotFound
		}
		return nil, err
	}
	return message, nil
}

func findSupportTicketSubmission(tx *gorm.DB, userID int, requestID, requestHash string, ticketID int, creating bool) (*SupportTicketMessage, error) {
	message := &SupportTicketMessage{}
	if err := tx.Where("author_id = ? AND request_id = ?", userID, requestID).First(message).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	kind := "reply"
	if creating {
		kind = "create"
	}
	if message.RequestHash != requestHash || message.RequestKind != kind || (!creating && message.TicketID != ticketID) {
		return nil, ErrSupportSubmissionConflict
	}
	message.Attachments = make([]SupportTicketAttachment, 0)
	if err := tx.Where("message_id = ? AND ticket_id = ?", message.ID, message.TicketID).Order("id ASC").Find(&message.Attachments).Error; err != nil {
		return nil, err
	}
	return message, nil
}

func lockSupportTicketStorage(tx *gorm.DB) error {
	storageLock := SupportTicketStorageLock{ID: 1}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&storageLock).Error; err != nil {
		return err
	}
	return tx.Model(&SupportTicketStorageLock{}).Where("id = ?", 1).UpdateColumn("version", gorm.Expr("version + 1")).Error
}

// UnreferencedSupportScreenshots 等待持有全站锁的原事务结束，避免提交成功但响应丢失时误删附件。
func UnreferencedSupportScreenshots(attachments []SupportTicketAttachment) ([]SupportTicketAttachment, error) {
	if len(attachments) == 0 {
		return nil, nil
	}
	keys := make([]string, 0, len(attachments))
	for _, attachment := range attachments {
		keys = append(keys, attachment.FileKey)
	}
	var unreferenced []SupportTicketAttachment
	if err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockSupportTicketStorage(tx); err != nil {
			return err
		}
		var referenced []string
		if err := tx.Model(&SupportTicketAttachment{}).Where("file_key IN ?", keys).Pluck("file_key", &referenced).Error; err != nil {
			return err
		}
		used := make(map[string]struct{}, len(referenced))
		for _, key := range referenced {
			used[key] = struct{}{}
		}
		for _, attachment := range attachments {
			if _, exists := used[attachment.FileKey]; !exists {
				unreferenced = append(unreferenced, attachment)
			}
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return unreferenced, nil
}

func supportTicketStorageLimit(envName string, fallback, maximum int64) int64 {
	value, err := strconv.ParseInt(os.Getenv(envName), 10, 64)
	if err != nil || value <= 0 || value > maximum {
		return fallback
	}
	return value
}

// checkSupportTicketAttachmentQuota 在全站写锁内按已入库附件统计配额，客服回复计入工单所属用户。
func checkSupportTicketAttachmentQuota(tx *gorm.DB, ticketID, ownerID int, attachments []SupportTicketAttachment) error {
	if len(attachments) == 0 {
		return nil
	}
	var addedBytes int64
	for _, attachment := range attachments {
		if attachment.Size <= 0 || attachment.Size > 3<<20 {
			return ErrSupportSubmission
		}
		addedBytes += attachment.Size
	}
	type storageUsage struct {
		Bytes int64
		Files int64
	}
	var ticketUsage, userUsage, totalUsage storageUsage
	if ticketID > 0 {
		if err := tx.Model(&SupportTicketAttachment{}).Select("COALESCE(SUM(size), 0) AS bytes, COUNT(*) AS files").
			Where("ticket_id = ?", ticketID).Scan(&ticketUsage).Error; err != nil {
			return err
		}
	}
	if ticketUsage.Bytes > supportTicketStorageLimit("SUPPORT_TICKET_MAX_TICKET_BYTES", 30<<20, 1<<50)-addedBytes {
		return ErrSupportTicketStorageLimit
	}
	ownerTickets := tx.Model(&SupportTicket{}).Select("id").Where("user_id = ?", ownerID)
	allAttachments := tx.Model(&SupportTicketAttachment{}).Select("ticket_id", "size")
	if err := tx.Table("(?) AS storage_files", allAttachments).
		Joins("JOIN (?) AS owner_tickets ON owner_tickets.id = storage_files.ticket_id", ownerTickets).
		Select("COALESCE(SUM(storage_files.size), 0) AS bytes, COUNT(*) AS files").Scan(&userUsage).Error; err != nil {
		return err
	}
	addedFiles := int64(len(attachments))
	if userUsage.Bytes > supportTicketStorageLimit("SUPPORT_TICKET_MAX_USER_BYTES", 200<<20, 1<<50)-addedBytes ||
		userUsage.Files > supportTicketStorageLimit("SUPPORT_TICKET_MAX_USER_FILES", 1000, 1_000_000_000)-addedFiles {
		return ErrSupportUserStorageLimit
	}
	if err := tx.Model(&SupportTicketAttachment{}).Select("COALESCE(SUM(size), 0) AS bytes, COUNT(*) AS files").Scan(&totalUsage).Error; err != nil {
		return err
	}
	if totalUsage.Bytes > supportTicketStorageLimit("SUPPORT_TICKET_MAX_TOTAL_BYTES", 5<<30, 1<<50)-addedBytes ||
		totalUsage.Files > supportTicketStorageLimit("SUPPORT_TICKET_MAX_TOTAL_FILES", 50000, 1_000_000_000)-addedFiles {
		return ErrSupportTotalStorageLimit
	}
	return nil
}

// CreateSupportTicket 先取得全站配额锁和用户锁，再检查幂等、创建次数及图片累计配额。
func CreateSupportTicket(userID int, category, content string, attachments []SupportTicketAttachment, requestID, requestHash string) (*SupportTicket, bool, error) {
	if err := validateSupportTicketSubmission(requestID, requestHash); err != nil {
		return nil, false, err
	}
	if !ValidSupportTicketCategory(category) {
		return nil, false, ErrSupportCategory
	}
	content, err := ValidateSupportTicketContent(content)
	if err != nil {
		return nil, false, err
	}
	if len(attachments) > SupportTicketMaxImages {
		return nil, false, ErrSupportImages
	}
	ticket := &SupportTicket{}
	replayed := false
	err = DB.Transaction(func(tx *gorm.DB) error {
		if err := lockSupportTicketStorage(tx); err != nil {
			return err
		}
		var user User
		if err := lockForUpdate(tx).Select("id").Where("id = ? AND status = ?", userID, common.UserStatusEnabled).First(&user).Error; err != nil {
			return err
		}
		previous, err := findSupportTicketSubmission(tx, userID, requestID, requestHash, 0, true)
		if err != nil {
			return err
		}
		if previous != nil {
			if err := supportTicketScope(tx, userID, false).Where("id = ?", previous.TicketID).First(ticket).Error; err != nil {
				return err
			}
			replayed = true
			return nil
		}
		var count int64
		if err := tx.Model(&SupportTicket{}).Where("user_id = ? AND status <> ?", userID, SupportTicketClosed).Count(&count).Error; err != nil {
			return err
		}
		if count >= SupportTicketMaxOpen {
			return ErrSupportTicketLimit
		}
		now := time.Now().Unix()
		if err := tx.Model(&SupportTicket{}).Where("user_id = ? AND created_at >= ?", userID, now-24*60*60).Count(&count).Error; err != nil {
			return err
		}
		if count >= SupportTicketMaxDaily {
			return ErrSupportTicketDailyLimit
		}
		if err := checkSupportTicketAttachmentQuota(tx, 0, userID, attachments); err != nil {
			return err
		}
		*ticket = SupportTicket{UserID: userID, Category: category, Status: SupportTicketOpen, CreatedAt: now, UpdatedAt: now, MessageCount: 1, Version: 1}
		if err := tx.Create(ticket).Error; err != nil {
			return err
		}
		message := &SupportTicketMessage{TicketID: ticket.ID, AuthorID: userID, Content: content, CreatedAt: now,
			RequestID: &requestID, RequestHash: requestHash, RequestKind: "create"}
		return createSupportTicketMessage(tx, message, attachments)
	})
	return ticket, replayed, err
}

func createSupportTicketMessage(tx *gorm.DB, message *SupportTicketMessage, attachments []SupportTicketAttachment) error {
	if err := tx.Create(message).Error; err != nil {
		return err
	}
	message.Attachments = make([]SupportTicketAttachment, 0, len(attachments))
	for i := range attachments {
		attachment := attachments[i]
		attachment.ID = 0
		attachment.TicketID = message.TicketID
		attachment.MessageID = message.ID
		if err := tx.Create(&attachment).Error; err != nil {
			return err
		}
		message.Attachments = append(message.Attachments, attachment)
	}
	return nil
}

// ReplySupportTicket 按全站、作者、工单的顺序取得锁，原样重试可重放已关闭工单中的回复。
func ReplySupportTicket(ticketID, userID int, admin bool, content string, attachments []SupportTicketAttachment, requestID, requestHash string) (*SupportTicketMessage, bool, error) {
	if err := validateSupportTicketSubmission(requestID, requestHash); err != nil {
		return nil, false, err
	}
	content, err := ValidateSupportTicketContent(content)
	if err != nil {
		return nil, false, err
	}
	if len(attachments) > SupportTicketMaxImages {
		return nil, false, ErrSupportImages
	}
	message := &SupportTicketMessage{}
	replayed := false
	err = DB.Transaction(func(tx *gorm.DB) error {
		if err := lockSupportTicketStorage(tx); err != nil {
			return err
		}
		var user User
		if err := lockForUpdate(tx).Select("id", "role").Where("id = ? AND status = ?", userID, common.UserStatusEnabled).First(&user).Error; err != nil {
			return err
		}
		if admin && user.Role < common.RoleAdminUser {
			return common.NewMessage("Unauthorized, insufficient privileges")
		}
		var ticket SupportTicket
		if err := lockForUpdate(supportTicketScope(tx, userID, admin)).Where("id = ?", ticketID).First(&ticket).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrSupportTicketNotFound
			}
			return err
		}
		previous, err := findSupportTicketSubmission(tx, userID, requestID, requestHash, ticketID, false)
		if err != nil {
			return err
		}
		if previous != nil {
			message = previous
			replayed = true
			return nil
		}
		if ticket.Status == SupportTicketClosed {
			return ErrSupportTicketClosed
		}
		if ticket.MessageCount >= SupportTicketMaxMessages {
			return ErrSupportMessageLimit
		}
		if err := checkSupportTicketAttachmentQuota(tx, ticket.ID, ticket.UserID, attachments); err != nil {
			return err
		}
		now := time.Now().Unix()
		*message = SupportTicketMessage{TicketID: ticketID, AuthorID: userID, IsAdmin: admin, Content: content, CreatedAt: now,
			RequestID: &requestID, RequestHash: requestHash, RequestKind: "reply"}
		if err := createSupportTicketMessage(tx, message, attachments); err != nil {
			return err
		}
		status := SupportTicketOpen
		if admin {
			status = SupportTicketWaitingUser
		}
		return tx.Model(&SupportTicket{}).Where("id = ?", ticketID).Updates(map[string]any{
			"status": status, "updated_at": now, "last_reply_at": now, "message_count": gorm.Expr("message_count + 1"), "version": gorm.Expr("version + 1"),
		}).Error
	})
	return message, replayed, err
}

func SetSupportTicketStatus(ticketID, userID int, admin bool, status string) (*SupportTicket, error) {
	if !ValidSupportTicketStatus(status) || (!admin && status != SupportTicketClosed) {
		return nil, ErrSupportStatus
	}
	ticket := &SupportTicket{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		result := supportTicketScope(tx, userID, admin).Where("id = ?", ticketID).Updates(map[string]any{
			"status": status, "updated_at": time.Now().Unix(), "version": gorm.Expr("version + 1"),
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrSupportTicketNotFound
		}
		return tx.First(ticket, ticketID).Error
	})
	return ticket, err
}
