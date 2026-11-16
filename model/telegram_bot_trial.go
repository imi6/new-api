package model

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/mail"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrTelegramTrialUnavailable        = common.NewMessage("Telegram trial is not enabled")
	ErrTelegramTrialAlreadyClaimed     = common.NewMessage("This account, Telegram account or email has already received a trial")
	ErrTelegramTrialEmailRequired      = common.NewMessage("Bind an email address before claiming a Telegram trial")
	ErrTelegramTrialBudgetExceeded     = common.NewMessage("The Telegram trial distribution budget has been reached")
	ErrTelegramTrialChanged            = common.NewMessage("Telegram trial settings changed. Please try again")
	ErrTelegramTrialMembershipRequired = common.NewMessage("Join the required Telegram group or channel before claiming a trial")
	ErrInvalidTelegramTrialConfig      = common.NewMessage("Invalid Telegram trial settings")
	telegramTrialUsername              = regexp.MustCompile(`^@[A-Za-z][A-Za-z0-9_]{4,31}$`)
)

// TelegramBotTrialConfig 独立保存试用设置；更改额度和开关不重置已发放总额。
type TelegramBotTrialConfig struct {
	ID                int    `json:"-" gorm:"primaryKey;autoIncrement:false"`
	Enabled           bool   `json:"enabled"`
	Quota             int    `json:"quota" gorm:"type:bigint"`
	DailyLimit        int    `json:"daily_limit" gorm:"type:bigint"`
	TotalLimit        int    `json:"total_limit" gorm:"type:bigint"`
	RequireMembership bool   `json:"require_membership"`
	ChatID            string `json:"chat_id" gorm:"type:varchar(64)"`
	JoinURL           string `json:"join_url" gorm:"type:varchar(255)"`
	Version           int64  `json:"version" gorm:"type:bigint"`
	TotalGranted      int64  `json:"total_granted" gorm:"type:bigint"`
	TodayGranted      int64  `json:"today_granted" gorm:"-:all"`
	UpdatedAt         int64  `json:"updated_at" gorm:"type:bigint"`
}

// TelegramBotTrialDay 按现有站点时区累计实际发放金额，不因调整设置或重新启用而清零。
type TelegramBotTrialDay struct {
	Date         string `gorm:"type:varchar(10);primaryKey"`
	QuotaGranted int64  `gorm:"type:bigint;not null"`
}

// TelegramBotTrialClaim 是永久防重复凭据，不建立随用户删除的级联关联。
type TelegramBotTrialClaim struct {
	ID            int64  `json:"id" gorm:"primaryKey"`
	UserID        int    `json:"user_id" gorm:"not null;uniqueIndex"`
	TelegramID    string `json:"-" gorm:"type:varchar(32);not null;uniqueIndex"`
	EmailHash     string `json:"-" gorm:"type:char(64);not null;uniqueIndex"`
	InboxID       int64  `json:"-" gorm:"type:bigint;not null;uniqueIndex"`
	BotID         int64  `json:"-" gorm:"type:bigint"`
	ConfigVersion int64  `json:"-" gorm:"type:bigint"`
	Quota         int    `json:"quota" gorm:"type:bigint;not null"`
	BusinessDate  string `json:"business_date" gorm:"type:varchar(10);index"`
	ClaimedAt     int64  `json:"claimed_at" gorm:"type:bigint"`
}

type TelegramTrialIdentity struct {
	UserID            int
	BotID             int64
	BotConfigVersion  int64
	TelegramID        string
	ConnectionVersion int64
}

// TelegramTrialMembershipProof 仅由服务端 Telegram 查询生成，不接受客户端提供。
type TelegramTrialMembershipProof struct {
	ConfigVersion int64
	CheckedAt     int64
	Confirmed     bool
}

func GetTelegramBotTrialConfig() (*TelegramBotTrialConfig, error) {
	config := TelegramBotTrialConfig{ID: 1}
	err := DB.First(&config, 1).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &config, nil
	}
	if err != nil {
		return nil, err
	}
	var day TelegramBotTrialDay
	err = DB.First(&day, "date = ?", CheckinBusinessDate(time.Now())).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	config.TodayGranted = day.QuotaGranted
	return &config, nil
}

