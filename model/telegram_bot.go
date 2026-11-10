package model

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	TelegramBotUnconnected  = "unconnected"
	TelegramBotConnecting   = "connecting"
	TelegramBotConnected    = "connected"
	TelegramBotDisconnected = "disconnected"
	TelegramBotBlocked      = "blocked"
)

var (
	ErrTelegramBotExpired      = common.NewMessage("Telegram bot authorization expired. Please try again.")
	ErrTelegramBotChanged      = common.NewMessage("Telegram bot settings changed. Please reload and try again.")
	ErrTelegramBotUnavailable  = common.NewMessage("Telegram bot is not configured")
	ErrTelegramBotNotConnected = common.NewMessage("Telegram bot is not connected")
)

// TelegramBotConfig 只在服务端读取凭据，不向管理接口序列化令牌和回调密钥。
type TelegramBotConfig struct {
	ID            int    `json:"-" gorm:"primaryKey;autoIncrement:false"`
	Enabled       bool   `json:"enabled"`
	BotID         int64  `json:"-" gorm:"type:bigint"`
	BotUsername   string `json:"bot_username" gorm:"type:varchar(64)"`
	Token         string `json:"-" gorm:"type:text"`
	WebhookSecret string `json:"-" gorm:"type:varchar(128)"`
	Version       int64  `json:"version" gorm:"type:bigint"`
	WebhookURL    string `json:"webhook_url" gorm:"type:text"`
	WebhookStatus string `json:"webhook_status" gorm:"type:varchar(32)"`
	LastError     string `json:"last_error" gorm:"type:varchar(255)"`
	UpdatedAt     int64  `json:"updated_at" gorm:"type:bigint"`
}

type TelegramBotPreferences struct {
	Enabled      bool `json:"enabled"`
	LowBalance   bool `json:"low_balance"`
	TopUp        bool `json:"topup"`
	Subscription bool `json:"subscription"`
	Expiry       bool `json:"expiry"`
}

// TelegramBotConnection 将登录身份、用户连接选择和事件偏好分别保存。
type TelegramBotConnection struct {
	UserID               int                    `json:"user_id" gorm:"primaryKey;autoIncrement:false"`
	BotID                int64                  `json:"-" gorm:"type:bigint;index"`
	TelegramID           string                 `json:"-" gorm:"type:varchar(32);index"`
	ChatID               string                 `json:"-" gorm:"type:varchar(32)"`
	Status               string                 `json:"status" gorm:"type:varchar(32);index"`
	Version              int64                  `json:"version" gorm:"type:bigint"`
	AuthorizationVersion int64                  `json:"-" gorm:"type:bigint;default:0"`
	FlowVersion          int64                  `json:"-" gorm:"type:bigint"`
	PreferencesVersion   int64                  `json:"preferences_version" gorm:"type:bigint"`
	Preferences          TelegramBotPreferences `json:"preferences" gorm:"embedded;embeddedPrefix:notify_"`
	EnabledVersion       int64                  `json:"-" gorm:"type:bigint"`
	LowBalanceVersion    int64                  `json:"-" gorm:"type:bigint"`
	TopUpVersion         int64                  `json:"-" gorm:"type:bigint"`
	SubscriptionVersion  int64                  `json:"-" gorm:"type:bigint"`
	ExpiryVersion        int64                  `json:"-" gorm:"type:bigint"`
	ConnectedAt          int64                  `json:"last_connected_at" gorm:"type:bigint"`
	LastCommandAt        int64                  `json:"-" gorm:"type:bigint"`
	LastStateEventAt     int64                  `json:"-" gorm:"type:bigint;default:0"`
	LastStateUpdateID    int64                  `json:"-" gorm:"type:bigint;default:0"`
	LastError            string                 `json:"last_error" gorm:"type:varchar(255)"`
	UpdatedAt            int64                  `json:"-" gorm:"type:bigint"`
}

type TelegramBotOAuthIntent struct {
	UserID            int                    `json:"user_id"`
	BotID             int64                  `json:"bot_id"`
	ConfigVersion     int64                  `json:"config_version"`
	ConnectionVersion int64                  `json:"connection_version"`
	Preferences       TelegramBotPreferences `json:"preferences"`
}

