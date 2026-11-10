package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type telegramBotRoundTripper func(*http.Request) (*http.Response, error)

func (fn telegramBotRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func setupTelegramBotServiceTest(t *testing.T) (*model.User, *model.TelegramBotConfig, *model.TelegramBotConnection) {
	t.Helper()
	user := setupAuthSessionTestDB(t)
	useTestSessionSecret(t)
	previousLogs := model.LOG_DB
	previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
	previousBot := *system_setting.GetTelegramBotSettings()
	previousEnabled := system_setting.TelegramBotEnabled()
	previousLogin := *system_setting.GetTelegramSettings()
	previousAddress := system_setting.ServerAddress
	previousCheckin := *operation_setting.GetCheckinSetting()
	previousTurnstile := common.TurnstileCheckEnabled
	previousClient := telegramBotHTTPClient
	common.OptionMapRWMutex.Lock()
	previousOptions := common.OptionMap
	common.OptionMap = make(map[string]string)
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		model.LOG_DB = previousLogs
		common.SetDatabaseTypes(previousMain, previousLog)
		*system_setting.GetTelegramBotSettings() = previousBot
		system_setting.SetTelegramBotEnabled(previousEnabled)
		*system_setting.GetTelegramSettings() = previousLogin
		system_setting.ServerAddress = previousAddress
		*operation_setting.GetCheckinSetting() = previousCheckin
		common.TurnstileCheckEnabled = previousTurnstile
		telegramBotHTTPClient = previousClient
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptions
		common.OptionMapRWMutex.Unlock()
	})
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	model.LOG_DB = model.DB
	system_setting.SetTelegramBotEnabled(true)
	common.TurnstileCheckEnabled = false
	require.NoError(t, model.DB.AutoMigrate(&model.TelegramBotConfig{}, &model.TelegramBotConnection{}, &model.TelegramBotInbox{}, &model.TelegramBotOutbox{}, &model.TelegramLowBalanceState{}, &model.Checkin{}, &model.Log{}, &model.Option{}))
	user.TelegramId = "42"
	user.Quota = 2000
	require.NoError(t, model.DB.Save(user).Error)
	cfg := &model.TelegramBotConfig{ID: 1, Enabled: true, BotID: 12345, BotUsername: "test_bot", Token: "12345:unused_test_credential_1234567890", WebhookSecret: "test-webhook-secret", Version: 1}
	require.NoError(t, model.DB.Create(cfg).Error)
	conn := &model.TelegramBotConnection{UserID: user.Id, BotID: cfg.BotID, TelegramID: "42", ChatID: "42", Status: model.TelegramBotConnected, Version: 1, PreferencesVersion: 1, Preferences: model.TelegramBotPreferences{Enabled: true, LowBalance: true, TopUp: true, Subscription: true, Expiry: true}}
	require.NoError(t, model.DB.Create(conn).Error)
	require.NoError(t, i18n.Init())
	telegramBotHTTPClient = &http.Client{Timeout: time.Second, Transport: telegramBotRoundTripper(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, "api.telegram.org", req.URL.Host)
		t.Fatalf("unexpected Bot API call: %s", req.Method)
		return nil, errors.New("unexpected network request")
	})}
	return user, cfg, conn
}

func TestTelegramBotConfigChangesKeepOnlyTheCurrentIdentity(t *testing.T) {
	for _, sameBot := range []bool{false, true} {
		t.Run(strconv.FormatBool(sameBot), func(t *testing.T) {
			_, cfg, conn := setupTelegramBotServiceTest(t)
			system_setting.ServerAddress = "https://example.test"
			login := system_setting.GetTelegramSettings()
			login.ClientSecret = "test-only-client-secret"
			login.ClientID = "12345"
			require.NoError(t, model.DB.Transaction(func(tx *gorm.DB) error {
				return model.EnqueueTelegramBotMessageTx(tx, conn, "test", "before-config-change", "", time.Now().Unix()+300)
			}))
			telegramBotHTTPClient = &http.Client{Transport: telegramBotRoundTripper(func(req *http.Request) (*http.Response, error) {
				body := `{"ok":true,"result":true}`
				switch {
				case strings.HasSuffix(req.URL.Path, "/getMe"):
					botID := int64(12345)
					if strings.HasPrefix(req.URL.Path, "/bot67890:") {
						botID = 67890
					}
					body = fmt.Sprintf(`{"ok":true,"result":{"id":%d,"is_bot":true,"username":"test_bot"}}`, botID)
				case strings.HasSuffix(req.URL.Path, "/getWebhookInfo"):
					body = `{"ok":true,"result":{"url":""}}`
				case !strings.HasSuffix(req.URL.Path, "/setWebhook"):
					t.Errorf("unexpected bot method")
				}
				return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
			})}
			botID := "67890"
			if sameBot {
				botID = "12345"
			}
			login.ClientID = botID
			saved, err := SaveTelegramBotConfig(context.Background(), true, botID+":new_test_credential_1234567890", cfg.Version, nil)
			require.NoError(t, err)
			if !sameBot {
				login.ClientID = "12345"
				_, err = SaveTelegramBotConfig(context.Background(), true, cfg.Token, saved.Version, nil)
				require.NoError(t, err)
			}
			current, err := model.GetTelegramBotConnection(conn.UserID)
			require.NoError(t, err)
			var task model.TelegramBotOutbox
			require.NoError(t, model.DB.First(&task).Error)
			if sameBot {
				assert.Equal(t, model.TelegramBotConnected, current.Status)
				assert.Equal(t, conn.Version, current.Version)
				assert.Equal(t, "pending", task.Status)
			} else {
				assert.Equal(t, model.TelegramBotDisconnected, current.Status)
				assert.Greater(t, current.Version, conn.Version)
				assert.Equal(t, "discarded", task.Status)
			}
		})
	}
}

