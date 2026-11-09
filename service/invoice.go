package service

import (
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
)

// invoiceFileDir is where invoice files live. The Docker image works in /data,
// which docker-compose already maps, so the default needs no extra volume.
func invoiceFileDir() string {
	return common.GetEnvOrDefaultString("INVOICE_FILE_DIR", "/data/invoices")
}

// invoiceFileTypes maps each allowed extension to the only content type its
// bytes may have.
var invoiceFileTypes = map[string]string{
	".pdf": "application/pdf",
	".png": "image/png",
	".jpg": "image/jpeg",
}

// InitInvoiceStorage creates the invoice directory at startup.
func InitInvoiceStorage() error {
	return os.MkdirAll(invoiceFileDir(), 0o750)
}

// openInvoiceRoot confines every file operation to the invoice directory, so
// no stored key can reach a path outside it.
func openInvoiceRoot() (*os.Root, error) {
	if err := os.MkdirAll(invoiceFileDir(), 0o750); err != nil {
		return nil, err
	}
	return os.OpenRoot(invoiceFileDir())
}

// validInvoiceFileKey accepts only keys this package generates: 32 random
// alphanumerics plus an allowed extension.
func validInvoiceFileKey(key string) bool {
	ext := filepath.Ext(key)
	if _, ok := invoiceFileTypes[ext]; !ok {
		return false
	}
	name := strings.TrimSuffix(key, ext)
	if len(name) != 32 {
		return false
	}
	for _, r := range name {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9') {
			return false
		}
	}
	return true
}

// SaveInvoiceFile checks an uploaded file and stores it under a random name.
// The extension must be pdf, png, or jpg, and the bytes must match it. The
// original name is kept only for display.
func SaveInvoiceFile(originalName string, content []byte) (model.InvoiceFile, error) {
	ext := strings.ToLower(filepath.Ext(originalName))
	wantMime, ok := invoiceFileTypes[ext]
	if !ok {
		return model.InvoiceFile{}, common.NewMessage("Only PDF, PNG, and JPG files can be uploaded")
	}
	if len(content) == 0 {
		return model.InvoiceFile{}, common.NewMessage("The file is empty")
	}
	if http.DetectContentType(content) != wantMime {
		return model.InvoiceFile{}, common.NewMessage("The file content does not match its extension")
	}
	key, err := common.GenerateRandomCharsKey(32)
	if err != nil {
		return model.InvoiceFile{}, err
	}
	key += ext

	root, err := openInvoiceRoot()
	if err != nil {
		return model.InvoiceFile{}, err
	}
	defer root.Close()
	file, err := root.OpenFile(key, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o640)
	if err != nil {
		return model.InvoiceFile{}, err
	}
	if _, err := file.Write(content); err != nil {
		_ = file.Close()
		_ = root.Remove(key)
		return model.InvoiceFile{}, err
	}
	if err := file.Close(); err != nil {
		_ = root.Remove(key)
		return model.InvoiceFile{}, err
	}

	name := filepath.Base(strings.ReplaceAll(originalName, "\\", "/"))
	if len([]rune(name)) > 200 {
		name = "invoice" + ext
	}
	return model.InvoiceFile{Name: name, Key: key, Size: int64(len(content)), Mime: wantMime}, nil
}

// OpenInvoiceFile opens a stored invoice file for reading.
func OpenInvoiceFile(key string) (io.ReadCloser, int64, error) {
	if !validInvoiceFileKey(key) {
		return nil, 0, os.ErrNotExist
	}
	root, err := openInvoiceRoot()
	if err != nil {
		return nil, 0, err
	}
	defer root.Close()
	file, err := root.Open(key)
	if err != nil {
		return nil, 0, err
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, 0, err
	}
	return file, info.Size(), nil
}

// RemoveInvoiceFile deletes a stored file. Failures are only logged, because
// the database change that orphaned the file has already been committed.
func RemoveInvoiceFile(key string) {
	if key == "" || !validInvoiceFileKey(key) {
		return
	}
	if err := removeInvoiceFile(key); err != nil {
		common.SysError(common.LogText("failed to delete invoice file %s: %s", key, err.Error()))
	}
}

