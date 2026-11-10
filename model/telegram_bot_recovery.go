package model

import (
	"errors"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const telegramBotRecoveryPurpose = "telegram_bot_recovery"

type telegramBotRecoveryPayload struct {
	Identity           AuthSessionIdentity    `json:"identity"`
	Intent             TelegramBotOAuthIntent `json:"intent"`
	VerifiedTelegramID string                 `json:"telegram_id"`
	ChatID             string                 `json:"chat_id"`
}

func CreateTelegramBotRecovery(identity AuthSessionIdentity) (string, *AuthFlow, error) {
	var token string
	var flow *AuthFlow
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := ValidateAuthSessionWithTx(tx, identity); err != nil {
			return err
		}
		intent, err := beginTelegramBotOAuthTx(tx, identity.UserID, nil)
		if err != nil {
			return err
		}
		payload, err := common.Marshal(telegramBotRecoveryPayload{Identity: identity, Intent: *intent})
		if err != nil {
			return err
		}
		token, flow, err = createAuthFlowWithTx(tx, AuthFlowCreate{Purpose: telegramBotRecoveryPurpose, Provider: "telegram", Intent: AuthFlowIntentBind, UserId: identity.UserID, SessionId: identity.SessionID, Payload: string(payload), ExpiresAt: time.Now().Add(5 * time.Minute)})
		return err
	})
	return token, flow, err
}

// ObserveTelegramBotRecovery 机器人只提交真实私聊身份，最终连接仍由原网页会话确认。
func ObserveTelegramBotRecovery(flowHash, telegramID, chatID string, cfg *TelegramBotConfig) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var flow AuthFlow
		err := lockForUpdate(tx).Where("token_hash = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ?", flowHash, telegramBotRecoveryPurpose, time.Now()).First(&flow).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		var payload telegramBotRecoveryPayload
		if err := common.UnmarshalJsonStr(flow.Payload, &payload); err != nil {
			return err
		}
		if err := ValidateAuthSessionWithTx(tx, payload.Identity); err != nil {
			return nil
		}
		var user User
		if err := tx.First(&user, flow.UserId).Error; err != nil {
			return err
		}
		if user.Status != common.UserStatusEnabled || user.TelegramId != telegramID || cfg.BotID != payload.Intent.BotID || cfg.Version != payload.Intent.ConfigVersion {
			return nil
		}
		var conn TelegramBotConnection
		if err := tx.First(&conn, "user_id = ?", flow.UserId).Error; err != nil {
			return err
		}
		if conn.FlowVersion != payload.Intent.ConnectionVersion {
			return nil
		}
		if payload.VerifiedTelegramID != "" && (payload.VerifiedTelegramID != telegramID || payload.ChatID != chatID) {
			return nil
		}
		payload.VerifiedTelegramID = telegramID
		payload.ChatID = chatID
		data, err := common.Marshal(payload)
		if err != nil {
			return err
		}
		return tx.Model(&flow).Update("payload", string(data)).Error
	})
}

func ConfirmTelegramBotRecovery(token string, identity AuthSessionIdentity) error {
	_, err := ConsumeAuthFlowWithAction(token, AuthFlowMatch{Purpose: telegramBotRecoveryPurpose, Provider: "telegram", Intent: AuthFlowIntentBind, UserId: identity.UserID, SessionId: identity.SessionID}, func(tx *gorm.DB, flow *AuthFlow) error {
		var payload telegramBotRecoveryPayload
		if err := common.UnmarshalJsonStr(flow.Payload, &payload); err != nil {
			return err
		}
		if payload.Identity != identity || payload.VerifiedTelegramID == "" || payload.ChatID == "" {
			return ErrTelegramBotExpired
		}
		if err := ValidateAuthSessionWithTx(tx, identity); err != nil {
			return err
		}
		if err := CompleteTelegramBotOAuthTx(tx, identity.UserID, payload.VerifiedTelegramID, &payload.Intent); err != nil {
			return err
		}
		var conn TelegramBotConnection
		if err := tx.First(&conn, "user_id = ?", identity.UserID).Error; err != nil {
			return err
		}
		if err := tx.Model(&conn).Update("chat_id", payload.ChatID).Error; err != nil {
			return err
		}
		return tx.Model(&TelegramBotOutbox{}).Where("user_id = ? AND kind = ? AND connection_version = ? AND status = ?", identity.UserID, "connect", conn.Version, "pending").Update("chat_id", payload.ChatID).Error
	})
	return err
}