// TelegramBusinessEvent 保存已经提交的业务事实，重试通知不重新执行资金业务。
type TelegramBusinessEvent struct {
	Key            string `json:"key"`
	Kind           string `json:"kind"`
	UserID         int    `json:"user_id"`
	AmountQuota    int64  `json:"amount_quota"`
	BalanceQuota   int64  `json:"balance_quota"`
	OccurredAt     int64  `json:"occurred_at"`
	SubscriptionID int    `json:"subscription_id"`
	ExpiresAt      int64  `json:"expires_at"`
	Title          string `json:"title"`
	Source         string `json:"source"`
}

// TelegramBotOutbox 每条任务固定机器人、接收目标和相关偏好版本。
type TelegramBotOutbox struct {
	ID                int64  `json:"id" gorm:"primaryKey"`
	EventKey          string `json:"-" gorm:"type:char(64);not null;uniqueIndex"`
	BusinessKey       string `json:"-" gorm:"type:char(64);index"`
	Kind              string `json:"kind" gorm:"type:varchar(32)"`
	UserID            int    `json:"user_id" gorm:"index"`
	BotID             int64  `json:"-" gorm:"type:bigint"`
	ConnectionVersion int64  `json:"-" gorm:"type:bigint"`
	EnabledVersion    int64  `json:"-" gorm:"type:bigint"`
	PreferenceVersion int64  `json:"-" gorm:"type:bigint"`
	ChatID            string `json:"-" gorm:"type:varchar(32)"`
	Payload           string `json:"-" gorm:"type:text"`
	Status            string `json:"status" gorm:"type:varchar(16);index:idx_tg_outbox_due,priority:1"`
	Attempts          int    `json:"attempts"`
	NextAttemptAt     int64  `json:"-" gorm:"type:bigint;index:idx_tg_outbox_due,priority:2"`
	LeaseUntil        int64  `json:"-" gorm:"type:bigint"`
	LeaseOwner        string `json:"-" gorm:"type:varchar(64)"`
	CreatedAt         int64  `json:"created_at" gorm:"type:bigint"`
	ExpiresAt         int64  `json:"-" gorm:"type:bigint"`
	LastError         string `json:"last_error" gorm:"type:varchar(255)"`
}

// TelegramBotInbox 不保存原始消息体；恢复凭据只保存摘要。
type TelegramBotInbox struct {
	ID                   int64  `json:"-" gorm:"primaryKey"`
	BotID                int64  `json:"-" gorm:"type:bigint;uniqueIndex:idx_tg_bot_update,priority:1"`
	UpdateID             int64  `json:"-" gorm:"type:bigint;uniqueIndex:idx_tg_bot_update,priority:2"`
	UserID               int    `json:"-" gorm:"index"`
	TelegramID           string `json:"-" gorm:"type:varchar(32)"`
	ChatID               string `json:"-" gorm:"type:varchar(32)"`
	ConnectionVersion    int64  `json:"-" gorm:"type:bigint"`
	AuthorizationVersion int64  `json:"-" gorm:"type:bigint;default:0"`
	Command              string `json:"-" gorm:"type:varchar(64)"`
	Argument             string `json:"-" gorm:"type:varchar(128)"`
	FlowHash             string `json:"-" gorm:"type:char(64)"`
	MessageAt            int64  `json:"-" gorm:"type:bigint"`
	ReceivedAt           int64  `json:"-" gorm:"type:bigint"`
	CommandChecked       bool   `json:"-" gorm:"default:false"`
	CommandAccepted      bool   `json:"-" gorm:"default:false"`
	CommandAt            int64  `json:"-" gorm:"type:bigint;default:0"`
	BusinessDate         string `json:"-" gorm:"type:varchar(10)"`
	Status               string `json:"-" gorm:"type:varchar(16);index:idx_tg_inbox_due,priority:1"`
	Attempts             int    `json:"-"`
	NextAttemptAt        int64  `json:"-" gorm:"type:bigint;index:idx_tg_inbox_due,priority:2"`
	LeaseUntil           int64  `json:"-" gorm:"type:bigint"`
	LeaseOwner           string `json:"-" gorm:"type:varchar(64)"`
}