func removeInvoiceFile(key string) error {
	if !validInvoiceFileKey(key) {
		return errors.New("invalid invoice file key")
	}
	root, err := openInvoiceRoot()
	if err != nil {
		return err
	}
	defer root.Close()
	if err := root.Remove(key); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// CleanupDeletedInvoiceFile 只有文件已清除或原本不存在，才清除持久化重试信息。
func CleanupDeletedInvoiceFile(deletion *model.InvoiceDeletion) error {
	if deletion.FileKey == "" {
		return nil
	}
	if err := removeInvoiceFile(deletion.FileKey); err != nil {
		return err
	}
	return model.MarkInvoiceFileDeleted(deletion.InvoiceID, deletion.FileKey)
}

// CleanupDeletedInvoiceFiles 每批最多处理 100 条，返回下批游标，避免坏文件阻塞后续任务。
func CleanupDeletedInvoiceFiles(afterInvoiceID int) (int, error) {
	const batchSize = 100
	pending, err := model.ListPendingInvoiceFileDeletions(afterInvoiceID, batchSize)
	if err != nil {
		return afterInvoiceID, err
	}
	for i := range pending {
		if err := CleanupDeletedInvoiceFile(&pending[i]); err != nil {
			common.SysError(common.LogText("failed to clean up deleted invoice attachment invoice_id=%d: %s", pending[i].InvoiceID, err.Error()))
		}
	}
	if len(pending) < batchSize {
		return 0, nil
	}
	return pending[len(pending)-1].InvoiceID, nil
}

// StartInvoiceFileCleanup 启动时清理一次，此后每分钟重试；沿用附件主节点存储约定。
func StartInvoiceFileCleanup() {
	if !common.IsMasterNode {
		return
	}
	go func() {
		afterInvoiceID := 0
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			var err error
			afterInvoiceID, err = CleanupDeletedInvoiceFiles(afterInvoiceID)
			if err != nil {
				common.SysError(common.LogText("failed to list deleted invoice attachments: %s", err.Error()))
			}
			<-ticker.C
		}
	}()
}

func invoiceCenterLink() string {
	return strings.TrimRight(system_setting.ServerAddress, "/") + "/invoice"
}

func sendInvoiceEmail(lang string, invoice *model.Invoice, subjectKey string, content string) {
	if invoice.Email == "" {
		return
	}
	subject := i18n.Translate(lang, subjectKey, map[string]any{"SystemName": common.SystemName})
	link := html.EscapeString(invoiceCenterLink())
	body := fmt.Sprintf("<p>%s</p><p>%s</p>", content,
		i18n.Translate(lang, i18n.MsgEmailInvoiceLink, map[string]any{"Link": fmt.Sprintf(`<a href="%s">%s</a>`, link, link)}))
	if err := common.SendEmail(subject, invoice.Email, body); err != nil {
		common.SysError(common.LogText("failed to send invoice email for application %d: %s", invoice.Id, err.Error()))
	}
}

// NotifyInvoiceIssued mails the applicant that the invoice is ready. The file
// is not attached; the applicant downloads it after signing in. lang comes
// from model.GetUserLanguage, read by the caller before going async.
func NotifyInvoiceIssued(lang string, invoice *model.Invoice) {
	content := i18n.Translate(lang, i18n.MsgEmailInvoiceIssuedContent, map[string]any{"Id": invoice.Id, "Amount": invoice.InvoiceAmount})
	sendInvoiceEmail(lang, invoice, i18n.MsgEmailInvoiceIssuedSubject, content)
}

// NotifyInvoiceRejected mails the applicant the rejection reason. It mentions
// a tax refund only when one was made; with a zero tax rate nothing was paid.
func NotifyInvoiceRejected(lang string, invoice *model.Invoice, refunded bool) {
	key := i18n.MsgEmailInvoiceRejectedContent
	if refunded {
		key = i18n.MsgEmailInvoiceRejectedRefundContent
	}
	content := i18n.Translate(lang, key, map[string]any{"Id": invoice.Id, "Reason": html.EscapeString(invoice.RejectReason), "Tax": invoice.TaxAmount})
	sendInvoiceEmail(lang, invoice, i18n.MsgEmailInvoiceRejectedSubject, content)
}
