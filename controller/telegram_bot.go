package controller

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func telegramBotError(c *gin.Context, err error) {
	var message *common.Message
	if errors.As(err, &message) {
		common.ApiError(c, message)
		return
	}
	common.ApiErrorT(c, "Telegram bot request failed. Please try again later.")
}

func TelegramBotWebhook(c *gin.Context) {
	cfg, err := model.GetTelegramBotConfig()
	if err != nil || !cfg.Enabled {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 64*1024))
	if err != nil {
		c.Status(http.StatusRequestEntityTooLarge)
		return
	}
	err = service.ReceiveTelegramBotUpdate(cfg, c.GetHeader("X-Telegram-Bot-Api-Secret-Token"), data)
	if errors.Is(err, model.ErrTelegramBotExpired) {
		c.Status(http.StatusUnauthorized)
		return
	}
	if err != nil {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	c.Status(http.StatusOK)
}

func GetTelegramBotStatus(c *gin.Context) {
	cfg, err := model.GetTelegramBotConfig()
	if err != nil {
		telegramBotError(c, err)
		return
	}
	conn, err := model.GetTelegramBotConnection(c.GetInt("id"))
	if err != nil {
		telegramBotError(c, err)
		return
	}
	user, err := model.GetUserById(c.GetInt("id"), true)
	if err != nil {
		telegramBotError(c, err)
		return
	}
	status := conn.Status
	if status == "" {
		status = model.TelegramBotUnconnected
	}
	if conn.BotID != cfg.BotID || user.TelegramId != conn.TelegramID || user.Status != common.UserStatusEnabled {
		status = model.TelegramBotUnconnected
	}
	link := ""
	if cfg.BotUsername != "" {
		link = "https://t.me/" + cfg.BotUsername
	}
	common.ApiSuccess(c, gin.H{"available": cfg.Enabled, "bot_username": cfg.BotUsername, "connected": status == model.TelegramBotConnected, "status": status, "telegram_id": user.TelegramId, "version": conn.Version, "preferences_version": conn.PreferencesVersion, "preferences": conn.Preferences, "last_error": conn.LastError, "last_connected_at": conn.ConnectedAt, "deep_link": link})
}