func GetTelegramBotConfig() (*TelegramBotConfig, error) {
	var cfg TelegramBotConfig
	err := DB.First(&cfg, 1).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &TelegramBotConfig{ID: 1}, nil
	}
	return &cfg, err
}

func GetTelegramBotConnection(userID int) (*TelegramBotConnection, error) {
	var conn TelegramBotConnection
	err := DB.First(&conn, "user_id = ?", userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &TelegramBotConnection{UserID: userID, Status: TelegramBotUnconnected}, nil
	}
	return &conn, err
}

func BeginTelegramBotOAuth(userID int, prefs TelegramBotPreferences) (*TelegramBotOAuthIntent, error) {
	var intent *TelegramBotOAuthIntent
	err := DB.Transaction(func(tx *gorm.DB) error {
		var err error
		intent, err = beginTelegramBotOAuthTx(tx, userID, &prefs)
		return err
	})
	return intent, err
}

// beginTelegramBotOAuthTx 在同一锁内取得流程版本及通知偏好；恢复流程不再使用事务外的旧设置。
func beginTelegramBotOAuthTx(tx *gorm.DB, userID int, prefs *TelegramBotPreferences) (*TelegramBotOAuthIntent, error) {
	var cfg TelegramBotConfig
	if err := tx.First(&cfg, 1).Error; err != nil || !cfg.Enabled || cfg.BotID <= 0 {
		return nil, ErrTelegramBotUnavailable
	}
	var user User
	if err := lockForUpdate(tx).First(&user, userID).Error; err != nil {
		return nil, err
	}
	if user.Status != common.UserStatusEnabled {
		return nil, ErrTelegramBotExpired
	}
	conn := TelegramBotConnection{UserID: userID, Status: TelegramBotUnconnected}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&conn).Error; err != nil {
		return nil, err
	}
	if err := lockForUpdate(tx).First(&conn, "user_id = ?", userID).Error; err != nil {
		return nil, err
	}
	selected := conn.Preferences
	if prefs != nil {
		selected = *prefs
	}
	conn.FlowVersion++
	if err := tx.Model(&conn).Update("flow_version", conn.FlowVersion).Error; err != nil {
		return nil, err
	}
	return &TelegramBotOAuthIntent{UserID: userID, BotID: cfg.BotID, ConfigVersion: cfg.Version, ConnectionVersion: conn.FlowVersion, Preferences: selected}, nil
}

func CompleteTelegramBotOAuthTx(tx *gorm.DB, userID int, telegramID string, intent *TelegramBotOAuthIntent) error {
	if intent == nil || intent.UserID != userID {
		return ErrTelegramBotExpired
	}
	if id, err := strconv.ParseInt(telegramID, 10, 64); err != nil || id <= 0 {
		return ErrTelegramBotExpired
	}
	var cfg TelegramBotConfig
	if err := tx.First(&cfg, 1).Error; err != nil || !cfg.Enabled || cfg.BotID != intent.BotID || cfg.Version != intent.ConfigVersion {
		return ErrTelegramBotExpired
	}
	var user User
	if err := lockForUpdate(tx).First(&user, userID).Error; err != nil {
		return err
	}
	if user.Status != common.UserStatusEnabled || user.TelegramId != telegramID {
		return ErrTelegramBotExpired
	}
	var conn TelegramBotConnection
	if err := lockForUpdate(tx).First(&conn, "user_id = ?", userID).Error; err != nil {
		return err
	}
	if conn.FlowVersion != intent.ConnectionVersion {
		return ErrTelegramBotExpired
	}
	conn.Version++
	conn.AuthorizationVersion++
	conn.FlowVersion++
	conn.BotID = cfg.BotID
	conn.TelegramID = telegramID
	conn.ChatID = telegramID
	// 已通过本次明确的消息授权，连接立即可用；欢迎消息只负责异步投递。
	conn.Status = TelegramBotConnected
	conn.ConnectedAt = time.Now().Unix()
	conn.LastStateEventAt, conn.LastStateUpdateID = conn.ConnectedAt, 0
	conn.LastError = ""
	conn.UpdatedAt = conn.ConnectedAt
	applyTelegramPreferences(&conn, intent.Preferences)
	if err := tx.Save(&conn).Error; err != nil {
		return err
	}
	if conn.Preferences.Enabled && conn.Preferences.LowBalance {
		if err := InitializeTelegramLowBalanceStateTx(tx, &conn); err != nil {
			return err
		}
	}
	return EnqueueTelegramBotMessageTx(tx, &conn, "welcome", fmt.Sprintf("welcome:%d:%d", userID, conn.Version), "", time.Now().Unix()+86400)
}

