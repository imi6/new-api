package model

import (
	"crypto/sha256"
	"database/sql"
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
	ErrTelegramTrialUserIDRequired     = common.NewMessage("Your account does not meet the minimum user ID requirement for trial credit")
	ErrInvalidTelegramTrialConfig      = common.NewMessage("Invalid Telegram trial settings")
	telegramTrialUsername              = regexp.MustCompile(`^@[A-Za-z][A-Za-z0-9_]{4,31}$`)
)

// TelegramBotTrialConfig 独立保存试用设置；更改额度和开关不重置已发放总额。
type TelegramBotTrialConfig struct {
	ID                int    `json:"-" gorm:"primaryKey;autoIncrement:false"`
	Enabled           bool   `json:"enabled"`
	MinUserID         int    `json:"min_user_id" gorm:"type:bigint"`
	CurrentMaxUserID  int    `json:"current_max_user_id" gorm:"-:all"`
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

// TelegramTrialStatus 只公开当前账号的领取提示，不包含领取凭据或后台预算明细。
type TelegramTrialStatus struct {
	Enabled           bool   `json:"enabled"`
	MinUserID         int    `json:"min_user_id"`
	UserIDEligible    bool   `json:"user_id_eligible"`
	Quota             int    `json:"quota"`
	Claimed           bool   `json:"claimed"`
	EmailBound        bool   `json:"email_bound"`
	BotConnected      bool   `json:"bot_connected"`
	BudgetAvailable   bool   `json:"budget_available"`
	RequireMembership bool   `json:"require_membership"`
	JoinURL           string `json:"join_url"`
	BotURL            string `json:"bot_url"`
}

// GetTelegramTrialStatus 仅查询登录用户的领取条件，实际领取仍由机器人命令事务重新校验。
func GetTelegramTrialStatus(userID int) (*TelegramTrialStatus, error) {
	if userID <= 0 {
		return nil, common.NewMessage("Invalid parameters")
	}
	var user User
	if err := DB.Select("id", "status", "email", "telegram_id").First(&user, userID).Error; err != nil {
		return nil, err
	}
	var bot TelegramBotConfig
	if err := DB.Select("enabled", "bot_id", "bot_username", "version").First(&bot, 1).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	trial, err := GetTelegramBotTrialConfig()
	if err != nil {
		return nil, err
	}
	connection, err := GetTelegramBotConnection(userID)
	if err != nil {
		return nil, err
	}
	email := NormalizeEmail(user.Email)
	address, emailErr := mail.ParseAddress(email)
	emailBound := email != "" && emailErr == nil && address.Address == email
	claims := DB.Model(&TelegramBotTrialClaim{}).Where("user_id = ?", userID)
	if user.TelegramId != "" {
		claims = claims.Or("telegram_id = ?", user.TelegramId)
	}
	if emailBound {
		claims = claims.Or("email_hash = ?", TelegramTrialEmailHash(email))
	}
	var claimCount int64
	if err := claims.Count(&claimCount).Error; err != nil {
		return nil, err
	}

	validQuota := trial.Quota > 0 && trial.Quota <= common.MaxWalletQuota
	validBudget := validQuota && trial.DailyLimit >= trial.Quota && trial.DailyLimit <= common.MaxWalletQuota &&
		trial.TotalLimit >= trial.Quota && trial.TotalLimit <= common.MaxWalletQuota
	botAvailable := bot.Enabled && bot.BotID > 0 && bot.Version > 0 && telegramTrialUsername.MatchString("@"+bot.BotUsername)
	status := &TelegramTrialStatus{
		Enabled:   trial.Enabled && trial.MinUserID > 0 && validQuota && validBudget && botAvailable,
		MinUserID: trial.MinUserID, UserIDEligible: trial.MinUserID > 0 && user.Id >= trial.MinUserID,
		Claimed: claimCount > 0, EmailBound: emailBound,
		BotConnected: botAvailable && user.Status == common.UserStatusEnabled && user.TelegramId != "" &&
			connection.Status == TelegramBotConnected && connection.BotID == bot.BotID &&
			connection.TelegramID == user.TelegramId && connection.ChatID == user.TelegramId && connection.Version > 0,
		BudgetAvailable: validBudget && trial.TodayGranted >= 0 && trial.TotalGranted >= 0 &&
			trial.TodayGranted <= int64(trial.DailyLimit-trial.Quota) && trial.TotalGranted <= int64(trial.TotalLimit-trial.Quota),
		RequireMembership: trial.RequireMembership,
	}
	if validQuota {
		status.Quota = trial.Quota
	}
	if status.RequireMembership {
		status.JoinURL = trial.JoinURL
	}
	if botAvailable {
		status.BotURL = "https://t.me/" + bot.BotUsername
	}
	return status, nil
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
	if input.Version < 0 || input.MinUserID <= 0 || int64(input.MinUserID) > 1<<53-1 || input.Quota < 0 || input.Quota > common.MaxWalletQuota ||
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
			"enabled": input.Enabled, "min_user_id": input.MinUserID, "quota": input.Quota, "daily_limit": input.DailyLimit, "total_limit": input.TotalLimit,
			"require_membership": input.RequireMembership, "chat_id": input.ChatID, "join_url": input.JoinURL,
			"version": config.Version + 1, "updated_at": time.Now().Unix(),
		}).Error
	})
	if err != nil {
		return nil, err
	}
	return GetTelegramBotTrialConfig()
}

