package service

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

var telegramBotTokenPattern = regexp.MustCompile(`^[0-9]{5,20}:[A-Za-z0-9_-]{20,180}$`)
var telegramBotStartOnce sync.Once
var telegramBotHTTPClient = &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}

type TelegramBotAPIError struct {
	Code                 int
	RetryAfter           int64
	RecipientUnavailable bool
}

func (e *TelegramBotAPIError) Error() string {
	return "Telegram bot request failed. Please try again later."
}

type telegramBotUser struct {
	ID       int64  `json:"id"`
	IsBot    bool   `json:"is_bot"`
	Username string `json:"username"`
}
type telegramBotChat struct {
	ID   int64  `json:"id"`
	Type string `json:"type"`
}
type telegramBotMessage struct {
	MessageID int64           `json:"message_id"`
	From      telegramBotUser `json:"from"`
	Chat      telegramBotChat `json:"chat"`
	Date      int64           `json:"date"`
	Text      string          `json:"text"`
}

type telegramBotReply struct {
	Text        string         `json:"text"`
	ReplyMarkup map[string]any `json:"reply_markup,omitempty"`
}

// TelegramBotCall 不传播包含令牌的 URL、Telegram 描述或完整响应到日志和用户界面。
func TelegramBotCall(ctx context.Context, cfg *model.TelegramBotConfig, method string, payload any, result any) error {
	data, err := common.Marshal(payload)
	if err != nil {
		return common.NewMessage("Telegram bot request failed. Please try again later.")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.telegram.org/bot"+cfg.Token+"/"+method, bytes.NewReader(data))
	if err != nil {
		return common.NewMessage("Telegram bot request failed. Please try again later.")
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := telegramBotHTTPClient.Do(req)
	if err != nil {
		return common.NewMessage("Telegram bot request failed. Please try again later.")
	}
	defer resp.Body.Close()
	data, err = io.ReadAll(io.LimitReader(resp.Body, 1024*1024+1))
	if err != nil || len(data) > 1024*1024 {
		return common.NewMessage("Telegram bot request failed. Please try again later.")
	}
	var envelope struct {
		OK          bool            `json:"ok"`
		ErrorCode   int             `json:"error_code"`
		Description string          `json:"description"`
		Result      json.RawMessage `json:"result"`
		Parameters  struct {
			RetryAfter int64 `json:"retry_after"`
		} `json:"parameters"`
	}
	if err := common.Unmarshal(data, &envelope); err != nil {
		return common.NewMessage("Telegram bot request failed. Please try again later.")
	}
	if !envelope.OK || resp.StatusCode != http.StatusOK {
		code := envelope.ErrorCode
		if code == 0 {
			code = resp.StatusCode
		}
		description := strings.ToLower(envelope.Description)
		unavailable := code == 403 || (code == 400 && (strings.Contains(description, "chat not found") || strings.Contains(description, "user not found") || strings.Contains(description, "user is deactivated")))
		return &TelegramBotAPIError{Code: code, RetryAfter: envelope.Parameters.RetryAfter, RecipientUnavailable: unavailable}
	}
	if result != nil {
		if err := common.Unmarshal(envelope.Result, result); err != nil {
			return common.NewMessage("Telegram bot request failed. Please try again later.")
		}
	}
	return nil
}

func TelegramBotWebhookURL() (string, error) {
	base, err := url.Parse(strings.TrimRight(system_setting.ServerAddress, "/"))
	if err != nil || base.Scheme != "https" || base.Host == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return "", common.NewMessage("Telegram bot requires a public HTTPS server address")
	}
	return base.String() + "/api/telegram-bot/webhook", nil
}

// SaveTelegramBotConfig 验证身份后保存配置；回调注册失败保留可诊断状态，不假装启用成功。
func SaveTelegramBotConfig(ctx context.Context, enabled bool, token string, version int64) (*model.TelegramBotConfig, error) {
	previous, err := model.GetTelegramBotConfig()
	if err != nil {
		return nil, err
	}
	if previous.Version != version {
		return nil, model.ErrTelegramBotChanged
	}
	if token == "" {
		token = previous.Token
	}
	cfg := *previous
	cfg.Enabled = enabled
	cfg.Token = strings.TrimSpace(token)
	if !enabled && strings.TrimSpace(token) == previous.Token {
		cfg.WebhookStatus = "disabled"
		cfg.LastError = ""
		return saveTelegramBotConfigRow(&cfg, version, previous.BotID)
	}
	if !telegramBotTokenPattern.MatchString(cfg.Token) {
		return nil, common.NewMessage("Telegram bot token is invalid")
	}
	var me telegramBotUser
	if err := TelegramBotCall(ctx, &cfg, "getMe", struct{}{}, &me); err != nil {
		return nil, common.NewMessage("Telegram bot token is invalid")
	}
	if !me.IsBot || me.ID <= 0 || me.Username == "" {
		return nil, common.NewMessage("Telegram bot token is invalid")
	}
	login := system_setting.GetTelegramSettings()
	if enabled && (!login.IsConfigured() || strings.TrimSpace(login.ClientID) != strconv.FormatInt(me.ID, 10)) {
		return nil, common.NewMessage("Telegram bot and Telegram login must use the same bot")
	}
	cfg.BotID = me.ID
	cfg.BotUsername = me.Username
	if enabled {
		webhookURL, err := TelegramBotWebhookURL()
		if err != nil {
			return nil, err
		}
		cfg.WebhookURL = webhookURL
		var info struct {
			URL string `json:"url"`
		}
		if err := TelegramBotCall(ctx, &cfg, "getWebhookInfo", struct{}{}, &info); err != nil {
			return nil, err
		}
		if info.URL != "" && info.URL != webhookURL {
			return nil, common.NewMessage("This Telegram bot already has another webhook")
		}
	}
	if cfg.WebhookSecret == "" || previous.BotID != cfg.BotID {
		cfg.WebhookSecret = common.GetRandomString(64)
	}
	cfg.WebhookStatus = "disabled"
	if enabled {
		cfg.WebhookStatus = "pending"
	}
	cfg.LastError = ""
	saved, err := saveTelegramBotConfigRow(&cfg, version, previous.BotID)
	if err != nil {
		return nil, err
	}
	if !enabled {
		return saved, nil
	}
	if err := registerTelegramBotWebhook(ctx, saved); err != nil {
		return nil, err
	}
	return saved, nil
}

// registerTelegramBotWebhook 只更新回调诊断，注册重试不改变配置版本和身份。
func registerTelegramBotWebhook(ctx context.Context, cfg *model.TelegramBotConfig) error {
	if err := TelegramBotCall(ctx, cfg, "setWebhook", map[string]any{"url": cfg.WebhookURL, "secret_token": cfg.WebhookSecret, "allowed_updates": []string{"message", "callback_query", "my_chat_member"}, "drop_pending_updates": false}, nil); err != nil {
		cfg.WebhookStatus = "error"
		cfg.LastError = "Telegram bot request failed. Please try again later."
	} else {
		cfg.WebhookStatus = "ready"
		cfg.LastError = ""
	}
	result := model.DB.Model(&model.TelegramBotConfig{}).Where("id = ? AND version = ?", 1, cfg.Version).Updates(map[string]any{"webhook_status": cfg.WebhookStatus, "last_error": cfg.LastError})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		current, err := model.GetTelegramBotConfig()
		if err != nil {
			return err
		}
		if current.Version == cfg.Version {
			// MySQL 对同值更新可能返回零行，不能据此误判配置冲突。
			*cfg = *current
			return nil
		}
		// 旧请求可能最后到达 Telegram；让当前同一机器人的配置重新收敛到最新密钥。
		if err := model.DB.Model(&model.TelegramBotConfig{}).Where("id = ? AND version <> ? AND bot_id = ? AND enabled = ?", 1, cfg.Version, cfg.BotID, true).Updates(map[string]any{"webhook_status": "pending", "last_error": ""}).Error; err != nil {
			return err
		}
		return model.ErrTelegramBotChanged
	}
	return nil
}

