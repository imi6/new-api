package model

import (
	"math/rand"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"gorm.io/gorm"
)

// Checkin 签到记录
type Checkin struct {
	Id           int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId       int    `json:"user_id" gorm:"not null;uniqueIndex:idx_user_checkin_date"`
	CheckinDate  string `json:"checkin_date" gorm:"type:varchar(10);not null;uniqueIndex:idx_user_checkin_date"` // 格式: YYYY-MM-DD
	QuotaAwarded int    `json:"quota_awarded" gorm:"not null"`
	CreatedAt    int64  `json:"created_at" gorm:"bigint"`
}

// CheckinRecord 用于API返回的签到记录（不包含敏感字段）
type CheckinRecord struct {
	CheckinDate  string `json:"checkin_date"`
	QuotaAwarded int    `json:"quota_awarded"`
}

func (Checkin) TableName() string {
	return "checkins"
}

// GetUserCheckinRecords 获取用户在指定日期范围内的签到记录
func GetUserCheckinRecords(userId int, startDate, endDate string) ([]Checkin, error) {
	var records []Checkin
	err := DB.Where("user_id = ? AND checkin_date >= ? AND checkin_date <= ?",
		userId, startDate, endDate).
		Order("checkin_date DESC").
		Find(&records).Error
	return records, err
}

// CheckinBusinessDate 沿用站点现有时区，避免新增入口改变历史签到日期口径。
func CheckinBusinessDate(at time.Time) string {
	return at.In(time.Local).Format("2006-01-02")
}

// HasCheckedInToday 检查用户今天是否已签到。
func HasCheckedInToday(userId int) (bool, error) {
	today := CheckinBusinessDate(time.Now())
	var count int64
	err := DB.Model(&Checkin{}).
		Where("user_id = ? AND checkin_date = ?", userId, today).
		Count(&count).Error
	return count > 0, err
}

// UserCheckin 执行网站签到，与 Bot 共用每日记录和入账事务。
func UserCheckin(userId int) (*Checkin, error) {
	return UserCheckinForDate(userId, CheckinBusinessDate(time.Now()))
}

// UserCheckinForDate 为消息首次接收时确定的业务日期签到，不接受过期补签。
func UserCheckinForDate(userId int, date string) (*Checkin, error) {
	return userCheckinForDate(userId, date, nil)
}

// UserCheckinForTelegram 在发奖事务中复查连接，与断开操作按相同锁顺序串行。
func UserCheckinForTelegram(userID int, date string, botID int64, telegramID string, connectionVersion int64) (*Checkin, error) {
	return userCheckinForDate(userID, date, &TelegramBotConnection{
		UserID: userID, BotID: botID, TelegramID: telegramID, Version: connectionVersion,
	})
}