func applyTelegramPreferences(conn *TelegramBotConnection, prefs TelegramBotPreferences) {
	if conn.Preferences.Enabled != prefs.Enabled {
		conn.EnabledVersion++
	}
	if conn.Preferences.LowBalance != prefs.LowBalance {
		conn.LowBalanceVersion++
	}
	if conn.Preferences.TopUp != prefs.TopUp {
		conn.TopUpVersion++
	}
	if conn.Preferences.Subscription != prefs.Subscription {
		conn.SubscriptionVersion++
	}
	if conn.Preferences.Expiry != prefs.Expiry {
		conn.ExpiryVersion++
	}
	conn.Preferences = prefs
	conn.PreferencesVersion++
}

func UpdateTelegramBotPreferencesTx(tx *gorm.DB, userID int, version int64, prefs TelegramBotPreferences) error {
	var user User
	if err := lockForUpdate(tx).First(&user, userID).Error; err != nil {
		return err
	}
	var conn TelegramBotConnection
	if err := lockForUpdate(tx).First(&conn, "user_id = ?", userID).Error; err != nil {
		return ErrTelegramBotNotConnected
	}
	if user.Status != common.UserStatusEnabled || user.TelegramId != conn.TelegramID || conn.Status != TelegramBotConnected {
		return ErrTelegramBotNotConnected
	}
	if conn.PreferencesVersion != version {
		return ErrTelegramBotChanged
	}
	initializeBaseline := prefs.Enabled && prefs.LowBalance && (!conn.Preferences.Enabled || !conn.Preferences.LowBalance)
	applyTelegramPreferences(&conn, prefs)
	conn.FlowVersion++
	conn.UpdatedAt = time.Now().Unix()
	if err := tx.Save(&conn).Error; err != nil {
		return err
	}
	if initializeBaseline {
		return InitializeTelegramLowBalanceStateTx(tx, &conn)
	}
	return nil
}

func DisconnectTelegramBot(userID int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).First(&user, userID).Error; err != nil {
			return err
		}
		var conn TelegramBotConnection
		if err := lockForUpdate(tx).First(&conn, "user_id = ?", userID).Error; errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		} else if err != nil {
			return err
		}
		conn.Status = TelegramBotDisconnected
		conn.Version++
		conn.AuthorizationVersion++
		conn.FlowVersion++
		conn.UpdatedAt = time.Now().Unix()
		return tx.Save(&conn).Error
	})
}

// InvalidateTelegramBotTx 账号生命周期变化必须使旧连接永久失效，停用机器人期间也不能跳过。
func InvalidateTelegramBotTx(tx *gorm.DB, userID int) error {
	// 兼容尚未安装机器人表的旧数据库夹具；正常启动迁移后始终执行失效更新。
	if !system_setting.TelegramBotEnabled() && !tx.Migrator().HasTable(&TelegramBotConnection{}) {
		return nil
	}
	return tx.Model(&TelegramBotConnection{}).Where("user_id = ?", userID).Updates(map[string]any{"status": TelegramBotDisconnected, "version": gorm.Expr("version + 1"), "authorization_version": gorm.Expr("authorization_version + 1"), "flow_version": gorm.Expr("flow_version + 1"), "updated_at": time.Now().Unix()}).Error
}

