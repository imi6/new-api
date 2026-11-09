package model

import (
	"database/sql"
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// InvoiceDeletion 只保留防止重复开票、历史统计和支付回调需要的删除凭据。
// FileKey 是待清理附件的任务信息，成功删除文件后清空；不保存发票抬头或税号。
type InvoiceDeletion struct {
	InvoiceID   int    `gorm:"primaryKey;autoIncrement:false"`
	UserID      int    `gorm:"index"`
	OrderAmount string `gorm:"type:varchar(32)"`
	IssuedTime  int64
	DeletedBy   int
	DeletedAt   int64
	Reason      string `gorm:"type:varchar(1024)"`
	FileKey     string `json:"-" gorm:"type:varchar(64)"`
}

// InvoiceIDReservation 永久保留开票申请编号，不能随申请删除。
// MySQL 5.7 重启后会从存量最大编号恢复自增值，独立登记表防止旧编号复用。
type InvoiceIDReservation struct {
	ID int `gorm:"primaryKey;autoIncrement"`
}

// InitializeInvoiceIDReservations 在开放开票申请前保留存量和历史引用的编号。
// 升级时须停止旧实例写入；重复运行只推进编号，不改写任何业务记录。
func InitializeInvoiceIDReservations(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		statement := &gorm.Statement{DB: tx}
		if err := statement.Parse(&InvoiceIDReservation{}); err != nil {
			return err
		}
		quotedTable := statement.Quote(statement.Table)
		if tx.Dialector.Name() == "postgres" {
			if err := tx.Exec("LOCK TABLE " + quotedTable + " IN EXCLUSIVE MODE").Error; err != nil {
				return err
			}
		}
		var maximum int64
		for _, source := range []struct {
			model  any
			column string
		}{
			{&InvoiceIDReservation{}, "id"},
			{&Invoice{}, "id"},
			{&InvoiceItem{}, "invoice_id"},
			{&InvoiceOrderLock{}, "invoice_id"},
			{&InvoiceTaxPayment{}, "invoice_id"},
			{&InvoiceDeletion{}, "invoice_id"},
		} {
			var value sql.NullInt64
			if err := tx.Model(source.model).Select("MAX(?)", clause.Column{Name: source.column}).Scan(&value).Error; err != nil {
				return err
			}
			maximum = max(maximum, value.Int64)
		}
		if maximum == 0 {
			return nil
		}
		if maximum >= int64(^uint(0)>>1) {
			return errors.New("invoice identity range is exhausted")
		}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&InvoiceIDReservation{ID: int(maximum)}).Error; err != nil {
			return err
		}
		if tx.Dialector.Name() == "postgres" {
			return tx.Exec("SELECT setval(pg_get_serial_sequence(?, 'id'), GREATEST(?, nextval(pg_get_serial_sequence(?, 'id'))), true)", quotedTable, maximum, quotedTable).Error
		}
		return nil
	})
}

// DeleteIssuedInvoice 原子删除申请及明细，不释放订单、不退款、不删除支付凭据。
func DeleteIssuedInvoice(id int, adminID int, reason string) (*InvoiceDeletion, error) {
	if id <= 0 || adminID <= 0 {
		return nil, common.NewMessage("Invalid parameters")
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return nil, common.NewMessage("Enter the deletion reason")
	}
	if invoiceTextTooLong(reason, 500) {
		return nil, common.NewMessage("The deletion reason can have at most {{max}} characters", map[string]any{"max": 500})
	}
	deletion := &InvoiceDeletion{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		invoice := &Invoice{}
		if err := lockForUpdate(tx).Where("id = ?", id).First(invoice).Error; err != nil {
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			// 重复请求沿用首次删除凭据，不覆盖原操作者、原因或清理状态。
			if err := lockForUpdate(tx).Where("invoice_id = ?", id).First(deletion).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrInvoiceNotFound
				}
				return err
			}
			return nil
		}
		if invoice.Status != InvoiceStatusIssued {
			return common.NewMessage("Only issued invoice applications can be deleted")
		}
		*deletion = InvoiceDeletion{
			InvoiceID: invoice.Id, UserID: invoice.UserId, OrderAmount: invoice.OrderAmount,
			IssuedTime: invoice.IssuedTime, DeletedBy: adminID, DeletedAt: common.GetTimestamp(),
			Reason: reason, FileKey: invoice.FileKey,
		}
		if err := tx.Create(deletion).Error; err != nil {
			return err
		}
		if err := tx.Where("invoice_id = ?", id).Delete(&InvoiceItem{}).Error; err != nil {
			return err
		}
		removed := tx.Where("id = ? AND status = ?", id, InvoiceStatusIssued).Delete(&Invoice{})
		if removed.Error != nil {
			return removed.Error
		}
		if removed.RowsAffected != 1 {
			return ErrInvoiceAlreadyProcessed
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return deletion, nil
}

// ListPendingInvoiceFileDeletions 按编号分页返回待清理附件，避免失败任务阻塞后续任务。
func ListPendingInvoiceFileDeletions(afterInvoiceID int, limit int) ([]InvoiceDeletion, error) {
	var pending []InvoiceDeletion
	err := DB.Where("invoice_id > ? AND file_key <> ?", max(afterInvoiceID, 0), "").Order("invoice_id ASC").Limit(min(max(limit, 1), 500)).Find(&pending).Error
	return pending, err
}

// MarkInvoiceFileDeleted 只清除已确认删除的原文件键，重复调用无副作用。
func MarkInvoiceFileDeleted(invoiceID int, key string) error {
	return DB.Model(&InvoiceDeletion{}).Where("invoice_id = ? AND file_key = ?", invoiceID, key).Update("file_key", "").Error
}
