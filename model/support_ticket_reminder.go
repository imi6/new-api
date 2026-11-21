package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// SupportTicketReminderBaseline 固定首次部署时的历史边界，后续重启不覆盖。
type SupportTicketReminderBaseline struct {
	ID                int `gorm:"primaryKey;autoIncrement:false"`
	BoundaryMessageID int `gorm:"not null"`
}

// SupportTicketRead 按管理员独立保存已读进度，与工单处理状态分开。
type SupportTicketRead struct {
	AdminID           int `gorm:"primaryKey;autoIncrement:false"`
	TicketID          int `gorm:"primaryKey;autoIncrement:false;index"`
	LastReadMessageID int `gorm:"not null"`
}

// SupportTicketUserRead 保存本人作为提问者的已读进度，不影响管理员处理其他工单的进度。
type SupportTicketUserRead struct {
	UserID            int `gorm:"primaryKey;autoIncrement:false"`
	TicketID          int `gorm:"primaryKey;autoIncrement:false;index"`
	LastReadMessageID int `gorm:"not null"`
}

type SupportTicketReminderItem struct {
	TicketID    int    `json:"ticket_id"`
	UserID      int    `json:"user_id"`
	Category    string `json:"category"`
	Status      string `json:"status"`
	Kind        string `json:"kind"`
	MessageID   int    `json:"message_id"`
	CreatedAt   int64  `json:"created_at"`
	UnreadCount int64  `json:"unread_count"`
}

type SupportTicketReminderSummary struct {
	UnreadCount     int64                       `json:"unread_count"`
	LatestMessageID int                         `json:"latest_message_id"`
	Items           []SupportTicketReminderItem `json:"items"`
}

// InitializeSupportTicketReminders 与工单创建、回复共用写锁，避免首次部署时漏掉并发消息。
func InitializeSupportTicketReminders(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if err := lockSupportTicketStorage(tx); err != nil {
			return err
		}
		var baseline SupportTicketReminderBaseline
		err := tx.First(&baseline, 1).Error
		if err == nil {
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		baseline.ID = 1
		if err := tx.Model(&SupportTicketMessage{}).Select("COALESCE(MAX(id), 0)").Scan(&baseline.BoundaryMessageID).Error; err != nil {
			return err
		}
		return tx.Create(&baseline).Error
	})
}

// GetSupportTicketReminders 只读取来信元数据，不读取正文、附件或修改已读状态。
func GetSupportTicketReminders(adminID int) (*SupportTicketReminderSummary, error) {
	return getSupportTicketReminders(adminID, true)
}

func GetUserSupportTicketReminders(userID int) (*SupportTicketReminderSummary, error) {
	return getSupportTicketReminders(userID, false)
}