func SaveTelegramBotTrialConfig(input TelegramBotTrialConfig) (*TelegramBotTrialConfig, error) {
	input.ChatID, input.JoinURL = strings.TrimSpace(input.ChatID), strings.TrimSpace(input.JoinURL)
	if input.Version < 0 || input.Quota < 0 || input.Quota > common.MaxWalletQuota ||
		input.DailyLimit < 0 || input.DailyLimit > common.MaxWalletQuota ||
		input.TotalLimit < 0 || input.TotalLimit > common.MaxWalletQuota || len(input.ChatID) > 64 || len(input.JoinURL) > 255 {
		return nil, ErrInvalidTelegramTrialConfig
	}
	if input.Enabled && (input.Quota <= 0 || input.DailyLimit < input.Quota || input.TotalLimit < input.Quota) {
		return nil, ErrInvalidTelegramTrialConfig
	}
	if input.RequireMembership {
		chatNumber, chatErr := strconv.ParseInt(input.ChatID, 10, 64)
		if !telegramTrialUsername.MatchString(input.ChatID) && (chatErr != nil || chatNumber >= 0 || strconv.FormatInt(chatNumber, 10) != input.ChatID) {
			return nil, ErrInvalidTelegramTrialConfig
		}
		joinURL, err := url.Parse(input.JoinURL)
		if err != nil || joinURL.Scheme != "https" || joinURL.Host != "t.me" || joinURL.User != nil ||
			joinURL.RawQuery != "" || joinURL.Fragment != "" || len(joinURL.Path) < 2 {
			return nil, ErrInvalidTelegramTrialConfig
		}
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		config, err := lockTelegramTrialConfig(tx)
		if err != nil {
			return err
		}
		if config.Version != input.Version {
			return ErrTelegramTrialChanged
		}
		if input.Enabled && int64(input.TotalLimit) < config.TotalGranted {
			return ErrInvalidTelegramTrialConfig
		}
		return tx.Model(config).Updates(map[string]any{
			"enabled": input.Enabled, "quota": input.Quota, "daily_limit": input.DailyLimit, "total_limit": input.TotalLimit,
			"require_membership": input.RequireMembership, "chat_id": input.ChatID, "join_url": input.JoinURL,
			"version": config.Version + 1, "updated_at": time.Now().Unix(),
		}).Error
	})
	if err != nil {
		return nil, err
	}
	return GetTelegramBotTrialConfig()
}

// lockTelegramTrialConfig 固定配置→用户→连接的锁序；首条写语句避免 SQLite 读事务升级冲突。
func lockTelegramTrialConfig(tx *gorm.DB) (*TelegramBotTrialConfig, error) {
	if err := tx.Model(&TelegramBotConfig{}).Where("id = ?", 1).UpdateColumn("version", gorm.Expr("version")).Error; err != nil {
		return nil, err
	}
	config := TelegramBotTrialConfig{ID: 1}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&config).Error; err != nil {
		return nil, err
	}
	if err := lockForUpdate(tx).First(&config, 1).Error; err != nil {
		return nil, err
	}
	return &config, nil
}

func GetTelegramTrialClaimForInbox(inboxID int64) (*TelegramBotTrialClaim, error) {
	var claim TelegramBotTrialClaim
	err := DB.First(&claim, "inbox_id = ?", inboxID).Error
	return &claim, err
}

func GetTelegramTrialClaimForUser(userID int) (*TelegramBotTrialClaim, error) {
	var claim TelegramBotTrialClaim
	err := DB.First(&claim, "user_id = ?", userID).Error
	return &claim, err
}

// GrantTelegramTrial 在同一事务内校验领取条件、永久防重、赠送入账和预算扣减。
// 同一收件重试只返回历史结果，不再次发放。
func GrantTelegramTrial(identity TelegramTrialIdentity, inboxID, configVersion int64, membership TelegramTrialMembershipProof) (*TelegramBotTrialClaim, bool, error) {
	if inboxID <= 0 || configVersion < 0 {
		return nil, false, ErrTelegramTrialUnavailable
	}
	var result *TelegramBotTrialClaim
	newlyGranted := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		config, err := lockTelegramTrialConfig(tx)
		if err != nil {
			return err
		}
		var previous TelegramBotTrialClaim
		err = tx.First(&previous, "inbox_id = ?", inboxID).Error
		if err == nil {
			if previous.UserID != identity.UserID || previous.TelegramID != identity.TelegramID {
				return ErrTelegramTrialAlreadyClaimed
			}
			result = &previous
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		bot, user, err := lockTelegramTrialAccount(tx, identity)
		if err != nil {
			return err
		}
		if config.Version != configVersion {
			return ErrTelegramTrialChanged
		}
		if err := validateTelegramTrialEligibility(tx, config, user, identity, membership); err != nil {
			return err
		}
		now := time.Now().Unix()
		quota := config.Quota
		if user.Quota < -common.MaxWalletQuota || user.Quota > common.MaxWalletQuota-quota || user.UnpaidQuotaBalance < 0 || user.UnpaidQuotaBalance > common.MaxWalletQuota-quota {
			return ErrWalletQuotaLimitExceeded
		}
		date := CheckinBusinessDate(time.Now())
		day := TelegramBotTrialDay{Date: date}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&day).Error; err != nil {
			return err
		}
		if err := lockForUpdate(tx).First(&day, "date = ?", date).Error; err != nil {
			return err
		}
		if day.QuotaGranted < 0 || config.TotalGranted < 0 || day.QuotaGranted > int64(config.DailyLimit-quota) || config.TotalGranted > int64(config.TotalLimit-quota) {
			return ErrTelegramTrialBudgetExceeded
		}
		claim := TelegramBotTrialClaim{
			UserID: identity.UserID, TelegramID: identity.TelegramID, EmailHash: TelegramTrialEmailHash(user.Email), InboxID: inboxID,
			BotID: bot.BotID, ConfigVersion: config.Version, Quota: quota, BusinessDate: date, ClaimedAt: now,
		}
		if err := tx.Create(&claim).Error; err != nil {
			return err
		}
		credit := tx.Model(&User{}).Where("id = ? AND status = ? AND quota <= ? AND unpaid_quota_balance >= 0 AND unpaid_quota_balance <= ?",
			user.Id, common.UserStatusEnabled, common.MaxWalletQuota-quota, common.MaxWalletQuota-quota).
			Updates(map[string]any{"quota": gorm.Expr("quota + ?", quota), "unpaid_quota_balance": gorm.Expr("unpaid_quota_balance + ?", quota)})
		if credit.Error != nil {
			return credit.Error
		}
		if credit.RowsAffected != 1 {
			return ErrWalletQuotaLimitExceeded
		}
		if err := tx.Model(config).Update("total_granted", config.TotalGranted+int64(quota)).Error; err != nil {
			return err
		}
		if err := tx.Model(&day).Update("quota_granted", day.QuotaGranted+int64(quota)).Error; err != nil {
			return err
		}
		if err := ResetTelegramLowBalanceAfterCreditTx(tx, user.Id); err != nil {
			return err
		}
		result, newlyGranted = &claim, true
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	if newlyGranted {
		syncCreditUserQuotaCache(identity.UserID, result.Quota, "telegram trial")
	}
	return result, newlyGranted, nil
}