func userCheckinForDate(userId int, date string, bot *TelegramBotConnection) (*Checkin, error) {
	now := time.Now()
	if date != CheckinBusinessDate(now) {
		return nil, common.NewMessage("Check-in failed, please try again later")
	}
	settings := *operation_setting.GetCheckinSetting()
	if !settings.Enabled {
		return nil, common.NewMessage("Check-in feature is not enabled")
	}
	if userId <= 0 || settings.MinQuota < 0 || settings.MaxQuota < settings.MinQuota || settings.MaxQuota > common.MaxWalletQuota {
		return nil, common.NewMessage("Check-in failed, please try again later")
	}

	quotaAwarded := settings.MinQuota
	if settings.MaxQuota > settings.MinQuota {
		quotaAwarded += rand.Intn(settings.MaxQuota - settings.MinQuota + 1)
	}
	checkin := &Checkin{
		UserId:       userId,
		CheckinDate:  date,
		QuotaAwarded: quotaAwarded,
		CreatedAt:    now.Unix(),
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Where("id = ? AND status = ?", userId, common.UserStatusEnabled).First(&user).Error; err != nil {
			return common.NewMessage("Check-in failed, please try again later")
		}
		if date != CheckinBusinessDate(time.Now()) {
			return common.NewMessage("Check-in failed, please try again later")
		}
		if bot != nil {
			var cfg TelegramBotConfig
			if err := tx.First(&cfg, 1).Error; err != nil || !cfg.Enabled || cfg.BotID != bot.BotID || common.TurnstileCheckEnabled {
				return ErrTelegramBotNotConnected
			}
			var connection TelegramBotConnection
			if err := lockForUpdate(tx).First(&connection, "user_id = ?", userId).Error; err != nil {
				return ErrTelegramBotNotConnected
			}
			if connection.BotID != bot.BotID || connection.TelegramID != bot.TelegramID || user.TelegramId != bot.TelegramID || connection.Version != bot.Version || connection.Status != TelegramBotConnected {
				return ErrTelegramBotNotConnected
			}
		}
		var count int64
		if err := tx.Model(&Checkin{}).Where("user_id = ? AND checkin_date = ?", userId, date).Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return common.NewMessage("Already checked in today")
		}
		if user.Quota > common.MaxWalletQuota-quotaAwarded || user.UnpaidQuotaBalance < 0 || user.UnpaidQuotaBalance > common.MaxWalletQuota-quotaAwarded {
			return common.NewMessage("Check-in failed: quota update error")
		}
		if err := tx.Create(checkin).Error; err != nil {
			return common.NewMessage("Check-in failed, please try again later")
		}
		// 零奖励也可签到成功；MySQL 对不改变数值的 UPDATE 返回零个变更行。
		if quotaAwarded == 0 {
			return nil
		}
		// 唯一签到记录、钱包余额和赠送额度在三种数据库中一同提交。
		result := tx.Model(&User{}).
			Where("id = ? AND status = ? AND quota <= ? AND unpaid_quota_balance >= 0 AND unpaid_quota_balance <= ?",
				userId, common.UserStatusEnabled, common.MaxWalletQuota-quotaAwarded, common.MaxWalletQuota-quotaAwarded).
			Updates(map[string]any{
				"quota":                gorm.Expr("quota + ?", quotaAwarded),
				"unpaid_quota_balance": gorm.Expr("unpaid_quota_balance + ?", quotaAwarded),
			})
		if result.Error != nil || result.RowsAffected != 1 {
			return common.NewMessage("Check-in failed: quota update error")
		}
		return ResetTelegramLowBalanceAfterCreditTx(tx, userId)
	})
	if err != nil {
		return nil, err
	}
	// 缓存只在事务提交后更新，不能提前对外暴露未入账奖励。
	syncCreditUserQuotaCache(userId, quotaAwarded, "checkin")
	return checkin, nil
}

// AdminCheckinRecord 管理员查询用的签到记录（含用户名）
type AdminCheckinRecord struct {
	Id           int    `json:"id"`
	UserId       int    `json:"user_id"`
	Username     string `json:"username"`
	CheckinDate  string `json:"checkin_date"`
	QuotaAwarded int    `json:"quota_awarded"`
	CreatedAt    int64  `json:"created_at"`
}

// GetAdminCheckinRecords 管理员查询指定日期的全部签到记录（含用户名、分页）
func GetAdminCheckinRecords(date string, offset int, limit int) ([]AdminCheckinRecord, int64, error) {
	var records []AdminCheckinRecord
	var total int64

	query := DB.Table("checkins c").
		Select("c.id, c.user_id, u.username, c.checkin_date, c.quota_awarded, c.created_at").
		Joins("LEFT JOIN users u ON u.id = c.user_id").
		Where("c.checkin_date = ?", date)

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := query.Order("c.created_at DESC").Offset(offset).Limit(limit).Scan(&records).Error; err != nil {
		return nil, 0, err
	}
	return records, total, nil
}
func GetUserCheckinStats(userId int, month string) (map[string]any, error) {
	// 获取指定月份的所有签到记录
	startDate := month + "-01"
	endDate := month + "-31"

	records, err := GetUserCheckinRecords(userId, startDate, endDate)
	if err != nil {
		return nil, err
	}

	// 转换为不包含敏感字段的记录
	checkinRecords := make([]CheckinRecord, len(records))
	for i, r := range records {
		checkinRecords[i] = CheckinRecord{
			CheckinDate:  r.CheckinDate,
			QuotaAwarded: r.QuotaAwarded,
		}
	}

	// 检查今天是否已签到
	hasCheckedToday, err := HasCheckedInToday(userId)
	if err != nil {
		return nil, err
	}

	// 获取用户所有时间的签到统计
	var totalCheckins int64
	var totalQuota int64
	if err := DB.Model(&Checkin{}).Where("user_id = ?", userId).Count(&totalCheckins).Error; err != nil {
		return nil, err
	}
	if err := DB.Model(&Checkin{}).Where("user_id = ?", userId).Select("COALESCE(SUM(quota_awarded), 0)").Scan(&totalQuota).Error; err != nil {
		return nil, err
	}

	return map[string]any{
		"total_quota":      totalQuota,      // 所有时间累计获得的额度
		"total_checkins":   totalCheckins,   // 所有时间累计签到次数
		"checkin_count":    len(records),    // 本月签到次数
		"checked_in_today": hasCheckedToday, // 今天是否已签到
		"records":          checkinRecords,  // 本月签到记录详情（不含id和user_id）
	}, nil
}