// InvalidateTelegramBotIdentityTx 机器人身份切换使全部旧连接和任务失效，之后切回旧机器人也不会复活授权。
// 调用者先锁定唯一配置行；不锁授权流程表，旧流程由连接版本失效。
func InvalidateTelegramBotIdentityTx(tx *gorm.DB, oldBotID int64) error {
	if oldBotID <= 0 {
		return nil
	}
	if err := tx.Model(&TelegramBotConnection{}).Where("user_id > ?", 0).Updates(map[string]any{
		"status": TelegramBotDisconnected, "version": gorm.Expr("version + 1"),
		"authorization_version": gorm.Expr("authorization_version + 1"),
		"flow_version":          gorm.Expr("flow_version + 1"), "updated_at": time.Now().Unix(),
	}).Error; err != nil {
		return err
	}
	if err := tx.Model(&TelegramBotOutbox{}).Where("status IN ?", []string{"pending", "processing"}).Updates(map[string]any{
		"status": "discarded", "lease_owner": "", "lease_until": 0, "last_error": "bot identity changed",
	}).Error; err != nil {
		return err
	}
	return tx.Model(&TelegramBotInbox{}).Where("status IN ?", []string{"pending", "processing"}).Updates(map[string]any{
		"status": "discarded", "lease_owner": "", "lease_until": 0,
	}).Error
}

func (conn *TelegramBotConnection) EventPreference(kind string) (bool, int64) {
	switch kind {
	case "low_balance":
		return conn.Preferences.LowBalance, conn.LowBalanceVersion
	case "topup":
		return conn.Preferences.TopUp, conn.TopUpVersion
	case "subscription":
		return conn.Preferences.Subscription, conn.SubscriptionVersion
	case "expiry":
		return conn.Preferences.Expiry, conn.ExpiryVersion
	}
	return false, 0
}

func telegramEventDigest(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func TelegramBotMessageDigest(value string) string { return telegramEventDigest(value) }

func EnqueueTelegramBusinessEventTx(tx *gorm.DB, event *TelegramBusinessEvent) error {
	if !system_setting.TelegramBotEnabled() || event == nil {
		return nil
	}
	var cfg TelegramBotConfig
	if err := tx.First(&cfg, 1).Error; err != nil {
		return err
	}
	if !cfg.Enabled {
		return nil
	}
	var user User
	if err := lockForUpdate(tx).First(&user, event.UserID).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	} else if err != nil {
		return err
	}
	var conn TelegramBotConnection
	if err := lockForUpdate(tx).First(&conn, "user_id = ?", event.UserID).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	} else if err != nil {
		return err
	}
	selected, version := conn.EventPreference(event.Kind)
	if conn.BotID != cfg.BotID || conn.Status != TelegramBotConnected || !conn.Preferences.Enabled || !selected {
		return nil
	}
	if user.Status != common.UserStatusEnabled || user.TelegramId != conn.TelegramID {
		return nil
	}
	payload, err := common.Marshal(event)
	if err != nil {
		return err
	}
	now := time.Now().Unix()
	expires := now + 86400
	if event.ExpiresAt > 0 && event.Kind == "expiry" {
		expires = min(expires, event.ExpiresAt)
	}
	businessKey := telegramEventDigest(fmt.Sprintf("event:%s:%s:%d", event.Kind, event.Key, event.UserID))
	eventKey := businessKey
	if event.Kind == "expiry" {
		var sent int64
		if err := tx.Model(&TelegramBotOutbox{}).Where("business_key = ? AND status = ?", businessKey, "sent").Count(&sent).Error; err != nil {
			return err
		}
		if sent > 0 {
			return nil
		}
		var sending int64
		if err := tx.Model(&TelegramBotOutbox{}).Where("business_key = ? AND status = ? AND lease_until >= ?", businessKey, "processing", now).Count(&sending).Error; err != nil {
			return err
		}
		if sending > 0 {
			return nil
		}
		eventKey = telegramEventDigest(fmt.Sprintf("%s:%d:%d", businessKey, conn.BotID, conn.Version))
	}
	task := TelegramBotOutbox{EventKey: eventKey, BusinessKey: businessKey, Kind: event.Kind, UserID: event.UserID, BotID: conn.BotID, ConnectionVersion: conn.Version, EnabledVersion: conn.EnabledVersion, PreferenceVersion: version, ChatID: conn.ChatID, Payload: string(payload), Status: "pending", CreatedAt: now, NextAttemptAt: now, ExpiresAt: expires}
	if event.Kind != "expiry" {
		return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&task).Error
	}
	// 到期提醒尚未送达时允许按新的连接和通知选择重新评估，已发送记录永不复活。
	var old TelegramBotOutbox
	if err := lockForUpdate(tx).Where("event_key = ?", task.EventKey).First(&old).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return tx.Create(&task).Error
	} else if err != nil {
		return err
	}
	if old.BotID != task.BotID || old.ConnectionVersion != task.ConnectionVersion || old.ChatID != task.ChatID || old.Status == "sent" || old.Status == "processing" || (old.EnabledVersion == task.EnabledVersion && old.PreferenceVersion == task.PreferenceVersion) {
		return nil
	}
	return tx.Model(&old).Updates(map[string]any{"status": "pending", "enabled_version": task.EnabledVersion, "preference_version": task.PreferenceVersion, "payload": task.Payload, "attempts": 0, "lease_until": 0, "lease_owner": "", "created_at": now, "next_attempt_at": now, "expires_at": expires, "last_error": ""}).Error
}