func getSupportTicketReminders(userID int, admin bool) (*SupportTicketReminderSummary, error) {
	var viewer User
	viewerQuery := DB.Select("id").Where("id = ? AND status = ?", userID, common.UserStatusEnabled)
	if admin {
		viewerQuery = viewerQuery.Where("role >= ?", common.RoleAdminUser)
	}
	if err := viewerQuery.First(&viewer).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, common.NewMessage("Unauthorized, insufficient privileges")
		}
		return nil, err
	}
	var baseline SupportTicketReminderBaseline
	if err := DB.First(&baseline, 1).Error; err != nil {
		return nil, err
	}
	result := &SupportTicketReminderSummary{Items: make([]SupportTicketReminderItem, 0, 5)}
	// 不根据已读游标过滤这个查询，使已读确认不会令新消息标识倒退。
	incoming := DB.Model(&SupportTicketMessage{}).
		Select("id", "ticket_id").
		Where("is_admin = ? AND author_id <> ? AND id > ?", !admin, userID, baseline.BoundaryMessageID).
		Where("ticket_id IN (?)", supportTicketScope(DB, userID, admin).Select("id"))
	if err := DB.Table("(?) AS incoming", incoming).Select("COALESCE(MAX(incoming.id), 0)").Scan(&result.LatestMessageID).Error; err != nil {
		return nil, err
	}
	// 本轮只汇总已经观察到的消息；期间新来的回复交由下一次查询提醒。
	incoming = incoming.Where("id <= ?", result.LatestMessageID)
	reads := DB.Model(&SupportTicketRead{}).Select("ticket_id", "last_read_message_id").Where("admin_id = ?", userID)
	if !admin {
		reads = DB.Model(&SupportTicketUserRead{}).Select("ticket_id", "last_read_message_id").Where("user_id = ?", userID)
	}
	unread := DB.Table("(?) AS incoming", incoming).
		Joins("LEFT JOIN (?) AS read_progress ON read_progress.ticket_id = incoming.ticket_id", reads).
		Where("incoming.id > COALESCE(read_progress.last_read_message_id, 0)").
		Select("incoming.ticket_id, MAX(incoming.id) AS message_id, COUNT(*) AS unread_count").
		Group("incoming.ticket_id")
	if err := DB.Table("(?) AS unread", unread).Count(&result.UnreadCount).Error; err != nil {
		return nil, err
	}
	tickets := DB.Model(&SupportTicket{}).Select("id", "user_id", "category", "status")
	messages := DB.Model(&SupportTicketMessage{}).Select("id", "ticket_id", "created_at", "request_kind")
	kindExpr := "CASE WHEN messages.request_kind = 'create' THEN 'new_ticket' ELSE 'reply' END AS kind"
	if !admin {
		kindExpr = "'support_reply' AS kind"
	}
	err := DB.Table("(?) AS unread", unread).
		Joins("JOIN (?) AS tickets ON tickets.id = unread.ticket_id", tickets).
		Joins("JOIN (?) AS messages ON messages.id = unread.message_id AND messages.ticket_id = unread.ticket_id", messages).
		Select("unread.ticket_id, tickets.user_id, tickets.category, tickets.status, unread.message_id, messages.created_at, unread.unread_count, " + kindExpr).
		Order("unread.message_id DESC").Limit(5).Scan(&result.Items).Error
	return result, err
}

// MarkSupportTicketRead 只推进实际展示过的消息，和删除、回复共用写锁防止并发误清。
func MarkSupportTicketRead(ticketID, adminID, messageID int) error {
	return markSupportTicketRead(ticketID, adminID, messageID, true)
}

func MarkUserSupportTicketRead(ticketID, userID, messageID int) error {
	return markSupportTicketRead(ticketID, userID, messageID, false)
}

func markSupportTicketRead(ticketID, userID, messageID int, admin bool) error {
	if ticketID <= 0 || userID <= 0 || messageID <= 0 {
		return common.NewMessage("Invalid support ticket request")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := lockSupportTicketStorage(tx); err != nil {
			return err
		}
		var viewer User
		if err := lockForUpdate(tx).Select("id", "role").Where("id = ? AND status = ?", userID, common.UserStatusEnabled).First(&viewer).Error; err != nil {
			return err
		}
		if admin && viewer.Role < common.RoleAdminUser {
			return common.NewMessage("Unauthorized, insufficient privileges")
		}
		var ticket SupportTicket
		if err := lockForUpdate(supportTicketScope(tx, userID, admin)).Select("id").Where("id = ?", ticketID).First(&ticket).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrSupportTicketNotFound
			}
			return err
		}
		var message SupportTicketMessage
		if err := tx.Select("id").Where("id = ? AND ticket_id = ?", messageID, ticketID).First(&message).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return common.NewMessage("Invalid support ticket request")
			}
			return err
		}
		var read any = &SupportTicketRead{AdminID: userID, TicketID: ticketID, LastReadMessageID: messageID}
		viewerColumn := "admin_id"
		if !admin {
			read = &SupportTicketUserRead{UserID: userID, TicketID: ticketID, LastReadMessageID: messageID}
			viewerColumn = "user_id"
		}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(read).Error; err != nil {
			return err
		}
		return tx.Model(read).
			Where(viewerColumn+" = ? AND ticket_id = ? AND last_read_message_id < ?", userID, ticketID, messageID).
			UpdateColumn("last_read_message_id", messageID).Error
	})
}