func TestTelegramBotWebhookRetryPreservesNotificationSettings(t *testing.T) {
	_, cfg, _ := setupTelegramBotServiceTest(t)
	system_setting.ServerAddress = "https://example.test"
	*system_setting.GetTelegramSettings() = system_setting.TelegramSettings{ClientID: "12345", ClientSecret: "test-client-secret"}
	webhookRequests := 0
	telegramBotHTTPClient = &http.Client{Transport: telegramBotRoundTripper(func(req *http.Request) (*http.Response, error) {
		body := `{"ok":true,"result":true}`
		switch {
		case strings.HasSuffix(req.URL.Path, "/getMe"):
			body = `{"ok":true,"result":{"id":12345,"is_bot":true,"username":"test_bot"}}`
		case strings.HasSuffix(req.URL.Path, "/getWebhookInfo"):
			body = `{"ok":true,"result":{"url":""}}`
		case strings.HasSuffix(req.URL.Path, "/setWebhook"):
			webhookRequests++
			if webhookRequests == 1 {
				return nil, errors.New("temporary network failure")
			}
		default:
			t.Errorf("unexpected bot method")
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
	})}
	assert.True(t, cfg.LowBalanceNotificationsEnabled())
	assert.False(t, cfg.GroupRatioChangeEnabled)
	lowBalance, groupRatio := false, true
	saved, err := SaveTelegramBotConfig(context.Background(), true, "", cfg.Version, &model.TelegramBotReminderSettings{LowBalanceEnabled: &lowBalance, GroupRatioChangeEnabled: &groupRatio})
	require.NoError(t, err)
	assert.Equal(t, "error", saved.WebhookStatus)
	assert.False(t, saved.LowBalanceNotificationsEnabled())
	assert.True(t, saved.GroupRatioChangeEnabled)
	assert.EqualValues(t, cfg.ReminderVersion+1, saved.ReminderVersion)
	saved, err = SaveTelegramBotConfig(context.Background(), true, "", saved.Version, nil)
	require.NoError(t, err)
	assert.Equal(t, "ready", saved.WebhookStatus)
	assert.Empty(t, saved.LastError)
	assert.Equal(t, 2, webhookRequests)
	assert.False(t, saved.LowBalanceNotificationsEnabled(), "omitted settings preserve administrator choices")
	assert.True(t, saved.GroupRatioChangeEnabled)
	assert.EqualValues(t, cfg.ReminderVersion+1, saved.ReminderVersion, "webhook retries do not reset reminder baselines")
}

func TestTelegramBotWebhookReconcilesALateRegistration(t *testing.T) {
	_, cfg, _ := setupTelegramBotServiceTest(t)
	system_setting.ServerAddress = "https://example.test"
	*system_setting.GetTelegramSettings() = system_setting.TelegramSettings{ClientID: "12345", ClientSecret: "test-client-secret"}
	oldStarted, releaseOld := make(chan struct{}), make(chan struct{})
	var mu sync.Mutex
	registrations := 0
	registeredSecrets := make(map[int64]string)
	telegramBotHTTPClient = &http.Client{Transport: telegramBotRoundTripper(func(req *http.Request) (*http.Response, error) {
		botID := int64(12345)
		if strings.HasPrefix(req.URL.Path, "/bot67890:") {
			botID = 67890
		}
		body := `{"ok":true,"result":true}`
		switch {
		case strings.HasSuffix(req.URL.Path, "/getMe"):
			body = fmt.Sprintf(`{"ok":true,"result":{"id":%d,"is_bot":true,"username":"test_bot"}}`, botID)
		case strings.HasSuffix(req.URL.Path, "/getWebhookInfo"):
			body = `{"ok":true,"result":{"url":"https://example.test/api/telegram-bot/webhook"}}`
		case strings.HasSuffix(req.URL.Path, "/setWebhook"):
			var payload struct {
				Secret string `json:"secret_token"`
			}
			if err := common.DecodeJson(req.Body, &payload); err != nil {
				return nil, err
			}
			mu.Lock()
			registrations++
			first := registrations == 1
			mu.Unlock()
			if first {
				close(oldStarted)
				select {
				case <-releaseOld:
				case <-req.Context().Done():
					return nil, req.Context().Err()
				}
			}
			mu.Lock()
			registeredSecrets[botID] = payload.Secret
			mu.Unlock()
		default:
			return nil, errors.New("unexpected bot method")
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
	})}
	ctx, cancel := context.WithCancel(context.Background())
	oldResult := make(chan error, 1)
	go func() {
		_, err := SaveTelegramBotConfig(ctx, true, "", cfg.Version, nil)
		oldResult <- err
	}()
	t.Cleanup(cancel)
	select {
	case <-oldStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("旧回调注册未开始")
	}
	login := system_setting.GetTelegramSettings()
	login.ClientID = "67890"
	saved, err := SaveTelegramBotConfig(ctx, true, "67890:new_test_credential_1234567890", cfg.Version+1, nil)
	require.NoError(t, err)
	login.ClientID = "12345"
	saved, err = SaveTelegramBotConfig(ctx, true, cfg.Token, saved.Version, nil)
	require.NoError(t, err)
	require.NotEqual(t, cfg.WebhookSecret, saved.WebhookSecret)
	close(releaseOld)
	select {
	case err := <-oldResult:
		assert.ErrorIs(t, err, model.ErrTelegramBotChanged)
	case <-time.After(5 * time.Second):
		t.Fatal("旧回调注册未完成")
	}
	current, err := model.GetTelegramBotConfig()
	require.NoError(t, err)
	assert.Equal(t, "pending", current.WebhookStatus)
	assert.Equal(t, saved.Version, current.Version)
	mu.Lock()
	assert.Equal(t, cfg.WebhookSecret, registeredSecrets[cfg.BotID], "构造迟到旧请求覆盖远端密钥")
	mu.Unlock()
	reconciled := make(chan struct{}, 1)
	require.NoError(t, model.DB.Callback().Update().After("gorm:commit_or_rollback_transaction").Register("test:telegram_webhook_ready", func(tx *gorm.DB) {
		values, ok := tx.Statement.Dest.(map[string]any)
		if ok && tx.Statement.Table == "telegram_bot_configs" && tx.RowsAffected == 1 && values["webhook_status"] == "ready" {
			select {
			case reconciled <- struct{}{}:
			default:
			}
		}
	}))
	finished := make(chan struct{})
	go func() {
		runTelegramBotWorker(ctx, nil, nil, nil, nil)
		close(finished)
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case <-finished:
		case <-time.After(5 * time.Second):
			t.Error("注册工作进程未响应取消")
		}
	})
	select {
	case <-reconciled:
	case <-time.After(5 * time.Second):
		t.Fatal("当前回调配置未重新收敛")
	}
	current, err = model.GetTelegramBotConfig()
	require.NoError(t, err)
	assert.Equal(t, "ready", current.WebhookStatus)
	assert.Equal(t, saved.Version, current.Version)
	mu.Lock()
	assert.Equal(t, current.WebhookSecret, registeredSecrets[cfg.BotID])
	mu.Unlock()
}