// GetTelegramTrialCurrentMaxUserID 同时考虑现存账号和永久编号，已注销账号不会让建议门槛回退。
func GetTelegramTrialCurrentMaxUserID() (int, error) {
	var usersMaximum, reservedMaximum sql.NullInt64
	if err := DB.Unscoped().Model(&User{}).Select("MAX(id)").Scan(&usersMaximum).Error; err != nil {
		return 0, err
	}
	if err := DB.Model(&UserIDReservation{}).Select("MAX(id)").Scan(&reservedMaximum).Error; err != nil {
		return 0, err
	}
	return int(max(usersMaximum.Int64, reservedMaximum.Int64)), nil
}

type TelegramTrialClaimFilter struct {
	Keyword   string
	StartTime int64
	EndTime   int64
}

// TelegramTrialClaimDetail 仅供管理员查看；用户名、邮箱及注册时间来自当前账号资料。
type TelegramTrialClaimDetail struct {
	ID            int64  `json:"id"`
	UserID        int    `json:"user_id"`
	Username      string `json:"username"`
	EmailMasked   string `json:"email_masked"`
	UserCreatedAt int64  `json:"user_created_at"`
	TelegramID    string `json:"telegram_id"`
	Quota         int    `json:"quota"`
	ClaimedAt     int64  `json:"claimed_at"`
	UserDeleted   bool   `json:"user_deleted"`
}

// ListTelegramTrialClaims 保留已注销账号的发放记录，分页后批量关联资料，避免逐行查询。
func ListTelegramTrialClaims(filter TelegramTrialClaimFilter, page *common.PageInfo) ([]TelegramTrialClaimDetail, int64, error) {
	filter.Keyword = strings.TrimSpace(filter.Keyword)
	if page == nil || page.Page < 1 || page.Page > 1_000_000 || page.PageSize < 1 || page.PageSize > 100 ||
		len(filter.Keyword) > 128 || strings.ContainsRune(filter.Keyword, '\x00') || filter.StartTime < 0 || filter.EndTime < 0 ||
		filter.EndTime > 0 && filter.StartTime > filter.EndTime {
		return nil, 0, common.NewMessage("Invalid parameters")
	}
	query := DB.Model(&TelegramBotTrialClaim{})
	if filter.Keyword != "" {
		pattern := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(filter.Keyword) + "%"
		userIDs := DB.Model(&User{}).Select("id").Where("username LIKE ? ESCAPE '!'", pattern)
		matches := DB.Where("telegram_id = ?", filter.Keyword).Or("user_id IN (?)", userIDs)
		if userID, err := strconv.Atoi(filter.Keyword); err == nil && userID > 0 {
			matches = matches.Or("user_id = ?", userID)
		}
		query = query.Where(matches)
	}
	if filter.StartTime > 0 {
		query = query.Where("claimed_at >= ?", filter.StartTime)
	}
	if filter.EndTime > 0 {
		query = query.Where("claimed_at <= ?", filter.EndTime)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	claims := make([]TelegramBotTrialClaim, 0, page.PageSize)
	if err := query.Select("id", "user_id", "telegram_id", "quota", "claimed_at").Order("claimed_at DESC").Order("id DESC").
		Offset(page.GetStartIdx()).Limit(page.PageSize).Find(&claims).Error; err != nil {
		return nil, 0, err
	}
	details := make([]TelegramTrialClaimDetail, 0, len(claims))
	if len(claims) == 0 {
		return details, total, nil
	}
	userIDs := make([]int, 0, len(claims))
	for i := range claims {
		userIDs = append(userIDs, claims[i].UserID)
	}
	var users []User
	if err := DB.Select("id", "username", "email", "created_at").Where("id IN ?", userIDs).Find(&users).Error; err != nil {
		return nil, 0, err
	}
	usersByID := make(map[int]User, len(users))
	for i := range users {
		usersByID[users[i].Id] = users[i]
	}
	for i := range claims {
		claim := &claims[i]
		user, found := usersByID[claim.UserID]
		detail := TelegramTrialClaimDetail{
			ID: claim.ID, UserID: claim.UserID, TelegramID: claim.TelegramID, Quota: claim.Quota,
			ClaimedAt: claim.ClaimedAt, UserDeleted: !found,
		}
		if found {
			detail.Username, detail.UserCreatedAt = user.Username, user.CreatedAt
			if user.Email != "" {
				detail.EmailMasked = common.MaskEmail(user.Email)
			}
		}
		details = append(details, detail)
	}
	return details, total, nil
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
	if !config.Enabled || config.MinUserID <= 0 || config.Quota <= 0 || config.Quota > common.MaxWalletQuota || config.DailyLimit < config.Quota || config.DailyLimit > common.MaxWalletQuota || config.TotalLimit < config.Quota || config.TotalLimit > common.MaxWalletQuota {
		return ErrTelegramTrialUnavailable
	}
	if user.Id < config.MinUserID {
		return ErrTelegramTrialUserIDRequired
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