func UpdateTelegramBotPreferences(c *gin.Context) {
	succeeded := false
	defer func() {
		recordUserSecurityAudit(c, c.GetInt("id"), "user.telegram_bot_preferences", map[string]any{"success": succeeded})
	}()
	var input struct {
		Version     int64 `json:"version"`
		Preferences *struct {
			Enabled      *bool `json:"enabled"`
			LowBalance   *bool `json:"low_balance"`
			TopUp        *bool `json:"topup"`
			Subscription *bool `json:"subscription"`
			Expiry       *bool `json:"expiry"`
		} `json:"preferences"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.Preferences == nil {
		common.ApiErrorT(c, "Invalid request")
		return
	}
	connection, err := model.GetTelegramBotConnection(c.GetInt("id"))
	if err != nil {
		telegramBotError(c, err)
		return
	}
	prefs := connection.Preferences
	if input.Preferences.Enabled != nil {
		prefs.Enabled = *input.Preferences.Enabled
	}
	if input.Preferences.LowBalance != nil {
		prefs.LowBalance = *input.Preferences.LowBalance
	}
	if input.Preferences.TopUp != nil {
		prefs.TopUp = *input.Preferences.TopUp
	}
	if input.Preferences.Subscription != nil {
		prefs.Subscription = *input.Preferences.Subscription
	}
	if input.Preferences.Expiry != nil {
		prefs.Expiry = *input.Preferences.Expiry
	}
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		return model.UpdateTelegramBotPreferencesTx(tx, c.GetInt("id"), input.Version, prefs)
	})
	if err != nil {
		telegramBotError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
	succeeded = true
}

func DisconnectTelegramBot(c *gin.Context) {
	succeeded := false
	defer func() {
		recordUserSecurityAudit(c, c.GetInt("id"), "user.telegram_bot_disconnect", map[string]any{"success": succeeded})
	}()
	if err := model.DisconnectTelegramBot(c.GetInt("id")); err != nil {
		telegramBotError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
	succeeded = true
}

func TestTelegramBot(c *gin.Context) {
	cfg, err := model.GetTelegramBotConfig()
	if err != nil {
		telegramBotError(c, err)
		return
	}
	if !cfg.Enabled {
		telegramBotError(c, model.ErrTelegramBotUnavailable)
		return
	}
	conn, err := model.GetTelegramBotConnection(c.GetInt("id"))
	if err != nil {
		telegramBotError(c, err)
		return
	}
	user, err := model.GetUserById(c.GetInt("id"), true)
	if err != nil {
		telegramBotError(c, err)
		return
	}
	if conn.Status != model.TelegramBotConnected || conn.BotID != cfg.BotID || user.TelegramId != conn.TelegramID || user.Status != common.UserStatusEnabled {
		telegramBotError(c, model.ErrTelegramBotNotConnected)
		return
	}
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		return model.EnqueueTelegramBotMessageTx(tx, conn, "test", "test:"+strconv.Itoa(user.Id)+":"+common.GetUUID(), "", time.Now().Unix()+300)
	})
	if err != nil {
		telegramBotError(c, err)
		return
	}
	common.ApiSuccessT(c, "Telegram bot message was queued", nil)
}

func StartTelegramBotRecovery(c *gin.Context) {
	succeeded := false
	defer func() {
		recordUserSecurityAudit(c, c.GetInt("id"), "user.telegram_bot_recovery_start", map[string]any{"success": succeeded})
	}()
	identity, ok := requireBrowserSession(c)
	if !ok {
		return
	}
	token, flow, err := model.CreateTelegramBotRecovery(identity)
	if err != nil {
		telegramBotError(c, err)
		return
	}
	cfg, err := model.GetTelegramBotConfig()
	if err != nil {
		telegramBotError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"url": "https://t.me/" + cfg.BotUsername + "?start=tg_" + token, "flow_token": token, "expires_at": flow.ExpiresAt.Unix()})
	succeeded = true
}

func ConfirmTelegramBotRecovery(c *gin.Context) {
	succeeded := false
	defer func() {
		recordUserSecurityAudit(c, c.GetInt("id"), "user.telegram_bot_recovery_confirm", map[string]any{"success": succeeded})
	}()
	identity, ok := requireBrowserSession(c)
	if !ok {
		return
	}
	var input struct {
		FlowToken string `json:"flow_token"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || len(input.FlowToken) != 43 {
		common.ApiErrorT(c, "Invalid request")
		return
	}
	if err := model.ConfirmTelegramBotRecovery(input.FlowToken, identity); err != nil {
		telegramBotError(c, model.ErrTelegramBotExpired)
		return
	}
	common.ApiSuccess(c, nil)
	succeeded = true
}

func telegramBotConfigResponse(cfg *model.TelegramBotConfig) gin.H {
	var inbox, outbox int64
	model.DB.Model(&model.TelegramBotInbox{}).Where("status IN ?", []string{"pending", "processing"}).Count(&inbox)
	model.DB.Model(&model.TelegramBotOutbox{}).Where("status IN ?", []string{"pending", "processing"}).Count(&outbox)
	return gin.H{"enabled": cfg.Enabled, "token_configured": cfg.Token != "", "bot_id": strconv.FormatInt(cfg.BotID, 10), "bot_username": cfg.BotUsername, "version": cfg.Version, "webhook_url": cfg.WebhookURL, "webhook_status": cfg.WebhookStatus, "last_error": cfg.LastError, "pending_inbox": inbox, "pending_outbox": outbox}
}

func GetTelegramBotConfig(c *gin.Context) {
	cfg, err := model.GetTelegramBotConfig()
	if err != nil {
		telegramBotError(c, err)
		return
	}
	common.ApiSuccess(c, telegramBotConfigResponse(cfg))
}

func SaveTelegramBotConfig(c *gin.Context) {
	succeeded := false
	var savedBotID int64
	var savedVersion int64
	defer func() {
		recordUserSecurityAudit(c, c.GetInt("id"), "telegram_bot.config_update", map[string]any{"success": succeeded, "bot_id": strconv.FormatInt(savedBotID, 10), "version": savedVersion})
	}()
	if _, ok := requireBrowserSession(c); !ok {
		return
	}
	var input struct {
		Enabled  bool   `json:"enabled"`
		BotToken string `json:"bot_token"`
		Version  int64  `json:"version"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || len(input.BotToken) > 256 {
		common.ApiErrorT(c, "Invalid request")
		return
	}
	cfg, err := service.SaveTelegramBotConfig(c.Request.Context(), input.Enabled, strings.TrimSpace(input.BotToken), input.Version)
	if err != nil {
		telegramBotError(c, err)
		return
	}
	common.ApiSuccess(c, telegramBotConfigResponse(cfg))
	savedBotID = cfg.BotID
	savedVersion = cfg.Version
	succeeded = true
}