func EnqueueTelegramBotMessageTx(tx *gorm.DB, conn *TelegramBotConnection, kind, key, payload string, expiresAt int64) error {
	now := time.Now().Unix()
	task := TelegramBotOutbox{EventKey: telegramEventDigest(key), Kind: kind, UserID: conn.UserID, BotID: conn.BotID, ConnectionVersion: conn.Version, ChatID: conn.ChatID, Payload: payload, Status: "pending", CreatedAt: now, NextAttemptAt: now, ExpiresAt: expiresAt}
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&task).Error
}

func AcceptTelegramBotInbox(inbox *TelegramBotInbox) error {
	inbox.ReceivedAt = time.Now().Unix()
	inbox.Status = "pending"
	inbox.NextAttemptAt = inbox.ReceivedAt
	if inbox.FlowHash != "" {
		inbox.FlowHash = authFlowTokenHash(inbox.FlowHash)
	}
	if inbox.MessageAt <= 0 || inbox.MessageAt > inbox.ReceivedAt+30 || inbox.MessageAt < inbox.ReceivedAt-300 {
		inbox.Status = "discarded"
	}
	inbox.BusinessDate = CheckinBusinessDate(time.Unix(inbox.MessageAt, 0))
	var user User
	err := DB.Where("telegram_id = ? AND status = ?", inbox.TelegramID, common.UserStatusEnabled).First(&user).Error
	if err == nil {
		var conn TelegramBotConnection
		err = DB.Where("user_id = ? AND bot_id = ? AND telegram_id = ?", user.Id, inbox.BotID, inbox.TelegramID).First(&conn).Error
		if err == nil {
			inbox.UserID = conn.UserID
			inbox.ConnectionVersion = conn.Version
			inbox.AuthorizationVersion = conn.AuthorizationVersion
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return DB.Clauses(clause.OnConflict{DoNothing: true}).Create(inbox).Error
}

func ClaimTelegramBotInbox(owner string) (*TelegramBotInbox, error) {
	now := time.Now().Unix()
	var row TelegramBotInbox
	err := DB.Where("(status = ? AND next_attempt_at <= ?) OR (status = ? AND lease_until < ?)", "pending", now, "processing", now).Order("id asc").First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	result := DB.Model(&TelegramBotInbox{}).Where("id = ? AND ((status = ? AND next_attempt_at <= ?) OR (status = ? AND lease_until < ?))", row.ID, "pending", now, "processing", now).Updates(map[string]any{"status": "processing", "lease_owner": owner, "lease_until": now + 120, "attempts": gorm.Expr("attempts + 1")})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, nil
	}
	row.Attempts++
	row.LeaseOwner = owner
	row.LeaseUntil = now + 120
	return &row, nil
}

func ClaimTelegramBotOutbox(owner string) (*TelegramBotOutbox, error) {
	now := time.Now().Unix()
	var row TelegramBotOutbox
	err := DB.Where("(status = ? AND next_attempt_at <= ?) OR (status = ? AND lease_until < ?)", "pending", now, "processing", now).Order("id asc").First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	result := DB.Model(&TelegramBotOutbox{}).Where("id = ? AND ((status = ? AND next_attempt_at <= ?) OR (status = ? AND lease_until < ?))", row.ID, "pending", now, "processing", now).Updates(map[string]any{"status": "processing", "lease_owner": owner, "lease_until": now + 120, "attempts": gorm.Expr("attempts + 1")})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, nil
	}
	row.Attempts++
	row.LeaseOwner = owner
	row.LeaseUntil = now + 120
	return &row, nil
}