func TestTelegramBotQueuedCommandsUseTheirOriginalTimes(t *testing.T) {
	_, cfg, conn := setupTelegramBotServiceTest(t)
	now := time.Now().Unix()
	for i, at := range []int64{now - 20, now - 10} {
		row := &model.TelegramBotInbox{UpdateID: int64(i + 1), UserID: conn.UserID, BotID: cfg.BotID, TelegramID: conn.TelegramID, ChatID: conn.ChatID, ConnectionVersion: conn.Version, Command: "/balance", ReceivedAt: at, MessageAt: at, Attempts: 1, Status: "processing", LeaseOwner: "test-worker", LeaseUntil: now + 120}
		require.NoError(t, model.DB.Create(row).Error)
		require.NoError(t, processTelegramBotInbox(cfg, row))
	}
	var replies int64
	require.NoError(t, model.DB.Model(&model.TelegramBotOutbox{}).Where("kind = ?", "reply").Count(&replies).Error)
	assert.EqualValues(t, 2, replies, "间隔正常的命令不能因队列集中执行而丢失")
}

func TestTelegramBotWebhookAuthenticatesAndDeduplicates(t *testing.T) {
	user, cfg, connection := setupTelegramBotServiceTest(t)
	now := time.Now().Unix()
	message := func(id int64, kind string, from int64, date int64, extra string) []byte {
		return []byte(fmt.Sprintf(`{"update_id":%d,"message":{"from":{"id":%d,"is_bot":false},"chat":{"id":%d,"type":%q},"date":%d,"text":"/balance"%s}}`, id, from, from, kind, date, extra))
	}
	assert.ErrorIs(t, ReceiveTelegramBotUpdate(cfg, "wrong", message(1, "private", 42, now, "")), model.ErrTelegramBotExpired)
	require.NoError(t, ReceiveTelegramBotUpdate(cfg, cfg.WebhookSecret, message(2, "group", 42, now, "")))
	var count int64
	require.NoError(t, model.DB.Model(&model.TelegramBotInbox{}).Count(&count).Error)
	assert.Zero(t, count)
	valid := message(3, "private", 42, now, "")
	require.NoError(t, ReceiveTelegramBotUpdate(cfg, cfg.WebhookSecret, valid))
	require.NoError(t, ReceiveTelegramBotUpdate(cfg, cfg.WebhookSecret, valid))
	require.NoError(t, model.DB.Model(&model.TelegramBotInbox{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
	require.NoError(t, ReceiveTelegramBotUpdate(cfg, cfg.WebhookSecret, message(4, "private", 77, now, `,"forward_from":{"id":42}`)))
	var forwarded model.TelegramBotInbox
	require.NoError(t, model.DB.Where("update_id = ?", 4).First(&forwarded).Error)
	assert.Equal(t, "77", forwarded.TelegramID)
	assert.Zero(t, forwarded.UserID)
	require.NoError(t, ReceiveTelegramBotUpdate(cfg, cfg.WebhookSecret, message(5, "private", 42, now-301, "")))
	var expired model.TelegramBotInbox
	require.NoError(t, model.DB.Where("update_id = ?", 5).First(&expired).Error)
	assert.Equal(t, "discarded", expired.Status)
	start := []byte(fmt.Sprintf(`{"update_id":6,"message":{"from":{"id":42},"chat":{"id":42,"type":"private"},"date":%d,"text":"/start tg_%s"}}`, now, strings.Repeat("a", 43)))
	require.NoError(t, ReceiveTelegramBotUpdate(cfg, cfg.WebhookSecret, start))
	var recovery model.TelegramBotInbox
	require.NoError(t, model.DB.Where("update_id = ?", 6).First(&recovery).Error)
	assert.Len(t, recovery.FlowHash, 64)
	assert.NotContains(t, recovery.FlowHash, strings.Repeat("a", 43))
	// 身份已转移到新账号时，历史连接不能抢占新账号的命令。
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", user.Id).Update("telegram_id", "").Error)
	require.NoError(t, model.DB.Model(&model.TelegramBotConnection{}).Where("user_id = ?", user.Id).Update("status", model.TelegramBotDisconnected).Error)
	other := model.User{Username: "new-telegram-owner", AffCode: "tg-new", TelegramId: "42", Status: common.UserStatusEnabled}
	require.NoError(t, model.DB.Create(&other).Error)
	newConnection := *connection
	newConnection.UserID = other.Id
	require.NoError(t, model.DB.Create(&newConnection).Error)
	require.NoError(t, ReceiveTelegramBotUpdate(cfg, cfg.WebhookSecret, message(7, "private", 42, now, "")))
	var transferred model.TelegramBotInbox
	require.NoError(t, model.DB.Where("update_id = ?", 7).First(&transferred).Error)
	assert.Equal(t, other.Id, transferred.UserID)
	assert.Equal(t, newConnection.Version, transferred.ConnectionVersion)
}

func TestTelegramBotDeliveryChecksRecipientAndFailureClasses(t *testing.T) {
	for _, test := range []struct {
		Name               string
		Response           string
		Failure            error
		Kind               string
		ExpectedStatus     string
		ExpectedConnection string
		Requests           int
	}{
		{"connect", `{"ok":true,"result":{"from":{"id":12345,"is_bot":true},"chat":{"id":42,"type":"private"}}}`, nil, "connect", "sent", model.TelegramBotConnected, 1},
		{"connect_timeout", "", errors.New("secret request URL must not escape"), "connect", "pending", model.TelegramBotConnecting, 1},
		{"connect_blocked", `{"ok":false,"error_code":403}`, nil, "connect", "failed", model.TelegramBotBlocked, 1},
		{"connect_rate_limit", `{"ok":false,"error_code":429,"parameters":{"retry_after":120}}`, nil, "connect", "pending", model.TelegramBotConnecting, 1},
		{"connect_wrong_bot", `{"ok":true,"result":{"from":{"id":67890,"is_bot":true},"chat":{"id":42,"type":"private"}}}`, nil, "connect", "failed", model.TelegramBotUnconnected, 1},
		{"connect_group", `{"ok":true,"result":{"from":{"id":12345,"is_bot":true},"chat":{"id":42,"type":"group"}}}`, nil, "connect", "failed", model.TelegramBotUnconnected, 1},
		{"welcome", `{"ok":true,"result":{"from":{"id":12345,"is_bot":true},"chat":{"id":42,"type":"private"}}}`, nil, "welcome", "sent", model.TelegramBotConnected, 1},
		{"welcome_wrong_recipient", `{"ok":true,"result":{"from":{"id":12345,"is_bot":true},"chat":{"id":43,"type":"private"}}}`, nil, "welcome", "failed", model.TelegramBotConnected, 1},
		{"welcome_timeout", "", errors.New("secret request URL must not escape"), "welcome", "pending", model.TelegramBotConnected, 1},
		{"welcome_blocked", `{"ok":false,"error_code":403}`, nil, "welcome", "failed", model.TelegramBotBlocked, 1},
		{"wrong_recipient", `{"ok":true,"result":{"from":{"id":12345,"is_bot":true},"chat":{"id":43,"type":"private"}}}`, nil, "connect", "failed", model.TelegramBotUnconnected, 1},
		{"expired_connect", "", nil, "connect", "failed", model.TelegramBotUnconnected, 0},
		{"exhausted_connect", "", nil, "connect", "failed", model.TelegramBotUnconnected, 0},
		{"blocked", `{"ok":false,"error_code":403}`, nil, "test", "failed", model.TelegramBotBlocked, 1},
		{"rate_limit", `{"ok":false,"error_code":429,"parameters":{"retry_after":120}}`, nil, "test", "pending", model.TelegramBotConnected, 1},
		{"timeout", "", errors.New("secret request URL must not escape"), "test", "pending", model.TelegramBotConnected, 1},
		{"stale_connection", "", nil, "stale", "discarded", model.TelegramBotDisconnected, 0},
	} {
		t.Run(test.Name, func(t *testing.T) {
			_, cfg, conn := setupTelegramBotServiceTest(t)
			if test.Kind == "welcome" {
				conn.Preferences = model.TelegramBotPreferences{}
				require.NoError(t, model.DB.Save(conn).Error)
			}
			if test.Kind == "connect" {
				intent, err := model.BeginTelegramBotOAuth(conn.UserID, model.TelegramBotPreferences{})
				require.NoError(t, err)
				require.NoError(t, model.DB.Transaction(func(tx *gorm.DB) error {
					return model.CompleteTelegramBotOAuthTx(tx, conn.UserID, conn.TelegramID, intent, false)
				}))
				conn, err = model.GetTelegramBotConnection(conn.UserID)
				require.NoError(t, err)
			}
			kind := test.Kind
			if kind == "stale" {
				kind = "test"
			}
			if test.Kind == "connect" {
				if test.Name == "expired_connect" {
					require.NoError(t, model.DB.Model(&model.TelegramBotOutbox{}).Where("user_id = ?", conn.UserID).Update("expires_at", time.Now().Unix()-1).Error)
				}
			} else {
				require.NoError(t, model.DB.Transaction(func(tx *gorm.DB) error {
					return model.EnqueueTelegramBotMessageTx(tx, conn, kind, "test:"+test.Name, "", time.Now().Unix()+300)
				}))
			}
			if test.Kind == "stale" {
				require.NoError(t, model.DisconnectTelegramBot(conn.UserID))
			}
			row, err := model.ClaimTelegramBotOutbox("test-worker")
			require.NoError(t, err)
			require.NotNil(t, row)
			if test.Name == "exhausted_connect" {
				row.Attempts = 11
			}
			requests := 0
			telegramBotHTTPClient = &http.Client{Timeout: time.Second, Transport: telegramBotRoundTripper(func(req *http.Request) (*http.Response, error) {
				requests++
				require.Equal(t, "api.telegram.org", req.URL.Host)
				if test.Failure != nil {
					return nil, test.Failure
				}
				return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(test.Response))}, nil
			})}
			sendTelegramBotOutbox(context.Background(), cfg, row)
			var saved model.TelegramBotOutbox
			require.NoError(t, model.DB.First(&saved, row.ID).Error)
			assert.Equal(t, test.ExpectedStatus, saved.Status)
			assert.NotContains(t, saved.LastError, "secret request URL")
			current, err := model.GetTelegramBotConnection(conn.UserID)
			require.NoError(t, err)
			assert.Equal(t, test.ExpectedConnection, current.Status)
			if test.Kind == "connect" && test.ExpectedStatus == "failed" {
				assert.NotEmpty(t, current.LastError)
			}
			assert.Equal(t, test.Requests, requests)
			if test.Name == "rate_limit" || test.Name == "connect_rate_limit" {
				assert.GreaterOrEqual(t, saved.NextAttemptAt, time.Now().Unix()+119)
			}
			if test.Name == "connect" {
				require.NoError(t, model.DB.Model(&saved).Updates(map[string]any{"status": "pending", "next_attempt_at": time.Now().Unix(), "lease_until": 0}).Error)
				retry, err := model.ClaimTelegramBotOutbox("retry-worker")
				require.NoError(t, err)
				require.NotNil(t, retry)
				sendTelegramBotOutbox(context.Background(), cfg, retry)
				assert.Equal(t, 1, requests, "confirmed connection does not resend its welcome after a lost status write")
			}
		})
	}
}

func TestTelegramBotStartRestoresOnlyBlockedConnections(t *testing.T) {
	for _, status := range []string{model.TelegramBotBlocked, model.TelegramBotDisconnected} {
		t.Run(status, func(t *testing.T) {
			_, cfg, conn := setupTelegramBotServiceTest(t)
			require.NoError(t, model.DB.Model(conn).Update("status", status).Error)
			now := time.Now().Unix()
			row := &model.TelegramBotInbox{ID: 1, UserID: conn.UserID, BotID: cfg.BotID, TelegramID: conn.TelegramID, ChatID: conn.ChatID, ConnectionVersion: conn.Version, Command: "/start", ReceivedAt: now, MessageAt: now, Attempts: 1}
			require.NoError(t, model.DB.Create(row).Error)
			require.NoError(t, processTelegramBotInbox(cfg, row))
			current, err := model.GetTelegramBotConnection(conn.UserID)
			require.NoError(t, err)
			if status == model.TelegramBotBlocked {
				assert.Equal(t, model.TelegramBotConnecting, current.Status)
				assert.Equal(t, conn.Version+1, current.Version)
			} else {
				assert.Equal(t, model.TelegramBotDisconnected, current.Status)
				assert.Equal(t, conn.Version, current.Version)
			}
		})
	}
}

func TestTelegramBotPrivateStartCompletesPendingAuthorization(t *testing.T) {
	_, cfg, conn := setupTelegramBotServiceTest(t)
	intent, err := model.BeginTelegramBotOAuth(conn.UserID, conn.Preferences)
	require.NoError(t, err)
	require.NoError(t, model.DB.Transaction(func(tx *gorm.DB) error {
		return model.CompleteTelegramBotOAuthTx(tx, conn.UserID, conn.TelegramID, intent, false)
	}))
	conn, err = model.GetTelegramBotConnection(conn.UserID)
	require.NoError(t, err)
	require.Equal(t, model.TelegramBotConnecting, conn.Status)
	now := time.Now().Unix()
	data := []byte(fmt.Sprintf(`{"update_id":99,"message":{"message_id":7,"from":{"id":42,"is_bot":false},"chat":{"id":42,"type":"private"},"date":%d,"text":"/start"}}`, now))
	require.NoError(t, ReceiveTelegramBotUpdate(cfg, cfg.WebhookSecret, data))
	command, err := model.ClaimTelegramBotInbox("command-worker")
	require.NoError(t, err)
	require.NotNil(t, command)
	require.NoError(t, processTelegramBotInbox(cfg, command))
	require.NoError(t, model.FinishTelegramBotInbox(command, "done"))
	current, err := model.GetTelegramBotConnection(conn.UserID)
	require.NoError(t, err)
	assert.Equal(t, model.TelegramBotConnected, current.Status)
	assert.Equal(t, conn.Version, current.Version)
	assert.Equal(t, conn.AuthorizationVersion, current.AuthorizationVersion)
	var requests []string
	telegramBotHTTPClient = &http.Client{Transport: telegramBotRoundTripper(func(req *http.Request) (*http.Response, error) {
		var payload struct {
			Text string `json:"text"`
		}
		if err := common.DecodeJson(req.Body, &payload); err != nil {
			return nil, err
		}
		requests = append(requests, payload.Text)
		body := fmt.Sprintf(`{"ok":true,"result":{"message_id":88,"date":%d,"from":{"id":12345,"is_bot":true,"username":"test_bot"},"chat":{"id":42,"type":"private"},"text":"ok"}}`, now)
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
	})}
	for range 2 {
		task, err := model.ClaimTelegramBotOutbox("delivery-worker")
		require.NoError(t, err)
		require.NotNil(t, task)
		sendTelegramBotOutbox(context.Background(), cfg, task)
	}
	require.Len(t, requests, 1, "私聊已经确认连接，旧欢迎任务不得再发送")
	assert.Contains(t, requests[0], "/balance")
	assert.NotContains(t, requests[0], "not active")
	assert.NotContains(t, requests[0], "尚未连接")
	var inactive int64
	require.NoError(t, model.DB.Model(&model.TelegramBotOutbox{}).Where("kind = ?", "help").Count(&inactive).Error)
	assert.Zero(t, inactive)
}

func TestTelegramBotOAuthBindingAllowsCommandsBeforeWelcomeDelivery(t *testing.T) {
	_, cfg, before := setupTelegramBotServiceTest(t)
	intent, err := model.BeginTelegramBotOAuth(before.UserID, model.TelegramBotPreferences{})
	require.NoError(t, err)
	require.NoError(t, model.DB.Transaction(func(tx *gorm.DB) error {
		return model.CompleteTelegramBotOAuthTx(tx, before.UserID, before.TelegramID, intent, true)
	}))
	conn, err := model.GetTelegramBotConnection(before.UserID)
	require.NoError(t, err)
	require.Equal(t, model.TelegramBotConnected, conn.Status)
	welcome, err := model.ClaimTelegramBotOutbox("welcome-worker")
	require.NoError(t, err)
	require.NotNil(t, welcome)
	require.Equal(t, "welcome", welcome.Kind)
	telegramBotHTTPClient = &http.Client{Transport: telegramBotRoundTripper(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("temporary connection failure")
	})}
	sendTelegramBotOutbox(context.Background(), cfg, welcome)
	var saved model.TelegramBotOutbox
	require.NoError(t, model.DB.First(&saved, welcome.ID).Error)
	assert.Equal(t, "pending", saved.Status)
	conn, err = model.GetTelegramBotConnection(before.UserID)
	require.NoError(t, err)
	assert.Equal(t, model.TelegramBotConnected, conn.Status)
	data := []byte(fmt.Sprintf(`{"update_id":99,"message":{"from":{"id":42,"is_bot":false},"chat":{"id":42,"type":"private"},"date":%d,"text":"/balance"}}`, time.Now().Unix()))
	require.NoError(t, ReceiveTelegramBotUpdate(cfg, cfg.WebhookSecret, data))
	command, err := model.ClaimTelegramBotInbox("command-worker")
	require.NoError(t, err)
	require.NotNil(t, command)
	require.NoError(t, processTelegramBotInbox(cfg, command))
	require.NoError(t, model.FinishTelegramBotInbox(command, "done"))
	reply, err := model.ClaimTelegramBotOutbox("reply-worker")
	require.NoError(t, err)
	require.NotNil(t, reply)
	assert.Equal(t, "reply", reply.Kind)
	assert.Equal(t, conn.Version, reply.ConnectionVersion)
	assert.Contains(t, reply.Payload, "0.004")
	assert.NotContains(t, reply.Payload, "not active")
}