func saveTelegramBotConfigRow(cfg *model.TelegramBotConfig, version, previousBotID int64) (*model.TelegramBotConfig, error) {
	// 凭据写入禁止 SQL 调试日志输出参数，避免 DEBUG 模式泄露机器人令牌。
	err := model.DB.Session(&gorm.Session{Logger: gormlogger.Discard}).Transaction(func(tx *gorm.DB) error {
		if version == 0 {
			cfg.ID = 1
			cfg.Version = 1
			cfg.UpdatedAt = time.Now().Unix()
			if err := tx.Create(cfg).Error; err != nil {
				return model.ErrTelegramBotChanged
			}
			return nil
		}
		cfg.Version = version + 1
		cfg.UpdatedAt = time.Now().Unix()
		result := tx.Model(&model.TelegramBotConfig{}).Where("id = ? AND version = ?", 1, version).Select("*").Omit("id").Updates(cfg)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return model.ErrTelegramBotChanged
		}
		if previousBotID != cfg.BotID {
			return model.InvalidateTelegramBotIdentityTx(tx, previousBotID)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if err := model.UpdateOption("telegram_bot.enabled", strconv.FormatBool(cfg.Enabled)); err != nil {
		return nil, err
	}
	system_setting.SetTelegramBotEnabled(cfg.Enabled)
	return cfg, nil
}

// ReceiveTelegramBotUpdate 只将受信私聊中的规范命令持久化，拒绝原始凭据落库。
func ReceiveTelegramBotUpdate(cfg *model.TelegramBotConfig, secret string, data []byte) error {
	if cfg.WebhookSecret == "" || subtle.ConstantTimeCompare([]byte(secret), []byte(cfg.WebhookSecret)) != 1 {
		return model.ErrTelegramBotExpired
	}
	var update struct {
		UpdateID int64               `json:"update_id"`
		Message  *telegramBotMessage `json:"message"`
		Callback *struct {
			ID      string              `json:"id"`
			From    telegramBotUser     `json:"from"`
			Message *telegramBotMessage `json:"message"`
			Data    string              `json:"data"`
		} `json:"callback_query"`
		Member *struct {
			From telegramBotUser `json:"from"`
			Chat telegramBotChat `json:"chat"`
			Date int64           `json:"date"`
			New  struct {
				Status string `json:"status"`
			} `json:"new_chat_member"`
		} `json:"my_chat_member"`
	}
	if err := common.Unmarshal(data, &update); err != nil {
		return common.NewMessage("Invalid request")
	}
	if update.UpdateID < 0 {
		return common.NewMessage("Invalid request")
	}
	inbox := &model.TelegramBotInbox{BotID: cfg.BotID, UpdateID: update.UpdateID}
	message := update.Message
	if update.Callback != nil {
		if update.Callback.Message == nil {
			return nil
		}
		message = update.Callback.Message
		message.From = update.Callback.From
		message.Date = time.Now().Unix()
		inbox.Command = "/notify"
		if !strings.HasPrefix(update.Callback.Data, "n:") || len(update.Callback.Data) > 128 {
			return nil
		}
		inbox.Argument = update.Callback.Data
	}
	if update.Member != nil {
		if update.Member.Chat.Type != "private" || update.Member.From.IsBot {
			return nil
		}
		if update.Member.New.Status != "kicked" {
			return nil
		}
		inbox.Command = "/blocked"
		inbox.TelegramID = strconv.FormatInt(update.Member.From.ID, 10)
		inbox.ChatID = strconv.FormatInt(update.Member.Chat.ID, 10)
		inbox.MessageAt = update.Member.Date
		return model.AcceptTelegramBotInbox(inbox)
	}
	if message == nil || message.Chat.Type != "private" || message.From.IsBot || message.From.ID <= 0 || message.Chat.ID <= 0 {
		return nil
	}
	inbox.TelegramID = strconv.FormatInt(message.From.ID, 10)
	inbox.ChatID = strconv.FormatInt(message.Chat.ID, 10)
	inbox.MessageAt = message.Date
	if inbox.Command == "" {
		parts := strings.Fields(message.Text)
		if len(parts) == 0 {
			return nil
		}
		command, _, _ := strings.Cut(strings.ToLower(parts[0]), "@")
		switch command {
		case "/start", "/help", "/balance", "/usage", "/subs", "/checkin", "/notify":
			inbox.Command = command
		default:
			return nil
		}
		if command == "/start" && len(parts) == 2 {
			if token, ok := strings.CutPrefix(parts[1], "tg_"); ok && len(token) == 43 {
				inbox.FlowHash = token
			}
		}
		if command == "/notify" && len(parts) == 3 && len(parts[1]) < 24 && (parts[2] == "on" || parts[2] == "off") {
			inbox.Argument = parts[1] + ":" + parts[2]
		}
		if command == "/subs" && len(parts) == 2 {
			page, err := strconv.Atoi(parts[1])
			if err != nil || page < 1 || page > 10000 {
				return nil
			}
			inbox.Argument = strconv.Itoa(page)
		}
	}
	return model.AcceptTelegramBotInbox(inbox)
}

func StartTelegramBotWorker() {
	telegramBotStartOnce.Do(func() {
		if cfg, err := model.GetTelegramBotConfig(); err == nil {
			system_setting.SetTelegramBotEnabled(cfg.Enabled)
		}
		go func() {
			inboxTicker := time.NewTicker(2 * time.Second)
			outboxTicker := time.NewTicker(2 * time.Second)
			reminderTicker := time.NewTicker(time.Minute)
			webhookTicker := time.NewTicker(30 * time.Second)
			defer inboxTicker.Stop()
			defer outboxTicker.Stop()
			defer reminderTicker.Stop()
			defer webhookTicker.Stop()
			runTelegramBotWorker(context.Background(), inboxTicker.C, outboxTicker.C, reminderTicker.C, webhookTicker.C)
		}()
	})
}

// runTelegramBotWorker 将收件、发件和提醒扫描分开，网络重试不会拖延用户命令。
func runTelegramBotWorker(ctx context.Context, inboxTicks, outboxTicks, reminderTicks, webhookTicks <-chan time.Time) {
	var workers sync.WaitGroup
	workers.Go(func() {
		owner := common.GetUUID()
		for {
			select {
			case <-ctx.Done():
				return
			case <-inboxTicks:
			}
			cfg, err := model.GetTelegramBotConfig()
			if err != nil {
				continue
			}
			system_setting.SetTelegramBotEnabled(cfg.Enabled)
			if !cfg.Enabled || cfg.Token == "" {
				continue
			}
			for range 20 {
				if ctx.Err() != nil {
					return
				}
				row, err := model.ClaimTelegramBotInbox(owner)
				if err != nil || row == nil {
					break
				}
				err = processTelegramBotInbox(cfg, row)
				status := "done"
				if err != nil {
					status = "pending"
					if row.Attempts >= 10 || time.Now().Unix()-row.ReceivedAt > 300 {
						status = "failed"
					}
				}
				if err := model.FinishTelegramBotInbox(row, status); err != nil {
					common.SysError("Telegram bot inbox state update failed")
				}
			}
		}
	})
	workers.Go(func() {
		owner := common.GetUUID()
		for {
			select {
			case <-ctx.Done():
				return
			case <-outboxTicks:
			}
			cfg, err := model.GetTelegramBotConfig()
			if err != nil || !cfg.Enabled || cfg.Token == "" {
				continue
			}
			for range 20 {
				if ctx.Err() != nil {
					return
				}
				row, err := model.ClaimTelegramBotOutbox(owner)
				if err != nil || row == nil {
					break
				}
				sendTelegramBotOutbox(ctx, cfg, row)
			}
		}
	})
	workers.Go(func() {
		for {
			cfg, err := model.GetTelegramBotConfig()
			if err == nil && cfg.Enabled && cfg.Token != "" && ctx.Err() == nil {
				scanContext, cancel := context.WithTimeout(ctx, 45*time.Second)
				if err := ScanTelegramBusinessReminders(scanContext); err != nil && ctx.Err() == nil {
					common.SysError("Telegram bot reminder scan failed")
				}
				cancel()
			}
			select {
			case <-ctx.Done():
				return
			case <-reminderTicks:
			}
		}
	})
	workers.Go(func() {
		for {
			cfg, err := model.GetTelegramBotConfig()
			if err == nil && cfg.Enabled && cfg.Token != "" && (cfg.WebhookStatus == "pending" || cfg.WebhookStatus == "error") && ctx.Err() == nil {
				registrationContext, cancel := context.WithTimeout(ctx, 20*time.Second)
				if err := registerTelegramBotWebhook(registrationContext, cfg); err != nil && !errors.Is(err, model.ErrTelegramBotChanged) && ctx.Err() == nil {
					common.SysError("Telegram bot webhook registration state update failed")
				}
				cancel()
			}
			select {
			case <-ctx.Done():
				return
			case <-webhookTicks:
			}
		}
	})
	workers.Wait()
}

func telegramBotAccount(cfg *model.TelegramBotConfig, row *model.TelegramBotInbox) (*model.User, *model.TelegramBotConnection, error) {
	conn, err := model.GetTelegramBotConnection(row.UserID)
	if err != nil {
		return nil, nil, err
	}
	if conn.BotID != cfg.BotID || conn.TelegramID != row.TelegramID || conn.ChatID != row.ChatID || conn.Version != row.ConnectionVersion || conn.Status != model.TelegramBotConnected {
		return nil, nil, model.ErrTelegramBotNotConnected
	}
	user, err := model.GetUserById(conn.UserID, true)
	if err != nil {
		return nil, nil, err
	}
	if user.Status != common.UserStatusEnabled || user.TelegramId != conn.TelegramID {
		return nil, nil, model.ErrTelegramBotNotConnected
	}
	return user, conn, nil
}

func processTelegramBotInbox(cfg *model.TelegramBotConfig, row *model.TelegramBotInbox) error {
	if row.BotID != cfg.BotID {
		return nil
	}
	if row.Command == "/start" && row.FlowHash != "" {
		return model.ObserveTelegramBotRecovery(row.FlowHash, row.TelegramID, row.ChatID, cfg)
	}
	if row.Command == "/start" && row.UserID > 0 && row.MessageAt <= time.Now().Unix()+30 && row.MessageAt >= time.Now().Unix()-300 {
		restored, err := model.ApplyTelegramBotStateEvent(row, false)
		if err != nil {
			return err
		}
		if restored {
			return nil
		}
	}
	if row.Command == "/blocked" {
		_, err := model.ApplyTelegramBotStateEvent(row, true)
		return err
	}
	user, conn, err := telegramBotAccount(cfg, row)
	if err != nil {
		if errors.Is(err, model.ErrTelegramBotNotConnected) || errors.Is(err, gorm.ErrRecordNotFound) {
			if (row.Command == "/help" || row.Command == "/start") && row.MessageAt >= time.Now().Unix()-300 && row.MessageAt <= time.Now().Unix()+30 {
				public := &model.TelegramBotConnection{BotID: cfg.BotID, ChatID: row.ChatID}
				return model.DB.Transaction(func(tx *gorm.DB) error {
					return model.EnqueueTelegramBotMessageTx(tx, public, "help", fmt.Sprintf("public-help:%d:%s:%d", cfg.BotID, row.TelegramID, row.ReceivedAt/60), "", row.ReceivedAt+300)
				})
			}
			return nil
		}
		return err
	}
	var existing model.TelegramBotOutbox
	if err := model.DB.Where("event_key = ?", model.TelegramBotMessageDigest(fmt.Sprintf("reply:%d", row.ID))).First(&existing).Error; err == nil {
		return nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	now := time.Now().Unix()
	var previousCheckin model.Checkin
	hasCheckinResult := false
	if row.Command == "/checkin" {
		err := model.DB.Where("user_id = ? AND checkin_date = ?", user.Id, row.BusinessDate).First(&previousCheckin).Error
		if err == nil {
			hasCheckinResult = true
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
	}
	if !hasCheckinResult && (row.MessageAt > now+30 || now-row.MessageAt > 300) {
		return nil
	}
	if !hasCheckinResult {
		accepted, err := model.AcceptTelegramBotCommand(row)
		if err != nil {
			return err
		}
		if !accepted {
			return nil
		}
	}
	// 机器人私聊统一使用简体中文，独立于网页语言设置。
	lang := i18n.LangZhCN
	var text string
	switch row.Command {
	case "/start", "/help":
		text = i18n.Translate(lang, "telegram.bot.help")
	case "/balance":
		text = i18n.Translate(lang, "telegram.bot.balance", map[string]any{"Amount": logger.FormatQuota(user.Quota)})
	case "/usage":
		text = telegramBotUsage(user, lang)
	case "/subs":
		page := 1
		if row.Argument != "" {
			parsed, err := strconv.Atoi(row.Argument)
			if err == nil && parsed > 0 && parsed <= 10000 {
				page = parsed
			}
		}
		text = telegramBotSubscriptions(user, lang, page)
	case "/checkin":
		if hasCheckinResult {
			text = i18n.Translate(lang, "telegram.bot.checkin_success", map[string]any{"Date": previousCheckin.CheckinDate, "Amount": logger.FormatQuota(previousCheckin.QuotaAwarded)})
			break
		}
		if common.TurnstileCheckEnabled {
			text = i18n.Translate(lang, "telegram.bot.checkin_verify", map[string]any{"URL": strings.TrimRight(system_setting.ServerAddress, "/") + "/profile"})
			break
		}
		var checkin model.Checkin
		err := model.DB.Where("user_id = ? AND checkin_date = ?", user.Id, row.BusinessDate).First(&checkin).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if row.BusinessDate != model.CheckinBusinessDate(time.Now()) {
				text = i18n.Translate(lang, "telegram.bot.command_expired")
				break
			}
			result, checkinErr := model.UserCheckinForTelegram(user.Id, row.BusinessDate, cfg.BotID, row.TelegramID, row.ConnectionVersion)
			if checkinErr != nil {
				if err := model.DB.Where("user_id = ? AND checkin_date = ?", user.Id, row.BusinessDate).First(&checkin).Error; err != nil {
					text = i18n.Translate(lang, "telegram.bot.checkin_unavailable")
					break
				}
			} else {
				checkin = *result
				model.RecordLog(user.Id, model.LogTypeSystem, common.NewMessage("Daily check-in, received {{quota}}", map[string]any{"quota": logger.FormatQuota(checkin.QuotaAwarded)}))
			}
		} else if err != nil {
			return err
		}
		text = i18n.Translate(lang, "telegram.bot.checkin_success", map[string]any{"Date": checkin.CheckinDate, "Amount": logger.FormatQuota(checkin.QuotaAwarded)})
	case "/notify":
		return telegramBotUpdateNotification(cfg, row, conn, lang)
	default:
		return nil
	}
	return model.DB.Transaction(func(tx *gorm.DB) error {
		return model.EnqueueTelegramBotMessageTx(tx, conn, "reply", fmt.Sprintf("reply:%d", row.ID), text, max(row.ReceivedAt+300, now+300))
	})
}

func telegramBotUsage(user *model.User, lang string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	date := model.CheckinBusinessDate(time.Now())
	start, err := time.ParseInLocation("2006-01-02", date, time.Local)
	if err != nil || !common.LogConsumeEnabled {
		return i18n.Translate(lang, "telegram.bot.stats_unavailable")
	}
	var stats struct {
		Quota    int64
		Requests int64
	}
	err = model.LOG_DB.WithContext(ctx).Model(&model.Log{}).Select("COALESCE(SUM(quota), 0) AS quota, COUNT(*) AS requests").Where("user_id = ? AND type = ? AND created_at >= ? AND created_at < ?", user.Id, model.LogTypeConsume, start.Unix(), start.AddDate(0, 0, 1).Unix()).Scan(&stats).Error
	if err != nil {
		return i18n.Translate(lang, "telegram.bot.stats_unavailable")
	}
	return i18n.Translate(lang, "telegram.bot.usage", map[string]any{"Date": date, "Zone": time.Local.String(), "TodayAmount": logger.FormatQuota(int(stats.Quota)), "TodayRequests": stats.Requests, "TotalAmount": logger.FormatQuota(user.UsedQuota), "TotalRequests": user.RequestCount})
}

func telegramBotSubscriptions(user *model.User, lang string, page int) string {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var subs []model.UserSubscription
	if page < 1 || page > 10000 {
		return i18n.Translate(lang, "telegram.bot.stats_unavailable")
	}
	if err := model.DB.WithContext(ctx).Where("user_id = ? AND status = ? AND (end_time = 0 OR end_time > ?)", user.Id, "active", time.Now().Unix()).Order("id desc").Offset((page - 1) * 5).Limit(6).Find(&subs).Error; err != nil {
		return i18n.Translate(lang, "telegram.bot.stats_unavailable")
	}
	if len(subs) == 0 {
		return i18n.Translate(lang, "telegram.bot.no_subscriptions")
	}
	var text strings.Builder
	text.WriteString(i18n.Translate(lang, "telegram.bot.subscription_page", map[string]any{"Page": page}) + "\n")
	for i, sub := range subs {
		if i == 5 {
			text.WriteString("\n" + i18n.Translate(lang, "telegram.bot.subscription_next", map[string]any{"Page": page + 1}))
			break
		}
		var plan model.SubscriptionPlan
		if err := model.DB.WithContext(ctx).First(&plan, sub.PlanId).Error; err != nil {
			return i18n.Translate(lang, "telegram.bot.stats_unavailable")
		}
		remaining := i18n.Translate(lang, "telegram.bot.unlimited")
		if sub.AmountTotal > 0 {
			remaining = logger.FormatQuota(int(max(0, sub.AmountTotal-sub.AmountUsed)))
		}
		end := i18n.Translate(lang, "telegram.bot.no_expiry")
		if sub.EndTime > 0 {
			end = time.Unix(sub.EndTime, 0).In(time.Local).Format("2006-01-02 15:04 MST")
		}
		text.WriteString(i18n.Translate(lang, "telegram.bot.subscription_row", map[string]any{"Title": plan.Title, "Remaining": remaining, "End": end}) + "\n")
	}
	text.WriteString("\n" + i18n.Translate(lang, "telegram.bot.more_subscriptions", map[string]any{"URL": strings.TrimRight(system_setting.ServerAddress, "/") + "/subscriptions"}))
	return strings.TrimSpace(text.String())
}

func telegramBotUpdateNotification(cfg *model.TelegramBotConfig, row *model.TelegramBotInbox, conn *model.TelegramBotConnection, lang string) error {
	return model.DB.Transaction(func(tx *gorm.DB) error {
		prefs := conn.Preferences
		if row.Argument != "" {
			argument := row.Argument
			if strings.HasPrefix(argument, "n:") {
				parts := strings.Split(argument, ":")
				if len(parts) != 7 {
					return nil
				}
				version, err := strconv.ParseInt(parts[3], 36, 64)
				if err != nil || version != conn.PreferencesVersion {
					return nil
				}
				connectionVersion, err := strconv.ParseInt(parts[4], 36, 64)
				if err != nil || connectionVersion != conn.Version {
					return nil
				}
				expires, err := strconv.ParseInt(parts[5], 36, 64)
				if err != nil || expires < time.Now().Unix() || expires > time.Now().Unix()+330 {
					return nil
				}
				body := strings.Join(parts[:6], ":")
				mac := common.GenerateHMACWithKey([]byte(cfg.WebhookSecret), fmt.Sprintf("%d:%d:%s:%s:%s", cfg.BotID, conn.UserID, conn.TelegramID, conn.ChatID, body))[:24]
				if subtle.ConstantTimeCompare([]byte(parts[6]), []byte(mac)) != 1 {
					return nil
				}
				field := map[string]string{"e": "enabled", "l": "low_balance", "t": "topup", "s": "subscription", "x": "expiry"}[parts[1]]
				if field == "" {
					return nil
				}
				argument = field + ":" + parts[2]
			}
			parts := strings.Split(argument, ":")
			if len(parts) != 2 {
				return nil
			}
			value := parts[1] == "on"
			if parts[1] != "on" && parts[1] != "off" {
				return nil
			}
			switch parts[0] {
			case "enabled":
				prefs.Enabled = value
			case "low_balance":
				prefs.LowBalance = value
			case "topup":
				prefs.TopUp = value
			case "subscription":
				prefs.Subscription = value
			case "expiry":
				prefs.Expiry = value
			default:
				return nil
			}
			if err := model.UpdateTelegramBotPreferencesTx(tx, conn.UserID, conn.PreferencesVersion, prefs); err != nil {
				return err
			}
			if err := tx.First(conn, "user_id = ?", conn.UserID).Error; err != nil {
				return err
			}
		}
		on := i18n.Translate(lang, "telegram.bot.on")
		off := i18n.Translate(lang, "telegram.bot.off")
		values := map[string]any{}
		for key, value := range map[string]bool{"Enabled": prefs.Enabled, "LowBalance": prefs.LowBalance, "TopUp": prefs.TopUp, "Subscription": prefs.Subscription, "Expiry": prefs.Expiry} {
			values[key] = off
			if value {
				values[key] = on
			}
		}
		text := i18n.Translate(lang, "telegram.bot.notify", values)
		buttons := make([][]map[string]string, 0, 5)
		for _, setting := range []struct {
			Field string
			Label string
			Value bool
		}{{"enabled", "telegram.bot.notify_enabled", prefs.Enabled}, {"low_balance", "telegram.bot.notify_low_balance", prefs.LowBalance}, {"topup", "telegram.bot.notify_topup", prefs.TopUp}, {"subscription", "telegram.bot.notify_subscription", prefs.Subscription}, {"expiry", "telegram.bot.notify_expiry", prefs.Expiry}} {
			target := "on"
			action := on
			if setting.Value {
				target = "off"
				action = off
			}
			field := map[string]string{"enabled": "e", "low_balance": "l", "topup": "t", "subscription": "s", "expiry": "x"}[setting.Field]
			body := fmt.Sprintf("n:%s:%s:%s:%s:%s", field, target, strconv.FormatInt(conn.PreferencesVersion, 36), strconv.FormatInt(conn.Version, 36), strconv.FormatInt(time.Now().Unix()+300, 36))
			mac := common.GenerateHMACWithKey([]byte(cfg.WebhookSecret), fmt.Sprintf("%d:%d:%s:%s:%s", cfg.BotID, conn.UserID, conn.TelegramID, conn.ChatID, body))[:24]
			buttons = append(buttons, []map[string]string{{"text": i18n.Translate(lang, setting.Label) + ": " + action, "callback_data": body + ":" + mac}})
		}
		payload, err := common.Marshal(telegramBotReply{Text: text, ReplyMarkup: map[string]any{"inline_keyboard": buttons}})
		if err != nil {
			return err
		}
		return model.EnqueueTelegramBotMessageTx(tx, conn, "reply", fmt.Sprintf("reply:%d", row.ID), string(payload), row.ReceivedAt+300)
	})
}

func sendTelegramBotOutbox(ctx context.Context, snapshot *model.TelegramBotConfig, row *model.TelegramBotOutbox) {
	now := time.Now().Unix()
	finish := func(status, reason string, retryAfter int64) {
		if err := model.FinishTelegramBotOutbox(row, status, reason, retryAfter); err != nil {
			common.SysError("Telegram bot outbox state update failed")
		}
	}
	if row.ExpiresAt <= now || row.Attempts > 10 {
		finish("failed", "expired", 0)
		return
	}
	cfg, err := model.GetTelegramBotConfig()
	if err != nil {
		finish("pending", "configuration unavailable", 30)
		return
	}
	if !cfg.Enabled {
		finish("pending", "bot paused", 300)
		return
	}
	if cfg.BotID != snapshot.BotID || row.BotID != cfg.BotID {
		finish("discarded", "bot unavailable", 0)
		return
	}
	conn, err := model.GetTelegramBotConnection(row.UserID)
	if err != nil {
		finish("pending", "connection unavailable", 30)
		return
	}
	if row.Kind != "help" && (conn.BotID != row.BotID || conn.Version != row.ConnectionVersion || conn.ChatID != row.ChatID || (conn.Status != model.TelegramBotConnected && !(row.Kind == "connect" && conn.Status == model.TelegramBotConnecting))) {
		finish("discarded", "connection changed", 0)
		return
	}
	if row.Kind == "connect" && conn.Status == model.TelegramBotConnected {
		finish("sent", "", 0)
		return
	}
	var user *model.User
	if row.Kind == "help" {
		user = &model.User{}
		err = nil
	} else {
		user, err = model.GetUserById(row.UserID, true)
	}
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			finish("discarded", "account unavailable", 0)
		} else {
			finish("pending", "account unavailable", 30)
		}
		return
	}
	if row.Kind != "help" && (user.Status != common.UserStatusEnabled || user.TelegramId != conn.TelegramID) {
		finish("discarded", "account unavailable", 0)
		return
	}
	lang := i18n.LangZhCN
	text := row.Payload
	if row.Kind == "help" {
		text = i18n.Translate(lang, "telegram.bot.not_connected", map[string]any{"URL": strings.TrimRight(system_setting.ServerAddress, "/") + "/security"})
	}
	var replyMarkup map[string]any
	if row.Kind == "reply" && strings.HasPrefix(row.Payload, "{") {
		var reply telegramBotReply
		if err := common.UnmarshalJsonStr(row.Payload, &reply); err != nil {
			finish("failed", "invalid reply", 0)
			return
		}
		text = reply.Text
		replyMarkup = reply.ReplyMarkup
	}
	if row.Kind == "connect" || row.Kind == "welcome" {
		text = i18n.Translate(lang, "telegram.bot.connected")
	}
	if row.Kind == "test" {
		text = i18n.Translate(lang, "telegram.bot.test")
	}
	if row.Kind != "connect" && row.Kind != "welcome" && row.Kind != "reply" && row.Kind != "test" && row.Kind != "help" {
		selected, version := conn.EventPreference(row.Kind)
		if !conn.Preferences.Enabled || !selected || conn.EnabledVersion != row.EnabledVersion || version != row.PreferenceVersion {
			finish("discarded", "notification disabled", 0)
			return
		}
		var event model.TelegramBusinessEvent
		if err := common.UnmarshalJsonStr(row.Payload, &event); err != nil {
			finish("failed", "invalid event", 0)
			return
		}
		valid, err := model.TelegramBusinessEventStillValid(&event)
		if err != nil {
			finish("pending", "business state unavailable", 30)
			return
		}
		if !valid {
			finish("discarded", "event expired", 0)
			return
		}
		if row.Kind == "expiry" && row.BusinessKey != "" {
			var sent int64
			if err := model.DB.Model(&model.TelegramBotOutbox{}).Where("business_key = ? AND status = ? AND id <> ?", row.BusinessKey, "sent", row.ID).Count(&sent).Error; err != nil {
				finish("pending", "delivery state unavailable", 30)
				return
			}
			if sent > 0 {
				finish("discarded", "event already delivered", 0)
				return
			}
		}
		text = telegramBusinessMessage(lang, &event)
	}
	if len([]rune(text)) > 3900 {
		text = string([]rune(text)[:3700]) + "\n" + strings.TrimRight(system_setting.ServerAddress, "/") + "/console"
	}
	var sent telegramBotMessage
	request := map[string]any{"chat_id": row.ChatID, "text": text, "link_preview_options": map[string]bool{"is_disabled": true}}
	if replyMarkup != nil {
		request["reply_markup"] = replyMarkup
	}
	if ctx.Err() != nil {
		return
	}
	owned, err := model.AuthorizeTelegramBotSend(row)
	if err != nil {
		finish("pending", "authorization unavailable", 30)
		return
	}
	if !owned {
		current, err := model.GetTelegramBotConfig()
		if err != nil {
			finish("pending", "configuration unavailable", 30)
		} else if current.BotID == row.BotID && !current.Enabled {
			finish("pending", "bot paused", 300)
		} else {
			finish("discarded", "delivery authorization changed", 0)
		}
		return
	}
	err = TelegramBotCall(ctx, cfg, "sendMessage", request, &sent)
	if err != nil {
		var apiErr *TelegramBotAPIError
		if errors.As(err, &apiErr) {
			if apiErr.Code == 401 {
				_ = model.DB.Model(&model.TelegramBotConfig{}).Where("id = ? AND version = ?", 1, cfg.Version).Updates(map[string]any{"enabled": false, "webhook_status": "error", "last_error": "Telegram bot token is invalid"}).Error
				finish("pending", "bot authentication failed", 300)
				return
			}
			if apiErr.RecipientUnavailable {
				_ = model.DB.Model(&model.TelegramBotConnection{}).Where("user_id = ? AND bot_id = ? AND version = ? AND status = ? AND last_state_event_at = ? AND last_state_update_id = ?", conn.UserID, conn.BotID, conn.Version, conn.Status, conn.LastStateEventAt, conn.LastStateUpdateID).Updates(map[string]any{"status": model.TelegramBotBlocked, "last_error": "Telegram bot is not connected"}).Error
				finish("failed", "chat unavailable", 0)
				return
			}
			if apiErr.Code == 400 {
				finish("failed", "invalid message request", 0)
				return
			}
			if apiErr.Code == 429 {
				finish("pending", "rate limited", max(1, apiErr.RetryAfter))
				return
			}
		}
		finish("pending", "temporary delivery failure", min(3600, int64(5)*(1<<min(row.Attempts, 9))))
		return
	}
	if sent.Chat.Type != "private" || strconv.FormatInt(sent.Chat.ID, 10) != row.ChatID || sent.From.ID != cfg.BotID || !sent.From.IsBot {
		finish("failed", "unexpected recipient", 0)
		return
	}
	if row.Kind == "connect" {
		err = model.ConfirmTelegramBotConnection(conn, sent.Chat.ID)
		if err != nil {
			finish("pending", "connection confirmation failed", 30)
			return
		}
	}
	finish("sent", "", 0)
}

func telegramBusinessMessage(lang string, event *model.TelegramBusinessEvent) string {
	params := map[string]any{"Amount": logger.FormatQuota(int(event.AmountQuota)), "Balance": logger.FormatQuota(int(event.BalanceQuota)), "Title": event.Title, "Source": event.Source, "Time": time.Unix(event.OccurredAt, 0).In(time.Local).Format("2006-01-02 15:04 MST"), "End": time.Unix(event.ExpiresAt, 0).In(time.Local).Format("2006-01-02 15:04 MST")}
	return i18n.Translate(lang, "telegram.bot.event."+event.Kind, params)
}