func FinishTelegramBotInbox(row *TelegramBotInbox, status string) error {
	return DB.Model(&TelegramBotInbox{}).Where("id = ? AND status = ? AND lease_owner = ?", row.ID, "processing", row.LeaseOwner).Updates(map[string]any{"status": status, "lease_owner": "", "lease_until": 0, "next_attempt_at": time.Now().Unix() + int64(min(60, row.Attempts*5))}).Error
}

func FinishTelegramBotOutbox(row *TelegramBotOutbox, status, reason string, retryAfter int64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var conn TelegramBotConnection
		connectionExists := false
		if row.Kind == "connect" && (status == "failed" || status == "discarded") {
			// 与最终发送许可保持连接在任务之前的锁序，旧工作进程不能覆盖新的连接。
			err := lockForUpdate(tx).First(&conn, "user_id = ?", row.UserID).Error
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			connectionExists = err == nil
		}
		result := tx.Model(&TelegramBotOutbox{}).Where("id = ? AND status = ? AND lease_owner = ?", row.ID, "processing", row.LeaseOwner).Updates(map[string]any{"status": status, "lease_owner": "", "lease_until": 0, "last_error": reason, "next_attempt_at": time.Now().Unix() + retryAfter})
		if result.Error != nil || result.RowsAffected != 1 {
			return result.Error
		}
		if connectionExists && conn.BotID == row.BotID && conn.Version == row.ConnectionVersion && conn.ChatID == row.ChatID && conn.Status == TelegramBotConnecting {
			return tx.Model(&conn).Updates(map[string]any{
				"status": TelegramBotUnconnected, "last_error": "Telegram bot connection failed. Please reconnect.", "updated_at": time.Now().Unix(),
			}).Error
		}
		return nil
	})
}