func TestTelegramBotQueuedInactiveMessageIsDiscardedAfterAuthorization(t *testing.T) {
	for _, status := range []string{model.TelegramBotConnecting, model.TelegramBotConnected} {
		t.Run(status, func(t *testing.T) {
			_, cfg, conn := setupTelegramBotServiceTest(t)
			require.NoError(t, model.DB.Model(conn).Update("status", model.TelegramBotDisconnected).Error)
			data := []byte(fmt.Sprintf(`{"update_id":99,"message":{"from":{"id":42,"is_bot":false},"chat":{"id":42,"type":"private"},"date":%d,"text":"/start"}}`, time.Now().Unix()))
			require.NoError(t, ReceiveTelegramBotUpdate(cfg, cfg.WebhookSecret, data))
			command, err := model.ClaimTelegramBotInbox("command-worker")
			require.NoError(t, err)
			require.NotNil(t, command)
			require.NoError(t, processTelegramBotInbox(cfg, command))
			require.NoError(t, model.FinishTelegramBotInbox(command, "done"))
			intent, err := model.BeginTelegramBotOAuth(conn.UserID, conn.Preferences)
			require.NoError(t, err)
			require.NoError(t, model.DB.Transaction(func(tx *gorm.DB) error {
				return model.CompleteTelegramBotOAuthTx(tx, conn.UserID, conn.TelegramID, intent, status == model.TelegramBotConnected)
			}))
			if status == model.TelegramBotConnected {
				current, err := model.GetTelegramBotConnection(conn.UserID)
				require.NoError(t, err)
				require.NoError(t, model.ConfirmTelegramBotConnection(current, 42))
			}
			task, err := model.ClaimTelegramBotOutbox("delivery-worker")
			require.NoError(t, err)
			require.NotNil(t, task)
			require.Equal(t, "help", task.Kind)
			sendTelegramBotOutbox(context.Background(), cfg, task)
			var saved model.TelegramBotOutbox
			require.NoError(t, model.DB.First(&saved, task.ID).Error)
			assert.Equal(t, "discarded", saved.Status, "旧未连接提示必须结束，不能继续发送或等待租约超时重取")
			assert.Empty(t, saved.LeaseOwner)
			current, err := model.GetTelegramBotConnection(conn.UserID)
			require.NoError(t, err)
			assert.Equal(t, status, current.Status)
		})
	}
}