func ConfirmTelegramBotConnection(snapshot *TelegramBotConnection, chatID int64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var cfg TelegramBotConfig
		if err := tx.First(&cfg, 1).Error; err != nil {
			return err
		}
		if !cfg.Enabled || cfg.BotID != snapshot.BotID {
			return ErrTelegramBotExpired
		}
		var user User
		if err := lockForUpdate(tx).First(&user, snapshot.UserID).Error; err != nil {
			return err
		}
		var conn TelegramBotConnection
		if err := lockForUpdate(tx).First(&conn, "user_id = ?", snapshot.UserID).Error; err != nil {
			return err
		}
		if conn.BotID != snapshot.BotID || conn.Version != snapshot.Version || conn.Status != TelegramBotConnecting || user.Status != common.UserStatusEnabled || user.TelegramId != conn.TelegramID {
			return ErrTelegramBotExpired
		}
		conn.ChatID = strconv.FormatInt(chatID, 10)
		conn.Status = TelegramBotConnected
		conn.LastError = ""
		conn.ConnectedAt = time.Now().Unix()
		conn.UpdatedAt = conn.ConnectedAt
		if err := tx.Save(&conn).Error; err != nil {
			return err
		}
		if conn.Preferences.Enabled && conn.Preferences.LowBalance {
			return InitializeTelegramLowBalanceStateTx(tx, &conn)
		}
		return nil
	})
}

// ApplyTelegramBotStateEvent 只按同一授权代次内的 Telegram 时间和更新编号推进连接状态。
// 返回值只表示已发起拉黑恢复；已连接的 /start 仍由服务层继续回复帮助。
func ApplyTelegramBotStateEvent(row *TelegramBotInbox, blocked bool) (bool, error) {
	restored := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		if row.UserID <= 0 {
			return nil
		}
		var cfg TelegramBotConfig
		if err := lockForUpdate(tx).First(&cfg, 1).Error; err != nil {
			return err
		}
		if !cfg.Enabled || cfg.BotID != row.BotID {
			return nil
		}
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
		if conn.BotID != row.BotID || conn.AuthorizationVersion != row.AuthorizationVersion || conn.TelegramID != row.TelegramID || user.TelegramId != row.TelegramID || user.Status != common.UserStatusEnabled || conn.Status == TelegramBotDisconnected || conn.Status == TelegramBotUnconnected {
			return nil
		}
		now := time.Now().Unix()
		confirming := !blocked && conn.Status == TelegramBotConnecting
		if confirming {
			// 只确认本次已获授权的本人私聊；恢复链接仍须回到原网页确认。
			id, err := strconv.ParseInt(row.TelegramID, 10, 64)
			if err != nil || id <= 0 || row.ChatID != row.TelegramID || row.Command != "/start" || row.FlowHash != "" || row.ConnectionVersion != conn.Version || row.MessageAt < now-300 || row.MessageAt > now+30 {
				return nil
			}
		}
		if row.MessageAt <= 0 || row.MessageAt < conn.LastStateEventAt || (row.MessageAt == conn.LastStateEventAt && row.UpdateID <= conn.LastStateUpdateID) {
			return nil
		}
		conn.LastStateEventAt, conn.LastStateUpdateID = row.MessageAt, row.UpdateID
		conn.UpdatedAt = now
		if blocked {
			conn.Status = TelegramBotBlocked
			conn.LastError = "Telegram bot is not connected"
		} else if conn.Status == TelegramBotBlocked {
			conn.Status = TelegramBotConnecting
			conn.Version++
			conn.FlowVersion++
			conn.ChatID = row.ChatID
			conn.LastError = ""
			restored = true
		} else if confirming {
			conn.Status = TelegramBotConnected
			conn.ChatID = row.ChatID
			conn.ConnectedAt = now
			conn.LastError = ""
		}
		if err := tx.Save(&conn).Error; err != nil {
			return err
		}
		if restored {
			return EnqueueTelegramBotMessageTx(tx, &conn, "connect", "restore:"+strconv.Itoa(row.UserID)+":"+strconv.FormatInt(conn.Version, 10), "", time.Now().Unix()+300)
		}
		if confirming && conn.Preferences.Enabled && conn.Preferences.LowBalance {
			return InitializeTelegramLowBalanceStateTx(tx, &conn)
		}
		return nil
	})
	return restored, err
}