// AuthorizeTelegramBotSend 以配置、用户、连接、任务的固定锁序提交最终发送许可。
// 提交成功即视为已开始发送；之后的断开不会撤回在途请求，回包仍须检查连接版本。
func AuthorizeTelegramBotSend(row *TelegramBotOutbox) (bool, error) {
	authorized := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		var cfg TelegramBotConfig
		if err := lockForUpdate(tx).First(&cfg, 1).Error; err != nil {
			return err
		}
		if !cfg.Enabled || cfg.BotID != row.BotID {
			return nil
		}
		obsoleteHelp := false
		if row.Kind == "help" {
			// 公共提示未绑定用户；发送前按当前身份复核，避免旧提示与新连接矛盾。
			var recipient User
			err := tx.Select("id").Where("telegram_id = ?", row.ChatID).First(&recipient).Error
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if err == nil {
				// 先定位再按主键加锁，避免未绑定身份的空范围锁影响并发绑定。
				err = lockForUpdate(tx).First(&recipient, recipient.Id).Error
				if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
					return err
				}
				if err == nil && recipient.TelegramId == row.ChatID {
					var conn TelegramBotConnection
					err = lockForUpdate(tx).First(&conn, "user_id = ?", recipient.Id).Error
					if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
						return err
					}
					if err == nil && conn.BotID == row.BotID && conn.TelegramID == recipient.TelegramId && conn.ChatID == row.ChatID && (conn.Status == TelegramBotConnected || conn.Status == TelegramBotConnecting) {
						obsoleteHelp = true
					}
				}
			}
		} else {
			var user User
			if err := lockForUpdate(tx).First(&user, row.UserID).Error; errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			} else if err != nil {
				return err
			}
			var conn TelegramBotConnection
			if err := lockForUpdate(tx).First(&conn, "user_id = ?", row.UserID).Error; errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			} else if err != nil {
				return err
			}
			if user.Status != common.UserStatusEnabled || user.TelegramId != conn.TelegramID || conn.BotID != row.BotID || conn.Version != row.ConnectionVersion || conn.ChatID != row.ChatID {
				return nil
			}
			if row.Kind == "connect" {
				if conn.Status != TelegramBotConnecting {
					return nil
				}
			} else if conn.Status != TelegramBotConnected {
				return nil
			}
			if row.Kind != "connect" && row.Kind != "welcome" && row.Kind != "reply" && row.Kind != "test" {
				selected, version := conn.EventPreference(row.Kind)
				if !conn.Preferences.Enabled || !selected || conn.EnabledVersion != row.EnabledVersion || version != row.PreferenceVersion {
					return nil
				}
				var event TelegramBusinessEvent
				if err := common.UnmarshalJsonStr(row.Payload, &event); err != nil {
					return err
				}
				valid, err := telegramBusinessEventStillValidTx(tx, &event)
				if err != nil || !valid {
					return err
				}
			}
		}
		var task TelegramBotOutbox
		if err := lockForUpdate(tx).First(&task, row.ID).Error; errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		} else if err != nil {
			return err
		}
		now := time.Now().Unix()
		if task.Status != "processing" || task.LeaseOwner != row.LeaseOwner || task.LeaseUntil < now || task.ExpiresAt <= now {
			return nil
		}
		if obsoleteHelp {
			// 与连接状态复核原子结束旧提示，暂停再恢复也不能使其重新发送。
			return tx.Model(&task).Updates(map[string]any{"status": "discarded", "lease_owner": "", "lease_until": 0, "last_error": "recipient already authorized"}).Error
		}
		// 任务已被当前事务锁定；MySQL 对同值更新返回零行，不能据此否认有效发送许可。
		if err := tx.Model(&task).Update("lease_until", now+120).Error; err != nil {
			return err
		}
		authorized = true
		return nil
	})
	return authorized && err == nil, err
}

// AcceptTelegramBotCommand 固定使用首次收取时的消息时间，重试复用准入结果而不再次消耗限额。
func AcceptTelegramBotCommand(row *TelegramBotInbox) (bool, error) {
	accepted := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).First(&user, row.UserID).Error; err != nil {
			return err
		}
		var conn TelegramBotConnection
		if err := lockForUpdate(tx).First(&conn, "user_id = ?", row.UserID).Error; err != nil {
			return err
		}
		if user.Status != common.UserStatusEnabled || user.TelegramId != row.TelegramID || conn.TelegramID != row.TelegramID || conn.BotID != row.BotID || conn.Version != row.ConnectionVersion || conn.Status != TelegramBotConnected {
			return nil
		}
		var inbox TelegramBotInbox
		if err := lockForUpdate(tx).First(&inbox, row.ID).Error; err != nil {
			return err
		}
		if inbox.Status != "processing" || inbox.LeaseOwner != row.LeaseOwner || inbox.LeaseUntil < time.Now().Unix() {
			return nil
		}
		if inbox.CommandChecked {
			accepted = inbox.CommandAccepted
			return nil
		}
		commandAt := min(inbox.MessageAt, inbox.ReceivedAt)
		var nearby int64
		if err := tx.Model(&TelegramBotInbox{}).Where("user_id = ? AND bot_id = ? AND connection_version = ? AND command_accepted = ? AND command_at > ? AND command_at < ?", row.UserID, row.BotID, row.ConnectionVersion, true, commandAt-2, commandAt+2).Count(&nearby).Error; err != nil {
			return err
		}
		accepted = nearby == 0
		if err := tx.Model(&inbox).Updates(map[string]any{"command_checked": true, "command_accepted": accepted, "command_at": commandAt}).Error; err != nil {
			return err
		}
		if accepted && commandAt > conn.LastCommandAt {
			return tx.Model(&conn).Update("last_command_at", commandAt).Error
		}
		return nil
	})
	return accepted && err == nil, err
}