func TestTelegramBotFinalAuthorizationFailureReleasesTheTask(t *testing.T) {
	for _, mode := range []string{"changed", "paused", "unavailable"} {
		t.Run(mode, func(t *testing.T) {
			_, cfg, conn := setupTelegramBotServiceTest(t)
			require.NoError(t, model.DB.Transaction(func(tx *gorm.DB) error {
				return model.EnqueueTelegramBotMessageTx(tx, conn, "test", "authorization-race", "", time.Now().Unix()+300)
			}))
			task, err := model.ClaimTelegramBotOutbox("delivery-worker")
			require.NoError(t, err)
			require.NotNil(t, task)
			configReads := 0
			require.NoError(t, model.DB.Callback().Query().Before("gorm:query").Register("test:telegram_authorization_race", func(tx *gorm.DB) {
				if tx.Statement.Table != "telegram_bot_configs" {
					return
				}
				configReads++
				if configReads != 2 {
					return
				}
				switch mode {
				case "changed":
					tx.AddError(tx.Session(&gorm.Session{NewDB: true}).Model(&model.TelegramBotConnection{}).Where("user_id = ?", conn.UserID).Updates(map[string]any{"status": model.TelegramBotDisconnected, "version": conn.Version + 1}).Error)
				case "paused":
					tx.AddError(tx.Session(&gorm.Session{NewDB: true}).Model(&model.TelegramBotConfig{}).Where("id = ?", 1).Update("enabled", false).Error)
				case "unavailable":
					tx.AddError(errors.New("temporary database failure"))
				}
			}))
			sendTelegramBotOutbox(context.Background(), cfg, task)
			require.NoError(t, model.DB.Callback().Query().Remove("test:telegram_authorization_race"))
			var saved model.TelegramBotOutbox
			require.NoError(t, model.DB.First(&saved, task.ID).Error)
			if mode == "changed" {
				assert.Equal(t, "discarded", saved.Status)
			} else {
				assert.Equal(t, "pending", saved.Status)
				assert.Greater(t, saved.NextAttemptAt, time.Now().Unix())
			}
			assert.Empty(t, saved.LeaseOwner)
			assert.Zero(t, saved.LeaseUntil)
		})
	}
}