func lockTelegramTrialAccount(tx *gorm.DB, identity TelegramTrialIdentity) (*TelegramBotConfig, *User, error) {
	if identity.UserID <= 0 || identity.BotID <= 0 || identity.BotConfigVersion <= 0 || identity.TelegramID == "" || identity.ConnectionVersion <= 0 {
		return nil, nil, ErrTelegramBotNotConnected
	}
	var bot TelegramBotConfig
	if err := lockForUpdate(tx).First(&bot, 1).Error; err != nil {
		return nil, nil, err
	}
	if !bot.Enabled || bot.BotID != identity.BotID {
		return nil, nil, ErrTelegramBotNotConnected
	}
	if bot.Version != identity.BotConfigVersion {
		return nil, nil, ErrTelegramBotChanged
	}
	var user User
	if err := lockForUpdate(tx).First(&user, identity.UserID).Error; err != nil {
		return nil, nil, err
	}
	var connection TelegramBotConnection
	if err := lockForUpdate(tx).First(&connection, "user_id = ?", identity.UserID).Error; err != nil {
		return nil, nil, err
	}
	if user.Status != common.UserStatusEnabled || user.TelegramId != identity.TelegramID || connection.Status != TelegramBotConnected ||
		connection.BotID != identity.BotID || connection.TelegramID != identity.TelegramID || connection.ChatID != identity.TelegramID || connection.Version != identity.ConnectionVersion {
		return nil, nil, ErrTelegramBotNotConnected
	}
	return &bot, &user, nil
}

func validateTelegramTrialEligibility(tx *gorm.DB, config *TelegramBotTrialConfig, user *User, identity TelegramTrialIdentity, membership TelegramTrialMembershipProof) error {
	if !config.Enabled || config.Quota <= 0 || config.Quota > common.MaxWalletQuota || config.DailyLimit < config.Quota || config.DailyLimit > common.MaxWalletQuota || config.TotalLimit < config.Quota || config.TotalLimit > common.MaxWalletQuota {
		return ErrTelegramTrialUnavailable
	}
	email := NormalizeEmail(user.Email)
	address, err := mail.ParseAddress(email)
	if err != nil || address.Address != email || email == "" {
		return ErrTelegramTrialEmailRequired
	}
	var count int64
	if err := tx.Model(&TelegramBotTrialClaim{}).Where("user_id = ? OR telegram_id = ? OR email_hash = ?", user.Id, identity.TelegramID, TelegramTrialEmailHash(email)).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return ErrTelegramTrialAlreadyClaimed
	}
	var day TelegramBotTrialDay
	err = tx.First(&day, "date = ?", CheckinBusinessDate(time.Now())).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if day.QuotaGranted < 0 || config.TotalGranted < 0 || day.QuotaGranted > int64(config.DailyLimit-config.Quota) || config.TotalGranted > int64(config.TotalLimit-config.Quota) {
		return ErrTelegramTrialBudgetExceeded
	}
	now := time.Now().Unix()
	if config.RequireMembership && (!membership.Confirmed || membership.ConfigVersion != config.Version || membership.CheckedAt > now || membership.CheckedAt < now-60) {
		return ErrTelegramTrialMembershipRequired
	}
	return nil
}

// TelegramTrialEmailHash 归一化邮箱后保存摘要，永久限制同一邮箱只能领取一次。
func TelegramTrialEmailHash(email string) string {
	digest := sha256.Sum256([]byte("telegram-trial-email:" + NormalizeEmail(email)))
	return hex.EncodeToString(digest[:])
}