func TestTelegramBotLateForbiddenResponseDoesNotUndoANewerStart(t *testing.T) {
	_, cfg, conn := setupTelegramBotServiceTest(t)
	require.NoError(t, model.DB.Transaction(func(tx *gorm.DB) error {
		return model.EnqueueTelegramBotMessageTx(tx, conn, "test", "late-forbidden", "", time.Now().Unix()+300)
	}))
	row, err := model.ClaimTelegramBotOutbox("delivery-worker")
	require.NoError(t, err)
	require.NotNil(t, row)
	telegramBotHTTPClient = &http.Client{Transport: telegramBotRoundTripper(func(req *http.Request) (*http.Response, error) {
		data := []byte(fmt.Sprintf(`{"update_id":99,"message":{"from":{"id":42},"chat":{"id":42,"type":"private"},"date":%d,"text":"/start"}}`, time.Now().Unix()))
		if err := ReceiveTelegramBotUpdate(cfg, cfg.WebhookSecret, data); err != nil {
			return nil, err
		}
		command, err := model.ClaimTelegramBotInbox("command-worker")
		if err != nil || command == nil {
			return nil, errors.New("start command unavailable")
		}
		if err := processTelegramBotInbox(cfg, command); err != nil {
			return nil, err
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"ok":false,"error_code":403}`))}, nil
	})}
	sendTelegramBotOutbox(context.Background(), cfg, row)
	current, err := model.GetTelegramBotConnection(conn.UserID)
	require.NoError(t, err)
	assert.Equal(t, model.TelegramBotConnected, current.Status)
	assert.EqualValues(t, 99, current.LastStateUpdateID)
	assert.Equal(t, conn.Version, current.Version, "新 start 只推进事件顺序，也必须挡住迟到403")
	var saved model.TelegramBotOutbox
	require.NoError(t, model.DB.First(&saved, row.ID).Error)
	assert.Equal(t, "failed", saved.Status)
}

func TestTelegramBotNotifyButtonsBindIdentityVersionAndExpiry(t *testing.T) {
	_, cfg, conn := setupTelegramBotServiceTest(t)
	now := time.Now().Unix()
	row := &model.TelegramBotInbox{ID: 1, UserID: conn.UserID, BotID: cfg.BotID, TelegramID: conn.TelegramID, ChatID: conn.ChatID, ConnectionVersion: conn.Version, Command: "/notify", ReceivedAt: now, MessageAt: now, Attempts: 1}
	require.NoError(t, telegramBotUpdateNotification(cfg, row, conn, "zh-CN"))
	var task model.TelegramBotOutbox
	require.NoError(t, model.DB.First(&task).Error)
	var reply struct {
		ReplyMarkup struct {
			Keyboard [][]struct {
				Data string `json:"callback_data"`
			} `json:"inline_keyboard"`
		} `json:"reply_markup"`
	}
	require.NoError(t, common.UnmarshalJsonStr(task.Payload, &reply))
	require.NotEmpty(t, reply.ReplyMarkup.Keyboard)
	button := reply.ReplyMarkup.Keyboard[0][0].Data
	assert.LessOrEqual(t, len(button), 64)
	tampered := *row
	tampered.ID = 2
	tampered.Argument = button[:len(button)-1] + "!"
	require.NoError(t, telegramBotUpdateNotification(cfg, &tampered, conn, "zh-CN"))
	current, err := model.GetTelegramBotConnection(conn.UserID)
	require.NoError(t, err)
	assert.True(t, current.Preferences.Enabled)
	other := *conn
	other.UserID++
	crossUser := *row
	crossUser.ID = 6
	crossUser.Argument = button
	require.NoError(t, telegramBotUpdateNotification(cfg, &crossUser, &other, "zh-CN"))
	click := *row
	click.ID = 3
	click.Argument = button
	require.NoError(t, telegramBotUpdateNotification(cfg, &click, conn, "zh-CN"))
	current, err = model.GetTelegramBotConnection(conn.UserID)
	require.NoError(t, err)
	assert.False(t, current.Preferences.Enabled)
	prefs := current.Preferences
	prefs.Enabled = true
	require.NoError(t, model.DB.Transaction(func(tx *gorm.DB) error {
		return model.UpdateTelegramBotPreferencesTx(tx, current.UserID, current.PreferencesVersion, prefs)
	}))
	current, err = model.GetTelegramBotConnection(conn.UserID)
	require.NoError(t, err)
	click.ID = 4
	require.NoError(t, telegramBotUpdateNotification(cfg, &click, current, "zh-CN"))
	current, err = model.GetTelegramBotConnection(conn.UserID)
	require.NoError(t, err)
	assert.True(t, current.Preferences.Enabled, "old button cannot undo a later website choice")
	parts := strings.Split(button, ":")
	parts[3] = strconv.FormatInt(current.PreferencesVersion, 36)
	parts[5] = "1"
	body := strings.Join(parts[:6], ":")
	parts[6] = common.GenerateHMACWithKey([]byte(cfg.WebhookSecret), fmt.Sprintf("%d:%d:%s:%s:%s", cfg.BotID, current.UserID, current.TelegramID, current.ChatID, body))[:24]
	click.ID = 5
	click.Argument = strings.Join(parts, ":")
	require.NoError(t, telegramBotUpdateNotification(cfg, &click, current, "zh-CN"))
	current, err = model.GetTelegramBotConnection(conn.UserID)
	require.NoError(t, err)
	assert.True(t, current.Preferences.Enabled)
}

func TestTelegramBotCheckinRecoversCommittedResultWithoutAnotherReward(t *testing.T) {
	user, cfg, conn := setupTelegramBotServiceTest(t)
	settings := operation_setting.GetCheckinSetting()
	settings.Enabled = true
	settings.MinQuota = 10
	settings.MaxQuota = 10
	now := time.Now().Unix()
	row := &model.TelegramBotInbox{ID: 1, UserID: user.Id, BotID: cfg.BotID, TelegramID: conn.TelegramID, ChatID: conn.ChatID, ConnectionVersion: conn.Version, Command: "/checkin", ReceivedAt: now, MessageAt: now, BusinessDate: model.CheckinBusinessDate(time.Now()), Attempts: 1, Status: "processing", LeaseOwner: "test-worker", LeaseUntil: now + 120}
	require.NoError(t, model.DB.Create(row).Error)
	require.NoError(t, model.DB.Migrator().DropTable(&model.TelegramBotOutbox{}))
	require.Error(t, processTelegramBotInbox(cfg, row))
	var after model.User
	require.NoError(t, model.DB.First(&after, user.Id).Error)
	// 出站表不可用发生在发奖前的幂等检查，业务不能被错误执行。
	assert.Equal(t, user.Quota, after.Quota)
	require.NoError(t, model.DB.AutoMigrate(&model.TelegramBotOutbox{}))
	require.NoError(t, processTelegramBotInbox(cfg, row))
	require.NoError(t, model.DB.First(&after, user.Id).Error)
	assert.Equal(t, user.Quota+10, after.Quota)
	require.NoError(t, model.DB.Where("kind = ?", "reply").Delete(&model.TelegramBotOutbox{}).Error)
	row.Attempts = 2
	row.MessageAt = now - 600
	row.ReceivedAt = now - 600
	require.NoError(t, processTelegramBotInbox(cfg, row))
	require.NoError(t, model.DB.First(&after, user.Id).Error)
	assert.Equal(t, user.Quota+10, after.Quota)
	var records int64
	require.NoError(t, model.DB.Model(&model.Checkin{}).Where("user_id = ?", user.Id).Count(&records).Error)
	assert.EqualValues(t, 1, records)
	var rewardReplies int64
	require.NoError(t, model.DB.Model(&model.TelegramBotOutbox{}).Where("kind = ?", "reply").Count(&rewardReplies).Error)
	assert.EqualValues(t, 1, rewardReplies)
}

func TestTelegramBotWorkerProcessesCommandsWhileDeliveryIsBlocked(t *testing.T) {
	_, cfg, conn := setupTelegramBotServiceTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.SubscriptionPlan{}, &model.UserSubscription{}))
	require.NoError(t, model.DB.Transaction(func(tx *gorm.DB) error {
		return model.EnqueueTelegramBotMessageTx(tx, conn, "test", "blocked-delivery", "", time.Now().Unix()+300)
	}))
	started := make(chan struct{}, 1)
	completed := make(chan struct{}, 1)
	telegramBotHTTPClient = &http.Client{Transport: telegramBotRoundTripper(func(req *http.Request) (*http.Response, error) {
		started <- struct{}{}
		<-req.Context().Done()
		return nil, req.Context().Err()
	})}
	require.NoError(t, model.DB.Callback().Update().After("gorm:commit_or_rollback_transaction").Register("test:telegram_inbox_done", func(tx *gorm.DB) {
		values, ok := tx.Statement.Dest.(map[string]any)
		if ok && tx.Statement.Table == "telegram_bot_inboxes" && tx.RowsAffected == 1 && values["status"] == "done" {
			select {
			case completed <- struct{}{}:
			default:
			}
		}
	}))
	ctx, cancel := context.WithCancel(context.Background())
	inboxTicks, outboxTicks := make(chan time.Time, 1), make(chan time.Time, 1)
	finished := make(chan struct{})
	go func() {
		runTelegramBotWorker(ctx, inboxTicks, outboxTicks, nil, nil)
		close(finished)
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case <-finished:
		case <-time.After(5 * time.Second):
			t.Error("工作进程未响应取消")
		}
	})
	outboxTicks <- time.Now()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("出站请求未开始")
	}
	data := []byte(fmt.Sprintf(`{"update_id":99,"message":{"from":{"id":42},"chat":{"id":42,"type":"private"},"date":%d,"text":"/balance"}}`, time.Now().Unix()))
	require.NoError(t, ReceiveTelegramBotUpdate(cfg, cfg.WebhookSecret, data))
	inboxTicks <- time.Now()
	select {
	case <-completed:
	case <-time.After(5 * time.Second):
		t.Fatal("出站阻塞期间命令没有完成")
	}
	var command model.TelegramBotInbox
	require.NoError(t, model.DB.Where("update_id = ?", 99).First(&command).Error)
	assert.Equal(t, "done", command.Status)
	var replies int64
	require.NoError(t, model.DB.Model(&model.TelegramBotOutbox{}).Where("kind = ?", "reply").Count(&replies).Error)
	assert.EqualValues(t, 1, replies)
}

func TestTelegramBotSubscriptionsPaginateOnlyOwnPlans(t *testing.T) {
	user, _, _ := setupTelegramBotServiceTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.SubscriptionPlan{}, &model.UserSubscription{}))
	for i := 1; i <= 7; i++ {
		title := fmt.Sprintf("own-plan-%d", i)
		owner := user.Id
		if i == 7 {
			title = "other-user-private-plan"
			owner++
		}
		plan := model.SubscriptionPlan{Title: title}
		require.NoError(t, model.DB.Create(&plan).Error)
		sub := model.UserSubscription{UserId: owner, PlanId: plan.Id, Status: "active", AmountTotal: 0, StartTime: time.Now().Unix() - 60, EndTime: time.Now().Unix() + 86400}
		require.NoError(t, model.DB.Create(&sub).Error)
	}
	first := telegramBotSubscriptions(user, "en", 1)
	assert.Contains(t, first, "own-plan-6")
	assert.NotContains(t, first, "own-plan-1")
	assert.Contains(t, first, "/subs 2")
	assert.Contains(t, first, "Unlimited")
	assert.NotContains(t, first, "other-user-private-plan")
	second := telegramBotSubscriptions(user, "en", 2)
	assert.Contains(t, second, "own-plan-1")
	assert.NotContains(t, second, "own-plan-2")
	assert.NotContains(t, second, "other-user-private-plan")
	assert.NotContains(t, second, "/subs 3")
}
