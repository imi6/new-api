package model

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func telegramBotConnectionFixture(t *testing.T, name, telegramID string, prefs TelegramBotPreferences, confirm bool) (*User, *TelegramBotConnection) {
	t.Helper()
	user := User{Username: "telegram-" + name, AffCode: "tg-" + name, Status: common.UserStatusEnabled, TelegramId: telegramID, Quota: 2000}
	require.NoError(t, DB.Create(&user).Error)
	intent, err := BeginTelegramBotOAuth(user.Id, prefs)
	require.NoError(t, err)
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error { return CompleteTelegramBotOAuthTx(tx, user.Id, telegramID, intent, confirm) }))
	conn, err := GetTelegramBotConnection(user.Id)
	require.NoError(t, err)
	if confirm {
		tgID, err := strconv.ParseInt(telegramID, 10, 64)
		require.NoError(t, err)
		require.NoError(t, ConfirmTelegramBotConnection(conn, tgID))
		conn, err = GetTelegramBotConnection(user.Id)
		require.NoError(t, err)
	}
	return &user, conn
}

func telegramGroupRatioReminderFixture(t *testing.T, name, telegramID string) (*User, *TelegramBotConnection) {
	t.Helper()
	ratios := ratio_setting.GroupRatio2JSONString()
	specialRatios := ratio_setting.GroupGroupRatio2JSONString()
	usableGroups := setting.UserUsableGroups2JSONString()
	visibility := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.ReadAll()
	cfg, err := GetTelegramBotConfig()
	require.NoError(t, err)
	savedConfig := *cfg
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(ratios))
		require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(specialRatios))
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(usableGroups))
		ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.Clear()
		ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.AddAll(visibility)
		require.NoError(t, DB.Save(&savedConfig).Error)
	})
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"standard":1,"discount":1,"free":0,"hidden":7,"auto":1}`))
	require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(`{"vip":{"discount":0.5}}`))
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"standard":"Standard","discount":"Discount","free":"Free","auto":"Auto"}`))
	ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.Clear()
	require.NoError(t, DB.Model(cfg).Updates(map[string]any{"group_ratio_change_enabled": true, "reminder_version": gorm.Expr("reminder_version + 1")}).Error)
	user, conn := telegramBotConnectionFixture(t, name, telegramID, TelegramBotPreferences{Enabled: true}, true)
	require.NoError(t, DB.Model(user).Update("group", "vip").Error)
	user.Group = "vip"
	return user, conn
}

// TestTelegramBotDatabaseContracts 覆盖真实三库迁移、账务原子性及跨实例队列约束。
func TestTelegramBotDatabaseContracts(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			dsn := "local"
			if dialect == "mysql" {
				dsn = os.Getenv("TEST_MYSQL_DSN")
			}
			if dialect == "postgres" {
				dsn = os.Getenv("TEST_POSTGRES_DSN")
			}
			if dsn == "" {
				t.Skip("dedicated test database DSN is not configured")
			}
			originalDB, originalLogs, originalPath := DB, LOG_DB, common.SQLitePath
			mainType, logType := common.MainDatabaseType(), common.LogDatabaseType()
			botSettings := *system_setting.GetTelegramBotSettings()
			botRuntimeEnabled := system_setting.TelegramBotEnabled()
			checkinSettings := *operation_setting.GetCheckinSetting()
			originalReminders, originalThreshold := common.QuotaRemindEnabled, common.QuotaRemindThreshold
			t.Cleanup(func() {
				DB, LOG_DB, common.SQLitePath = originalDB, originalLogs, originalPath
				common.SetDatabaseTypes(mainType, logType)
				initCol()
				*system_setting.GetTelegramBotSettings() = botSettings
				system_setting.SetTelegramBotEnabled(botRuntimeEnabled)
				*operation_setting.GetCheckinSetting() = checkinSettings
				common.QuotaRemindEnabled, common.QuotaRemindThreshold = originalReminders, originalThreshold
			})
			common.SQLitePath = filepath.Join(t.TempDir(), "telegram.db")
			t.Setenv("TELEGRAM_TEST_DATABASE_DSN", dsn)
			db, dbType, err := chooseDB("TELEGRAM_TEST_DATABASE_DSN", false)
			require.NoError(t, err)
			DB, LOG_DB = db, db
			common.SetDatabaseTypes(dbType, dbType)
			initCol()
			sqlDB, err := db.DB()
			require.NoError(t, err)
			var databaseVersion string
			versionQuery := "SELECT version()"
			if dialect == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(versionQuery).Scan(&databaseVersion).Error)
			t.Logf("%s database version: %s", dialect, databaseVersion)
			if dialect == "sqlite" {
				sqlDB.SetMaxOpenConns(1)
			}
			t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			base := []any{&User{}, &Checkin{}, &AuthFlow{}, &UserSession{}, &ExternalIdentityClaim{}, &TopUp{}, &Redemption{}, &SubscriptionPlan{}, &SubscriptionOrder{}, &UserSubscription{}, &Option{}}
			added := []any{&TelegramBotConfig{}, &TelegramBotConnection{}, &TelegramBotInbox{}, &TelegramBotOutbox{}, &TelegramLowBalanceState{}, &TelegramGroupRatioState{}}
			// 外部 DSN 只能指向本测试专用数据库，结束后只清理本次创建的测试表。
			tables := append(append([]any{}, base...), added...)
			for _, table := range tables {
				require.False(t, db.Migrator().HasTable(table), "test database must be empty")
			}
			t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(tables...)) })
			// 全新安装也重复迁移两次，随后重建旧结构验证升级路径。
			require.NoError(t, db.AutoMigrate(tables...))
			require.NoError(t, db.AutoMigrate(tables...))
			assert.True(t, db.Migrator().HasIndex(&TelegramBotInbox{}, "idx_tg_bot_update"))
			assert.True(t, db.Migrator().HasIndex(&TelegramBotInbox{}, "idx_tg_inbox_due"))
			assert.True(t, db.Migrator().HasIndex(&TelegramBotOutbox{}, "idx_telegram_bot_outboxes_event_key"))
			assert.True(t, db.Migrator().HasIndex(&TelegramBotOutbox{}, "idx_tg_outbox_due"))
			freshConfig := TelegramBotConfig{ID: 1, Enabled: true}
			require.NoError(t, db.Create(&freshConfig).Error)
			require.NoError(t, db.First(&freshConfig, 1).Error)
			assert.True(t, freshConfig.LowBalanceNotificationsEnabled())
			assert.False(t, freshConfig.GroupRatioChangeEnabled)
			require.NoError(t, db.Model(&freshConfig).Updates(map[string]any{"low_balance_enabled": false, "group_ratio_change_enabled": true, "reminder_version": 3}).Error)
			for range 2 {
				require.NoError(t, db.AutoMigrate(added...))
			}
			require.NoError(t, db.First(&freshConfig, 1).Error)
			assert.False(t, freshConfig.LowBalanceNotificationsEnabled())
			assert.True(t, freshConfig.GroupRatioChangeEnabled)
			assert.EqualValues(t, 3, freshConfig.ReminderVersion)
			require.NoError(t, db.Migrator().DropTable(tables...))
			require.NoError(t, db.AutoMigrate(base...))
			user := User{Username: "telegram-contract", Status: common.UserStatusEnabled, TelegramId: "42", Quota: 2000}
			require.NoError(t, db.Create(&user).Error)
			// 升级已有用户后重复迁移两次，保留旧余额及签到唯一索引。
			require.NoError(t, db.AutoMigrate(added...))
			require.NoError(t, db.AutoMigrate(tables...))
			require.NoError(t, db.AutoMigrate(tables...))
			var saved User
			require.NoError(t, db.First(&saved, user.Id).Error)
			assert.Equal(t, user.Quota, saved.Quota)
			assert.True(t, db.Migrator().HasIndex(&Checkin{}, "idx_user_checkin_date"))
			t.Run("existing_bot_rows_receive_safe_migration_defaults", func(t *testing.T) {
				legacyConfig := TelegramBotConfig{ID: 1, Enabled: true, BotID: 987, Version: 5}
				legacyConn := TelegramBotConnection{UserID: user.Id, Version: 7, Status: TelegramBotConnected}
				legacyInbox := TelegramBotInbox{BotID: 987, UpdateID: 987, UserID: user.Id, Status: "pending"}
				legacyBalance := TelegramLowBalanceState{UserID: user.Id, ConnectionVersion: 7, Threshold: 1000, Below: true, Round: 3}
				require.NoError(t, db.Create(&legacyConfig).Error)
				require.NoError(t, db.Create(&legacyConn).Error)
				require.NoError(t, db.Create(&legacyInbox).Error)
				require.NoError(t, db.Create(&legacyBalance).Error)
				for _, column := range []string{"LowBalanceEnabled", "GroupRatioChangeEnabled", "ReminderVersion"} {
					require.NoError(t, db.Migrator().DropColumn(&TelegramBotConfig{}, column))
				}
				require.NoError(t, db.Migrator().DropColumn(&TelegramLowBalanceState{}, "SettingsVersion"))
				for _, column := range []string{"AuthorizationVersion", "LastStateEventAt", "LastStateUpdateID"} {
					require.NoError(t, db.Migrator().DropColumn(&TelegramBotConnection{}, column))
				}
				for _, column := range []string{"AuthorizationVersion", "CommandChecked", "CommandAccepted", "CommandAt"} {
					require.NoError(t, db.Migrator().DropColumn(&TelegramBotInbox{}, column))
				}
				for range 2 {
					require.NoError(t, db.AutoMigrate(added...))
				}
				migratedConfig, err := GetTelegramBotConfig()
				require.NoError(t, err)
				assert.EqualValues(t, 5, migratedConfig.Version)
				assert.True(t, migratedConfig.LowBalanceNotificationsEnabled())
				assert.False(t, migratedConfig.GroupRatioChangeEnabled)
				assert.Zero(t, migratedConfig.ReminderVersion)
				var migratedBalance TelegramLowBalanceState
				require.NoError(t, db.First(&migratedBalance, user.Id).Error)
				assert.EqualValues(t, 3, migratedBalance.Round)
				assert.True(t, migratedBalance.Below)
				assert.Zero(t, migratedBalance.SettingsVersion)
				var migrated TelegramBotConnection
				require.NoError(t, db.First(&migrated, user.Id).Error)
				assert.EqualValues(t, 7, migrated.Version)
				assert.Zero(t, migrated.AuthorizationVersion)
				assert.Zero(t, migrated.LastStateEventAt)
				var nulls int64
				require.NoError(t, db.Model(&TelegramBotConnection{}).Where("authorization_version IS NULL OR last_state_event_at IS NULL OR last_state_update_id IS NULL").Count(&nulls).Error)
				assert.Zero(t, nulls)
				require.NoError(t, db.Model(&TelegramBotInbox{}).Where("authorization_version IS NULL OR command_at IS NULL OR command_checked IS NULL OR command_accepted IS NULL").Count(&nulls).Error)
				assert.Zero(t, nulls)
				require.NoError(t, db.Model(&migrated).Update("authorization_version", gorm.Expr("authorization_version + 1")).Error)
				require.NoError(t, db.First(&migrated, user.Id).Error)
				assert.EqualValues(t, 1, migrated.AuthorizationVersion)
				require.NoError(t, db.Delete(&legacyConn).Error)
				require.NoError(t, db.Delete(&legacyInbox).Error)
				require.NoError(t, db.Delete(&legacyConfig).Error)
				require.NoError(t, db.Delete(&legacyBalance).Error)
			})
			system_setting.SetTelegramBotEnabled(true)
			common.QuotaRemindEnabled, common.QuotaRemindThreshold = true, 1000
			cfg := TelegramBotConfig{ID: 1, Enabled: true, BotID: 12345, BotUsername: "contract_bot", Version: 1, Token: "unused-test-token"}
			require.NoError(t, db.Create(&cfg).Error)
			prefs := TelegramBotPreferences{Enabled: true, LowBalance: true, TopUp: true, Subscription: true, Expiry: true}
			intent, err := BeginTelegramBotOAuth(user.Id, prefs)
			require.NoError(t, err)
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return CompleteTelegramBotOAuthTx(tx, user.Id, "42", intent, true) }))
			require.Error(t, db.Transaction(func(tx *gorm.DB) error { return CompleteTelegramBotOAuthTx(tx, user.Id, "42", intent, true) }))
			conn, err := GetTelegramBotConnection(user.Id)
			require.NoError(t, err)
			require.NoError(t, ConfirmTelegramBotConnection(conn, 42))
			conn, err = GetTelegramBotConnection(user.Id)
			require.NoError(t, err)
			assert.Equal(t, TelegramBotConnected, conn.Status)

			t.Run("oauth_authorization_connects_before_welcome_delivery", func(t *testing.T) {
				for index, notificationPrefs := range []TelegramBotPreferences{{Enabled: true, LowBalance: true}, {}} {
					telegramID := strconv.Itoa(55 + index)
					other := User{Username: "telegram-instant-" + telegramID, AffCode: "tg-instant-" + telegramID, Status: common.UserStatusEnabled, TelegramId: telegramID, Quota: 2000}
					require.NoError(t, db.Create(&other).Error)
					intent, err := BeginTelegramBotOAuth(other.Id, notificationPrefs)
					require.NoError(t, err)
					require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
						return CompleteTelegramBotOAuthTx(tx, other.Id, telegramID, intent, true)
					}))
					connected, err := GetTelegramBotConnection(other.Id)
					require.NoError(t, err)
					assert.Equal(t, TelegramBotConnected, connected.Status)
					assert.Positive(t, connected.ConnectedAt)
					assert.Equal(t, telegramID, connected.ChatID)
					assert.Equal(t, notificationPrefs, connected.Preferences)
					var tasks []TelegramBotOutbox
					require.NoError(t, db.Where("user_id = ?", other.Id).Find(&tasks).Error)
					require.Len(t, tasks, 1)
					require.Equal(t, "welcome", tasks[0].Kind)
					welcome := tasks[0]
					welcome.Status, welcome.LeaseOwner, welcome.LeaseUntil = "processing", "instant-welcome", time.Now().Unix()+120
					require.NoError(t, db.Save(&welcome).Error)
					allowed, err := AuthorizeTelegramBotSend(&welcome)
					require.NoError(t, err)
					assert.True(t, allowed, "welcome delivery is independent of proactive notification preferences")
					require.NoError(t, FinishTelegramBotOutbox(&welcome, "failed", "temporary welcome failure", 0))
					after, err := GetTelegramBotConnection(other.Id)
					require.NoError(t, err)
					assert.Equal(t, *connected, *after, "welcome failure must not revoke a completed authorization")
					tgID, err := strconv.ParseInt(telegramID, 10, 64)
					require.NoError(t, err)
					require.NoError(t, ConfirmTelegramBotConnection(connected, tgID))
					require.ErrorIs(t, ConfirmTelegramBotConnection(connected, tgID+100), ErrTelegramBotExpired)
					require.ErrorIs(t, db.Transaction(func(tx *gorm.DB) error {
						return CompleteTelegramBotOAuthTx(tx, other.Id, telegramID, intent, true)
					}), ErrTelegramBotExpired)
					if notificationPrefs.LowBalance {
						var baseline TelegramLowBalanceState
						require.NoError(t, db.First(&baseline, other.Id).Error)
						assert.EqualValues(t, 1, baseline.Round)
						assert.Equal(t, connected.Version, baseline.ConnectionVersion)
						assert.False(t, baseline.Below)
					}
					require.NoError(t, DisconnectTelegramBot(other.Id))
					welcome.Status, welcome.LeaseOwner, welcome.LeaseUntil = "processing", "late-welcome", time.Now().Unix()+120
					require.NoError(t, db.Save(&welcome).Error)
					allowed, err = AuthorizeTelegramBotSend(&welcome)
					require.NoError(t, err)
					assert.False(t, allowed, "disconnect still revokes a pending welcome")
				}
			})

			t.Run("unknown_oauth_permission_automatically_verifies_delivery", func(t *testing.T) {
				other, connecting := telegramBotConnectionFixture(t, "unknown-permission", "57", TelegramBotPreferences{}, false)
				require.Equal(t, TelegramBotConnecting, connecting.Status)
				assert.Zero(t, connecting.ConnectedAt)
				var task TelegramBotOutbox
				require.NoError(t, db.Where("user_id = ?", other.Id).First(&task).Error)
				require.Equal(t, "connect", task.Kind)
				task.Status, task.LeaseOwner, task.LeaseUntil = "processing", "unknown-permission", time.Now().Unix()+120
				require.NoError(t, db.Save(&task).Error)
				allowed, err := AuthorizeTelegramBotSend(&task)
				require.NoError(t, err)
				assert.True(t, allowed, "关闭主动通知仍应自动验证本次明确选择的机器人连接")
				require.ErrorIs(t, ConfirmTelegramBotConnection(connecting, 58), ErrTelegramBotExpired)
				require.NoError(t, ConfirmTelegramBotConnection(connecting, 57))
				connected, err := GetTelegramBotConnection(other.Id)
				require.NoError(t, err)
				assert.Equal(t, TelegramBotConnected, connected.Status)
				assert.Positive(t, connected.ConnectedAt)
				assert.Equal(t, connecting.Version, connected.Version)
				require.NoError(t, DisconnectTelegramBot(other.Id))
				require.ErrorIs(t, ConfirmTelegramBotConnection(connecting, 57), ErrTelegramBotExpired, "迟到的成功投递不能恢复用户主动断开的连接")
			})

			t.Run("checkin_is_atomic_and_daily", func(t *testing.T) {
				*operation_setting.GetCheckinSetting() = operation_setting.CheckinSetting{Enabled: true, MinQuota: 100, MaxQuota: 100}
				_, err := UserCheckinForDate(user.Id, CheckinBusinessDate(time.Now().AddDate(0, 0, -1)))
				require.Error(t, err)
				var results [2]error
				var wg sync.WaitGroup
				for i := range 2 {
					wg.Go(func() { _, results[i] = UserCheckin(user.Id) })
				}
				wg.Wait()
				successes := 0
				for _, err := range results {
					if err == nil {
						successes++
					}
				}
				assert.Equal(t, 1, successes)
				require.NoError(t, db.First(&saved, user.Id).Error)
				assert.Equal(t, 2100, saved.Quota)
				assert.Equal(t, 100, saved.UnpaidQuotaBalance)
				require.NoError(t, db.Where("user_id = ?", user.Id).Delete(&Checkin{}).Error)
				require.NoError(t, db.Model(&User{}).Where("id = ?", user.Id).Update("quota", common.MaxWalletQuota).Error)
				_, err = UserCheckin(user.Id)
				require.Error(t, err)
				var count int64
				require.NoError(t, db.Model(&Checkin{}).Where("user_id = ?", user.Id).Count(&count).Error)
				assert.Zero(t, count)
				operation_setting.GetCheckinSetting().MinQuota, operation_setting.GetCheckinSetting().MaxQuota = 0, 0
				_, err = UserCheckin(user.Id)
				require.NoError(t, err, "zero reward must be supported on MySQL as well")
			})

			t.Run("events_commit_with_wallet_only_once", func(t *testing.T) {
				require.NoError(t, db.Model(&User{}).Where("id = ?", user.Id).Update("quota", 2000).Error)
				order := TopUp{UserId: user.Id, TradeNo: "contract-topup", Status: common.TopUpStatusPending}
				require.NoError(t, db.Create(&order).Error)
				order.CompleteTime = common.GetTimestamp()
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return creditTopUpAndNotifyTx(tx, &order, 100, 100, nil, "test") }))
				var count int64
				require.NoError(t, db.Model(&TelegramBotOutbox{}).Where("kind = ?", "topup").Count(&count).Error)
				assert.EqualValues(t, 1, count)
				require.NoError(t, db.First(&saved, user.Id).Error)
				assert.Equal(t, 2100, saved.Quota)
				rollback := errors.New("rollback business")
				err := db.Transaction(func(tx *gorm.DB) error {
					other := TopUp{UserId: user.Id, TradeNo: "rollback-topup", CompleteTime: common.GetTimestamp()}
					if err := tx.Create(&other).Error; err != nil {
						return err
					}
					if err := creditTopUpAndNotifyTx(tx, &other, 100, 100, nil, "test"); err != nil {
						return err
					}
					return rollback
				})
				require.ErrorIs(t, err, rollback)
				require.NoError(t, db.First(&saved, user.Id).Error)
				assert.Equal(t, 2100, saved.Quota)
				require.NoError(t, db.Model(&TelegramBotOutbox{}).Where("kind = ?", "topup").Count(&count).Error)
				assert.EqualValues(t, 1, count)
			})

			t.Run("persistent_low_balance_rounds", func(t *testing.T) {
				require.NoError(t, db.Model(&User{}).Where("id = ?", user.Id).Update("quota", 500).Error)
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				var first TelegramBotOutbox
				require.NoError(t, db.Where("kind = ?", "low_balance").First(&first).Error)
				var event TelegramBusinessEvent
				require.NoError(t, common.UnmarshalJsonStr(first.Payload, &event))
				valid, err := TelegramBusinessEventStillValid(&event)
				require.NoError(t, err)
				assert.True(t, valid)
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
					if err := tx.Model(&User{}).Where("id = ?", user.Id).Update("quota", 2000).Error; err != nil {
						return err
					}
					return ResetTelegramLowBalanceAfterCreditTx(tx, user.Id)
				}))
				require.NoError(t, db.Model(&User{}).Where("id = ?", user.Id).Update("quota", 500).Error)
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				valid, err = TelegramBusinessEventStillValid(&event)
				require.NoError(t, err)
				assert.False(t, valid, "previous round must not send after recovery and a new drop")
				var count int64
				require.NoError(t, db.Model(&TelegramBotOutbox{}).Where("kind = ?", "low_balance").Count(&count).Error)
				assert.EqualValues(t, 2, count)
			})

			t.Run("concurrent_credit_preserves_the_next_low_balance_round", func(t *testing.T) {
				other, _ := telegramBotConnectionFixture(t, "concurrent-credit", "51", TelegramBotPreferences{Enabled: true, LowBalance: true}, true)
				require.NoError(t, db.Model(&User{}).Where("id = ?", other.Id).Update("quota", 500).Error)
				credit := func() error {
					return db.Transaction(func(tx *gorm.DB) error {
						if err := tx.Model(&User{}).Where("id = ?", other.Id).Update("quota", 2000).Error; err != nil {
							return err
						}
						return ResetTelegramLowBalanceAfterCreditTx(tx, other.Id)
					})
				}
				if dialect == "sqlite" {
					require.NoError(t, scanTelegramUserReminders(context.Background(), other.Id, cfg.BotID, true))
					require.NoError(t, credit())
				} else {
					locked, release, creditStarted := make(chan struct{}), make(chan struct{}), make(chan struct{})
					scanResult, creditResult := make(chan error, 1), make(chan error, 1)
					var gate sync.Once
					const marker = "telegram-low-balance-lock-regression"
					require.NoError(t, db.Callback().Query().After("gorm:query").Register(marker, func(tx *gorm.DB) {
						if tx.Statement.Context.Value(marker) == true && tx.Statement.Table == "users" {
							gate.Do(func() { close(locked); <-release })
						}
					}))
					t.Cleanup(func() { require.NoError(t, db.Callback().Query().Remove(marker)) })
					go func() {
						scanResult <- scanTelegramUserReminders(context.WithValue(context.Background(), marker, true), other.Id, cfg.BotID, true)
					}()
					select {
					case <-locked:
					case err := <-scanResult:
						t.Fatalf("scan finished before locking the user: %v", err)
					}
					go func() { close(creditStarted); creditResult <- credit() }()
					<-creditStarted
					close(release)
					require.NoError(t, <-scanResult)
					require.NoError(t, <-creditResult)
				}
				var state TelegramLowBalanceState
				require.NoError(t, db.First(&state, other.Id).Error)
				assert.False(t, state.Below, "credit committed after the scan must preserve recovery")
				require.NoError(t, db.Model(&User{}).Where("id = ?", other.Id).Update("quota", 500).Error)
				require.NoError(t, scanTelegramUserReminders(context.Background(), other.Id, cfg.BotID, true))
				var count int64
				require.NoError(t, db.Model(&TelegramBotOutbox{}).Where("user_id = ? AND kind = ?", other.Id, "low_balance").Count(&count).Error)
				assert.EqualValues(t, 2, count, "a later drop must produce the next reminder")
			})

			t.Run("inbox_deduplication_and_exclusive_leases", func(t *testing.T) {
				input := TelegramBotInbox{BotID: cfg.BotID, UpdateID: 1, TelegramID: "42", ChatID: "42", Command: "/balance", MessageAt: time.Now().Unix()}
				require.NoError(t, AcceptTelegramBotInbox(&input))
				input.ID = 0
				require.NoError(t, AcceptTelegramBotInbox(&input))
				input.ID, input.UpdateID = 0, 0
				require.NoError(t, AcceptTelegramBotInbox(&input), "out-of-order updates remain valid")
				var count int64
				require.NoError(t, db.Model(&TelegramBotInbox{}).Count(&count).Error)
				assert.EqualValues(t, 2, count)
				first, err := ClaimTelegramBotInbox("worker-one")
				require.NoError(t, err)
				require.NotNil(t, first)
				second, err := ClaimTelegramBotInbox("worker-two")
				require.NoError(t, err)
				require.NotNil(t, second)
				assert.NotEqual(t, first.ID, second.ID)
				third, err := ClaimTelegramBotInbox("worker-three")
				require.NoError(t, err)
				assert.Nil(t, third)
			})

			t.Run("expiry_revalidation_never_retargets_old_tasks", func(t *testing.T) {
				other := User{Username: "telegram-expiry", AffCode: "tg-expiry", Status: common.UserStatusEnabled, TelegramId: "44", Quota: 2000}
				require.NoError(t, db.Create(&other).Error)
				expiryPrefs := TelegramBotPreferences{Enabled: true, Expiry: true}
				intent, err := BeginTelegramBotOAuth(other.Id, expiryPrefs)
				require.NoError(t, err)
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return CompleteTelegramBotOAuthTx(tx, other.Id, "44", intent, true) }))
				connected, err := GetTelegramBotConnection(other.Id)
				require.NoError(t, err)
				require.NoError(t, ConfirmTelegramBotConnection(connected, 44))
				t.Cleanup(func() {
					require.NoError(t, db.Model(&TelegramBotConfig{}).Where("id = ?", cfg.ID).Updates(map[string]any{"bot_id": cfg.BotID, "version": cfg.Version}).Error)
				})
				now := time.Now().Unix()
				subscription := UserSubscription{UserId: other.Id, StartTime: now - 48*3600, EndTime: now + 3600, Status: "active"}
				require.NoError(t, db.Create(&subscription).Error)
				short := UserSubscription{UserId: other.Id, StartTime: now - 60, EndTime: now + 1800, Status: "active"}
				require.NoError(t, db.Create(&short).Error)
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				var tasks []TelegramBotOutbox
				require.NoError(t, db.Where("user_id = ? AND kind = ?", other.Id, "expiry").Find(&tasks).Error)
				require.Len(t, tasks, 1, "repeated scans deduplicate and short subscriptions do not send a second reminder")
				original := tasks[0]
				var event TelegramBusinessEvent
				require.NoError(t, common.UnmarshalJsonStr(original.Payload, &event))
				valid, err := TelegramBusinessEventStillValid(&event)
				require.NoError(t, err)
				assert.True(t, valid)
				for _, change := range []map[string]any{{"end_time": now + 72*3600}, {"end_time": subscription.EndTime, "status": "cancelled"}} {
					require.NoError(t, db.Model(&subscription).Updates(change).Error)
					valid, err = TelegramBusinessEventStillValid(&event)
					require.NoError(t, err)
					assert.False(t, valid, "renewed or cancelled subscriptions invalidate pending reminders")
				}
				require.NoError(t, db.Delete(&subscription).Error)
				valid, err = TelegramBusinessEventStillValid(&event)
				require.NoError(t, err)
				assert.False(t, valid)
				subscription.Status, subscription.EndTime = "active", event.ExpiresAt
				require.NoError(t, db.Create(&subscription).Error)

				// 同一连接重新开启提醒只重新评估尚未发送的任务。
				for _, enabled := range []bool{false, true} {
					connected, err = GetTelegramBotConnection(other.Id)
					require.NoError(t, err)
					expiryPrefs.Expiry = enabled
					require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
						return UpdateTelegramBotPreferencesTx(tx, other.Id, connected.PreferencesVersion, expiryPrefs)
					}))
					if !enabled {
						require.NoError(t, db.Model(&original).Update("status", "cancelled").Error)
					}
				}
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				var retried TelegramBotOutbox
				require.NoError(t, db.First(&retried, original.ID).Error)
				assert.Equal(t, "pending", retried.Status)
				assert.Equal(t, original.ChatID, retried.ChatID)
				assert.Greater(t, retried.PreferenceVersion, original.PreferenceVersion)

				// 新连接和换机器人各建新任务，旧任务的接收目标不可改变。
				for i, botID := range []int64{cfg.BotID, cfg.BotID + 1} {
					require.NoError(t, db.Model(&TelegramBotConfig{}).Where("id = ?", cfg.ID).Update("bot_id", botID).Error)
					require.NoError(t, db.Model(&TelegramBotConnection{}).Where("user_id = ?", other.Id).Updates(map[string]any{"bot_id": botID, "version": gorm.Expr("version + 1"), "chat_id": []string{"144", "244"}[i]}).Error)
					require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				}
				require.NoError(t, db.Where("user_id = ? AND kind = ?", other.Id, "expiry").Order("id").Find(&tasks).Error)
				require.Len(t, tasks, 3)
				assert.Equal(t, original.BotID, tasks[0].BotID)
				assert.Equal(t, original.ConnectionVersion, tasks[0].ConnectionVersion)
				assert.Equal(t, original.ChatID, tasks[0].ChatID)
				assert.Equal(t, "144", tasks[1].ChatID)
				assert.Equal(t, "244", tasks[2].ChatID)
				assert.Equal(t, tasks[0].BusinessKey, tasks[2].BusinessKey)
				require.NoError(t, db.Model(&tasks[2]).Update("status", "sent").Error)
				require.NoError(t, db.Model(&TelegramBotConnection{}).Where("user_id = ?", other.Id).Update("version", gorm.Expr("version + 1")).Error)
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				var count int64
				require.NoError(t, db.Model(&TelegramBotOutbox{}).Where("business_key = ?", original.BusinessKey).Count(&count).Error)
				assert.EqualValues(t, 3, count, "delivered reminders must not revive after another reconnection")
			})

			t.Run("preferences_and_disconnect_invalidate_old_flows", func(t *testing.T) {
				intent, err := BeginTelegramBotOAuth(user.Id, prefs)
				require.NoError(t, err)
				conn, err := GetTelegramBotConnection(user.Id)
				require.NoError(t, err)
				prefs.TopUp = false
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
					return UpdateTelegramBotPreferencesTx(tx, user.Id, conn.PreferencesVersion, prefs)
				}))
				require.ErrorIs(t, db.Transaction(func(tx *gorm.DB) error {
					return UpdateTelegramBotPreferencesTx(tx, user.Id, conn.PreferencesVersion, prefs)
				}), ErrTelegramBotChanged)
				require.ErrorIs(t, db.Transaction(func(tx *gorm.DB) error { return CompleteTelegramBotOAuthTx(tx, user.Id, "42", intent, true) }), ErrTelegramBotExpired, "old authorization cannot overwrite newer notification choices")
				require.NoError(t, DisconnectTelegramBot(user.Id))
				require.Error(t, db.Transaction(func(tx *gorm.DB) error { return CompleteTelegramBotOAuthTx(tx, user.Id, "42", intent, true) }))
				require.NoError(t, db.First(&saved, user.Id).Error)
				assert.Equal(t, "42", saved.TelegramId, "disconnect must keep the website login identity")
			})

			t.Run("recovery_uses_current_preferences_and_rejects_later_changes", func(t *testing.T) {
				other, connected := telegramBotConnectionFixture(t, "recovery", "45", prefs, true)
				disabled := TelegramBotPreferences{}
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
					return UpdateTelegramBotPreferencesTx(tx, other.Id, connected.PreferencesVersion, disabled)
				}))
				identity := AuthSessionIdentity{UserID: other.Id, SessionID: "telegram-recovery-contract", UserAuthVersion: other.AuthVersion, SessionVersion: 1}
				session := UserSession{SID: identity.SessionID, UserID: other.Id, UserAuthVersion: other.AuthVersion, Version: 1, Status: UserSessionStatusActive, ExpiresAt: time.Now().Unix() + 3600}
				require.NoError(t, db.Create(&session).Error)
				token, flow, err := CreateTelegramBotRecovery(identity)
				require.NoError(t, err)
				var payload telegramBotRecoveryPayload
				require.NoError(t, common.UnmarshalJsonStr(flow.Payload, &payload))
				assert.Equal(t, disabled, payload.Intent.Preferences, "recovery must not resurrect earlier notification choices")
				require.NoError(t, ObserveTelegramBotRecovery(flow.TokenHash, "45", "45", &cfg))
				connected, err = GetTelegramBotConnection(other.Id)
				require.NoError(t, err)
				disabled.TopUp = true
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
					return UpdateTelegramBotPreferencesTx(tx, other.Id, connected.PreferencesVersion, disabled)
				}))
				require.ErrorIs(t, ConfirmTelegramBotRecovery(token, identity), ErrTelegramBotExpired)
			})

			t.Run("telegram_low_balance_uses_its_own_switch_and_does_not_replay_on_enable", func(t *testing.T) {
				previousEnabled, previousThreshold := common.QuotaRemindEnabled, common.QuotaRemindThreshold
				previousConfig, err := GetTelegramBotConfig()
				require.NoError(t, err)
				t.Cleanup(func() {
					common.QuotaRemindEnabled, common.QuotaRemindThreshold = previousEnabled, previousThreshold
					require.NoError(t, db.Save(previousConfig).Error)
				})
				common.QuotaRemindEnabled, common.QuotaRemindThreshold = true, 0
				other, connected := telegramBotConnectionFixture(t, "zero", "46", TelegramBotPreferences{Enabled: true, LowBalance: true}, true)
				assert.Equal(t, TelegramBotConnected, connected.Status)
				var state TelegramLowBalanceState
				require.NoError(t, db.First(&state, other.Id).Error)
				assert.Zero(t, state.Threshold)
				assert.False(t, state.Below)
				require.NoError(t, db.Model(&cfg).Updates(map[string]any{"low_balance_enabled": false, "reminder_version": gorm.Expr("reminder_version + 1")}).Error)
				common.QuotaRemindEnabled, common.QuotaRemindThreshold = false, -1
				_, connected = telegramBotConnectionFixture(t, "disabled", "47", TelegramBotPreferences{Enabled: true, LowBalance: true}, true)
				assert.Equal(t, TelegramBotConnected, connected.Status)
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
					return UpdateTelegramBotPreferencesTx(tx, connected.UserID, connected.PreferencesVersion, TelegramBotPreferences{})
				}))
				connected, err = GetTelegramBotConnection(connected.UserID)
				require.NoError(t, err)
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
					return UpdateTelegramBotPreferencesTx(tx, connected.UserID, connected.PreferencesVersion, TelegramBotPreferences{Enabled: true, LowBalance: true})
				}))

				// 邮件提醒关闭后，Telegram 独立开关仍应触发新一轮低余额提醒。
				common.QuotaRemindThreshold = 1000
				require.NoError(t, db.Model(&cfg).Updates(map[string]any{"low_balance_enabled": true, "reminder_version": gorm.Expr("reminder_version + 1")}).Error)
				emailDisabled, _ := telegramBotConnectionFixture(t, "email-disabled", "90", TelegramBotPreferences{Enabled: true, LowBalance: true}, true)
				require.NoError(t, db.Model(emailDisabled).Update("quota", 500).Error)
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				var task TelegramBotOutbox
				require.NoError(t, db.Where("user_id = ? AND kind = ?", emailDisabled.Id, "low_balance").First(&task).Error)
				var event TelegramBusinessEvent
				require.NoError(t, common.UnmarshalJsonStr(task.Payload, &event))
				valid, err := TelegramBusinessEventStillValid(&event)
				require.NoError(t, err)
				assert.True(t, valid)
				require.NoError(t, db.Model(&cfg).Updates(map[string]any{"low_balance_enabled": false, "reminder_version": gorm.Expr("reminder_version + 1")}).Error)
				valid, err = TelegramBusinessEventStillValid(&event)
				require.NoError(t, err)
				assert.False(t, valid)
				require.NoError(t, db.Model(&cfg).Updates(map[string]any{"low_balance_enabled": true, "reminder_version": gorm.Expr("reminder_version + 1")}).Error)
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				valid, err = TelegramBusinessEventStillValid(&event)
				require.NoError(t, err)
				assert.False(t, valid, "重新开启后台提醒不能复活关闭前的任务")
				var count int64
				require.NoError(t, db.Model(&TelegramBotOutbox{}).Where("user_id = ? AND kind = ?", emailDisabled.Id, "low_balance").Count(&count).Error)
				assert.EqualValues(t, 1, count, "重新开启时仅建立当前余额基线")
			})

			t.Run("authorized_private_start_confirms_only_the_current_connection", func(t *testing.T) {
				other, connecting := telegramBotConnectionFixture(t, "private-start", "53", prefs, false)
				now := time.Now().Unix()
				connecting.LastStateEventAt, connecting.LastStateUpdateID = now-600, 0
				connecting.LastError = "temporary welcome failure"
				base := TelegramBotInbox{BotID: cfg.BotID, UserID: other.Id, TelegramID: "53", ChatID: "53", Command: "/start", ConnectionVersion: connecting.Version, AuthorizationVersion: connecting.AuthorizationVersion, MessageAt: now, UpdateID: 2000}
				for _, test := range []struct {
					name   string
					change func(*TelegramBotInbox, *TelegramBotConnection)
				}{
					{"old_connection", func(row *TelegramBotInbox, _ *TelegramBotConnection) { row.ConnectionVersion-- }},
					{"old_authorization", func(row *TelegramBotInbox, _ *TelegramBotConnection) { row.AuthorizationVersion-- }},
					{"different_bot", func(row *TelegramBotInbox, _ *TelegramBotConnection) { row.BotID++ }},
					{"different_identity", func(row *TelegramBotInbox, _ *TelegramBotConnection) { row.TelegramID = "54" }},
					{"different_chat", func(row *TelegramBotInbox, _ *TelegramBotConnection) { row.ChatID = "54" }},
					{"expired_message", func(row *TelegramBotInbox, _ *TelegramBotConnection) { row.MessageAt = now - 301 }},
					{"future_message", func(row *TelegramBotInbox, _ *TelegramBotConnection) { row.MessageAt = now + 60 }},
					{"recovery_needs_browser", func(row *TelegramBotInbox, _ *TelegramBotConnection) { row.FlowHash = "recovery-flow" }},
					{"other_command", func(row *TelegramBotInbox, _ *TelegramBotConnection) { row.Command = "/help" }},
					{"explicit_disconnect", func(_ *TelegramBotInbox, conn *TelegramBotConnection) { conn.Status = TelegramBotDisconnected }},
					{"no_active_grant", func(_ *TelegramBotInbox, conn *TelegramBotConnection) { conn.Status = TelegramBotUnconnected }},
				} {
					t.Run(test.name, func(t *testing.T) {
						row, current := base, *connecting
						test.change(&row, &current)
						require.NoError(t, db.Save(&current).Error)
						restored, err := ApplyTelegramBotStateEvent(&row, false)
						require.NoError(t, err)
						assert.False(t, restored)
						saved, err := GetTelegramBotConnection(other.Id)
						require.NoError(t, err)
						assert.Equal(t, current.Status, saved.Status)
						assert.Zero(t, saved.ConnectedAt)
					})
				}
				require.NoError(t, db.Save(connecting).Error)
				require.NoError(t, db.Model(&cfg).Update("enabled", false).Error)
				_, err := ApplyTelegramBotStateEvent(&base, false)
				require.NoError(t, err)
				current, err := GetTelegramBotConnection(other.Id)
				require.NoError(t, err)
				assert.Equal(t, TelegramBotConnecting, current.Status)
				require.NoError(t, db.Model(&cfg).Update("enabled", true).Error)
				require.NoError(t, db.Model(other).Update("status", common.UserStatusDisabled).Error)
				_, err = ApplyTelegramBotStateEvent(&base, false)
				require.NoError(t, err)
				current, err = GetTelegramBotConnection(other.Id)
				require.NoError(t, err)
				assert.Equal(t, TelegramBotConnecting, current.Status)
				require.NoError(t, db.Model(other).Update("status", common.UserStatusEnabled).Error)
				restored, err := ApplyTelegramBotStateEvent(&base, false)
				require.NoError(t, err)
				assert.False(t, restored, "direct confirmation continues to the normal command reply")
				current, err = GetTelegramBotConnection(other.Id)
				require.NoError(t, err)
				assert.Equal(t, TelegramBotConnected, current.Status)
				assert.Empty(t, current.LastError)
				assert.Positive(t, current.ConnectedAt)
				assert.Equal(t, connecting.Version, current.Version)
				assert.Equal(t, connecting.AuthorizationVersion, current.AuthorizationVersion)
				assert.Equal(t, connecting.Preferences, current.Preferences)
				assert.Equal(t, connecting.PreferencesVersion, current.PreferencesVersion)
				var baseline TelegramLowBalanceState
				require.NoError(t, db.First(&baseline, other.Id).Error)
				base.MessageAt, base.UpdateID = now+1, base.UpdateID+1
				_, err = ApplyTelegramBotStateEvent(&base, false)
				require.NoError(t, err)
				var after TelegramLowBalanceState
				require.NoError(t, db.First(&after, other.Id).Error)
				assert.Equal(t, baseline, after, "another start must not reset the low balance baseline")
			})

			t.Run("public_help_is_not_authorized_after_the_recipient_connects", func(t *testing.T) {
				other := User{Username: "telegram-help", AffCode: "tg-help", Status: common.UserStatusEnabled, TelegramId: "54"}
				require.NoError(t, db.Create(&other).Error)
				row := TelegramBotOutbox{EventKey: TelegramBotMessageDigest("stale-public-help"), Kind: "help", BotID: cfg.BotID, ChatID: "54", Status: "processing", LeaseOwner: "help-contract", LeaseUntil: time.Now().Unix() + 120, ExpiresAt: time.Now().Unix() + 300}
				require.NoError(t, db.Create(&row).Error)
				allowed, err := AuthorizeTelegramBotSend(&row)
				require.NoError(t, err)
				assert.True(t, allowed, "login identity alone does not authorize a bot connection")
				intent, err := BeginTelegramBotOAuth(other.Id, prefs)
				require.NoError(t, err)
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return CompleteTelegramBotOAuthTx(tx, other.Id, "54", intent, true) }))
				allowed, err = AuthorizeTelegramBotSend(&row)
				require.NoError(t, err)
				assert.False(t, allowed, "a queued not-active hint is obsolete while connecting")
				var discarded TelegramBotOutbox
				require.NoError(t, db.First(&discarded, row.ID).Error)
				assert.Equal(t, "discarded", discarded.Status)
				assert.Empty(t, discarded.LeaseOwner)
				assert.Zero(t, discarded.LeaseUntil)
				connecting, err := GetTelegramBotConnection(other.Id)
				require.NoError(t, err)
				require.NoError(t, ConfirmTelegramBotConnection(connecting, 54))
				require.NoError(t, db.Save(&row).Error)
				allowed, err = AuthorizeTelegramBotSend(&row)
				require.NoError(t, err)
				assert.False(t, allowed, "a queued not-active hint must not contradict a connected account")
				row.ChatID = "999999"
				require.NoError(t, db.Save(&row).Error)
				allowed, err = AuthorizeTelegramBotSend(&row)
				require.NoError(t, err)
				assert.True(t, allowed, "an unrelated recipient can still receive public help")
			})

			t.Run("command_admission_uses_original_time_and_is_retryable", func(t *testing.T) {
				other, connected := telegramBotConnectionFixture(t, "commands", "48", prefs, true)
				now := time.Now().Unix()
				for index, test := range []struct {
					messageAt, receivedAt int64
					accepted              bool
				}{{now + 10, now, true}, {now + 11, now + 1, false}, {now - 5, now + 2, true}, {now - 2, now + 2, true}} {
					row := TelegramBotInbox{BotID: cfg.BotID, UpdateID: int64(1000 + index), UserID: other.Id, TelegramID: "48", ChatID: "48", ConnectionVersion: connected.Version, AuthorizationVersion: connected.AuthorizationVersion, MessageAt: test.messageAt, ReceivedAt: test.receivedAt, Status: "processing", LeaseOwner: "command-contract", LeaseUntil: now + 120}
					require.NoError(t, db.Create(&row).Error)
					accepted, err := AcceptTelegramBotCommand(&row)
					require.NoError(t, err)
					assert.Equal(t, test.accepted, accepted)
					accepted, err = AcceptTelegramBotCommand(&row)
					require.NoError(t, err)
					assert.Equal(t, test.accepted, accepted, "retry reuses admission even after another command is processed")
				}
			})

			t.Run("state_events_are_ordered_within_explicit_authorization", func(t *testing.T) {
				other, connected := telegramBotConnectionFixture(t, "state", "49", prefs, true)
				now := time.Now().Unix()
				row := TelegramBotInbox{BotID: cfg.BotID, UserID: other.Id, TelegramID: "49", ChatID: "49", ConnectionVersion: connected.Version, AuthorizationVersion: connected.AuthorizationVersion, MessageAt: now, UpdateID: 10}
				row.MessageAt = now - 10
				_, err := ApplyTelegramBotStateEvent(&row, true)
				require.NoError(t, err)
				current, err := GetTelegramBotConnection(other.Id)
				require.NoError(t, err)
				assert.Equal(t, TelegramBotConnected, current.Status, "older kicked arriving after explicit authorization must not revoke the new grant")
				row.MessageAt = now
				_, err = ApplyTelegramBotStateEvent(&row, true)
				require.NoError(t, err)
				row.MessageAt, row.UpdateID = now+10, 11
				restored, err := ApplyTelegramBotStateEvent(&row, false)
				require.NoError(t, err)
				assert.True(t, restored)
				row.MessageAt, row.UpdateID = now+5, 12
				_, err = ApplyTelegramBotStateEvent(&row, true)
				require.NoError(t, err)
				current, err = GetTelegramBotConnection(other.Id)
				require.NoError(t, err)
				assert.Equal(t, TelegramBotConnecting, current.Status, "late older kicked must not undo newer start")
				row.MessageAt, row.UpdateID = now+20, 13
				_, err = ApplyTelegramBotStateEvent(&row, true)
				require.NoError(t, err)
				current, err = GetTelegramBotConnection(other.Id)
				require.NoError(t, err)
				assert.Equal(t, TelegramBotBlocked, current.Status, "newer kicked remains effective even with the pre-recovery delivery version")
				row.UpdateID = 12
				restored, err = ApplyTelegramBotStateEvent(&row, false)
				require.NoError(t, err)
				assert.False(t, restored, "same-second events use update ID to reject older start")
				require.NoError(t, DisconnectTelegramBot(other.Id))
				row.MessageAt, row.UpdateID = now+30, 14
				restored, err = ApplyTelegramBotStateEvent(&row, false)
				require.NoError(t, err)
				assert.False(t, restored, "explicit disconnect invalidates old state events")
			})

			t.Run("final_send_authorization_and_welcome_failure_are_version_bound", func(t *testing.T) {
				other, connecting := telegramBotConnectionFixture(t, "send", "50", prefs, false)
				var row TelegramBotOutbox
				require.NoError(t, db.Where("user_id = ? AND kind = ?", other.Id, "connect").First(&row).Error)
				row.LeaseOwner, row.LeaseUntil, row.Status = "send-contract", time.Now().Unix()+120, "processing"
				require.NoError(t, db.Save(&row).Error)
				allowed, err := AuthorizeTelegramBotSend(&row)
				require.NoError(t, err)
				assert.True(t, allowed)
				require.NoError(t, FinishTelegramBotOutbox(&row, "failed", "expired", 0))
				current, err := GetTelegramBotConnection(other.Id)
				require.NoError(t, err)
				assert.Equal(t, TelegramBotUnconnected, current.Status)
				assert.Equal(t, "Telegram bot connection failed. Please reconnect.", current.LastError)
				require.ErrorIs(t, ConfirmTelegramBotConnection(connecting, 50), ErrTelegramBotExpired)
				allowed, err = AuthorizeTelegramBotSend(&row)
				require.NoError(t, err)
				assert.False(t, allowed)
				intent, err := BeginTelegramBotOAuth(other.Id, prefs)
				require.NoError(t, err)
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return CompleteTelegramBotOAuthTx(tx, other.Id, "50", intent, true) }))
				newer, err := GetTelegramBotConnection(other.Id)
				require.NoError(t, err)
				require.NoError(t, FinishTelegramBotOutbox(&row, "failed", "late failure", 0))
				current, err = GetTelegramBotConnection(other.Id)
				require.NoError(t, err)
				assert.Equal(t, newer.Version, current.Version)
				assert.Equal(t, TelegramBotConnected, current.Status)
				require.NoError(t, DisconnectTelegramBot(other.Id))
				require.ErrorIs(t, ConfirmTelegramBotConnection(newer, 50), ErrTelegramBotExpired)
			})

			t.Run("final_business_send_rechecks_notification_versions_and_disconnect", func(t *testing.T) {
				eventPrefs := TelegramBotPreferences{Enabled: true, TopUp: true}
				other, connected := telegramBotConnectionFixture(t, "send-business", "52", eventPrefs, true)
				for index, disableAll := range []bool{false, true} {
					event := TelegramBusinessEvent{UserID: other.Id, Kind: "topup", Key: "final-send-" + strconv.Itoa(index)}
					require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return EnqueueTelegramBusinessEventTx(tx, &event) }))
					var row TelegramBotOutbox
					require.NoError(t, db.Where("user_id = ? AND kind = ?", other.Id, "topup").Order("id desc").First(&row).Error)
					row.Status, row.LeaseOwner, row.LeaseUntil = "processing", "business-send", time.Now().Unix()+120
					require.NoError(t, db.Save(&row).Error)
					allowed, err := AuthorizeTelegramBotSend(&row)
					require.NoError(t, err)
					assert.True(t, allowed)
					for _, enabled := range []bool{false, true} {
						connected, err = GetTelegramBotConnection(other.Id)
						require.NoError(t, err)
						if disableAll {
							eventPrefs.Enabled = enabled
						} else {
							eventPrefs.TopUp = enabled
						}
						require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
							return UpdateTelegramBotPreferencesTx(tx, other.Id, connected.PreferencesVersion, eventPrefs)
						}))
						allowed, err = AuthorizeTelegramBotSend(&row)
						require.NoError(t, err)
						assert.False(t, allowed, "notifications disabled then re-enabled must not resurrect an old task")
					}
				}
				connected, err = GetTelegramBotConnection(other.Id)
				require.NoError(t, err)
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
					return EnqueueTelegramBotMessageTx(tx, connected, "test", "final-disconnect", "", time.Now().Unix()+300)
				}))
				var row TelegramBotOutbox
				require.NoError(t, db.Where("user_id = ? AND kind = ?", other.Id, "test").First(&row).Error)
				row.Status, row.LeaseOwner, row.LeaseUntil = "processing", "business-send", time.Now().Unix()+120
				require.NoError(t, db.Save(&row).Error)
				require.NoError(t, db.Model(&cfg).Update("enabled", false).Error)
				allowed, err := AuthorizeTelegramBotSend(&row)
				require.NoError(t, err)
				assert.False(t, allowed)
				require.NoError(t, db.Model(&cfg).Update("enabled", true).Error)
				require.NoError(t, DisconnectTelegramBot(other.Id))
				allowed, err = AuthorizeTelegramBotSend(&row)
				require.NoError(t, err)
				assert.False(t, allowed)
			})

			t.Run("group_ratio_snapshots_persist_and_notify_effective_changes_once", func(t *testing.T) {
				other, _ := telegramGroupRatioReminderFixture(t, "ratio-snapshot", "91")
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				var baseline TelegramGroupRatioState
				require.NoError(t, db.First(&baseline, other.Id).Error)
				var snapshot map[string]float64
				require.NoError(t, common.UnmarshalJsonStr(baseline.Snapshot, &snapshot))
				assert.Equal(t, map[string]float64{"standard": 1, "discount": 0.5, "free": 0}, snapshot)
				for range 2 {
					require.NoError(t, db.AutoMigrate(&TelegramGroupRatioState{}))
				}
				var persisted TelegramGroupRatioState
				require.NoError(t, db.Session(&gorm.Session{NewDB: true}).First(&persisted, other.Id).Error)
				assert.Equal(t, baseline, persisted, "重复迁移和新数据库会话不能清空已保存的倍率基线")
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				var count int64
				require.NoError(t, db.Model(&TelegramBotOutbox{}).Where("user_id = ? AND kind = ?", other.Id, "group_ratio").Count(&count).Error)
				assert.Zero(t, count, "首次读取不能群发历史倍率")

				// 特殊倍率覆盖普通倍率；不可用分组及 auto 的变化不应通知。
				require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"standard":2,"discount":10,"free":0,"hidden":9,"auto":2}`))
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"standard":0,"discount":10,"free":1,"hidden":9,"auto":2}`))
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(`{"vip":{"discount":0.25}}`))
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(`{"vip":{"discount":0}}`))
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(`{}`))
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))

				var tasks []TelegramBotOutbox
				require.NoError(t, db.Where("user_id = ? AND kind = ?", other.Id, "group_ratio").Order("id").Find(&tasks).Error)
				require.Len(t, tasks, 6)
				changes := make(map[string][][2]float64)
				for _, task := range tasks {
					var event TelegramBusinessEvent
					require.NoError(t, common.UnmarshalJsonStr(task.Payload, &event))
					assert.Equal(t, "vip", event.UserGroup)
					changes[event.GroupName] = append(changes[event.GroupName], [2]float64{event.OldRatio, event.NewRatio})
				}
				assert.Equal(t, map[string][][2]float64{
					"standard": {{1, 2}, {2, 0}},
					"free":     {{0, 1}},
					"discount": {{0.5, 0.25}, {0.25, 0}, {0, 10}},
				}, changes)

				// 新增及删除分组只更新快照，不生成倍率变动通知。
				require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"standard":"Standard","discount":"Discount","free":"Free","new":"New","auto":"Auto"}`))
				require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"discount":10,"free":1,"hidden":9,"auto":2,"new":1}`))
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				require.NoError(t, db.Model(&TelegramBotOutbox{}).Where("user_id = ? AND kind = ?", other.Id, "group_ratio").Count(&count).Error)
				assert.EqualValues(t, 6, count)

				// 陈旧节点不能把共享快照改回旧价；常规配置同步后再比较真实变化。
				const optionKey = "group_ratio_setting.group_ratio"
				const currentRatios = `{"discount":12,"free":1,"hidden":9,"auto":2,"new":1}`
				const staleRatios = `{"discount":1,"free":1,"hidden":9,"auto":2,"new":1}`
				var existingOption Option
				require.ErrorIs(t, db.Where(&Option{Key: optionKey}).First(&existingOption).Error, gorm.ErrRecordNotFound)
				option := Option{Key: optionKey, Value: currentRatios}
				require.NoError(t, db.Create(&option).Error)
				t.Cleanup(func() { require.NoError(t, db.Delete(&option).Error) })
				common.OptionMapRWMutex.Lock()
				previousValue, existed := common.OptionMap[optionKey]
				if common.OptionMap == nil {
					common.OptionMap = make(map[string]string)
				}
				common.OptionMap[optionKey] = staleRatios
				common.OptionMapRWMutex.Unlock()
				t.Cleanup(func() {
					common.OptionMapRWMutex.Lock()
					defer common.OptionMapRWMutex.Unlock()
					if existed {
						common.OptionMap[optionKey] = previousValue
					} else {
						delete(common.OptionMap, optionKey)
					}
				})
				require.NoError(t, db.First(&baseline, other.Id).Error)
				require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(staleRatios))
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				// 整轮检查通过后配置仍可能变化，用户事务不能复用已经过时的检查结果。
				require.NoError(t, scanTelegramUserReminders(context.Background(), other.Id, cfg.BotID, true))
				require.NoError(t, db.First(&persisted, other.Id).Error)
				assert.Equal(t, baseline, persisted)
				require.NoError(t, db.Model(&TelegramBotOutbox{}).Where("user_id = ? AND kind = ?", other.Id, "group_ratio").Count(&count).Error)
				assert.EqualValues(t, 6, count, "配置未同步时不生成反向价格消息")
				require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(currentRatios))
				common.OptionMapRWMutex.Lock()
				common.OptionMap[optionKey] = currentRatios
				common.OptionMapRWMutex.Unlock()
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				var currentTask TelegramBotOutbox
				require.NoError(t, db.Where("user_id = ? AND kind = ?", other.Id, "group_ratio").Order("id desc").First(&currentTask).Error)
				var currentEvent TelegramBusinessEvent
				require.NoError(t, common.UnmarshalJsonStr(currentTask.Payload, &currentEvent))
				assert.Equal(t, "discount", currentEvent.GroupName)
				assert.Equal(t, 10.0, currentEvent.OldRatio)
				assert.Equal(t, 12.0, currentEvent.NewRatio)
				currentTask.Status, currentTask.LeaseOwner, currentTask.LeaseUntil = "processing", "ratio-cache-sync", time.Now().Unix()+120
				require.NoError(t, db.Save(&currentTask).Error)
				common.OptionMapRWMutex.Lock()
				common.OptionMap[optionKey] = staleRatios
				common.OptionMapRWMutex.Unlock()
				allowed, err := AuthorizeTelegramBotSend(&currentTask)
				require.Error(t, err, "缓存不同步应保留可重试错误，不能当作永久失效丢弃")
				assert.False(t, allowed)
				common.OptionMapRWMutex.Lock()
				common.OptionMap[optionKey] = currentRatios
				common.OptionMapRWMutex.Unlock()
				allowed, err = AuthorizeTelegramBotSend(&currentTask)
				require.NoError(t, err)
				assert.True(t, allowed)
			})

			t.Run("group_ratio_visibility_preferences_and_connection_changes_only_reset_baselines", func(t *testing.T) {
				other, connected := telegramGroupRatioReminderFixture(t, "ratio-visibility", "92")
				visibility := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup
				visibility.Set("vip", map[string]string{"-:standard": ""})
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"standard":2,"discount":1,"free":0,"hidden":9,"auto":1}`))
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				visibility.Set("vip", map[string]string{"-:standard": "", "+:hidden": "Hidden"})
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				var count int64
				require.NoError(t, db.Model(&TelegramBotOutbox{}).Where("user_id = ? AND kind = ?", other.Id, "group_ratio").Count(&count).Error)
				assert.Zero(t, count, "用户新获得可用分组时不能收到之前的价格变化")
				require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"standard":3,"discount":1,"free":0,"hidden":10,"auto":1}`))
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				visibility.Set("vip", map[string]string{"-:standard": "", "-:hidden": ""})
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				visibility.Clear()
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))

				for _, enabled := range []bool{false, true} {
					connected, err = GetTelegramBotConnection(other.Id)
					require.NoError(t, err)
					require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
						return UpdateTelegramBotPreferencesTx(tx, other.Id, connected.PreferencesVersion, TelegramBotPreferences{Enabled: enabled})
					}))
					if !enabled {
						require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"standard":4,"discount":1,"free":0,"hidden":10,"auto":1}`))
					}
					require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				}
				require.NoError(t, db.Model(&TelegramBotOutbox{}).Where("user_id = ? AND kind = ?", other.Id, "group_ratio").Count(&count).Error)
				assert.EqualValues(t, 1, count, "重新启用用户总开关仅建立当前倍率基线")
				require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"standard":5,"discount":1,"free":0,"hidden":10,"auto":1}`))
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				require.NoError(t, db.Model(other).Update("group", "other").Error)
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				require.NoError(t, db.Model(&TelegramBotOutbox{}).Where("user_id = ? AND kind = ?", other.Id, "group_ratio").Count(&count).Error)
				assert.EqualValues(t, 2, count, "用户组变化导致有效倍率变化时应重新建基线")

				intent, err := BeginTelegramBotOAuth(other.Id, TelegramBotPreferences{Enabled: true})
				require.NoError(t, err)
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
					return CompleteTelegramBotOAuthTx(tx, other.Id, other.TelegramId, intent, true)
				}))
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"standard":6,"discount":1,"free":0,"hidden":10,"auto":1}`))
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				var tasks []TelegramBotOutbox
				require.NoError(t, db.Where("user_id = ? AND kind = ?", other.Id, "group_ratio").Order("id").Find(&tasks).Error)
				require.Len(t, tasks, 3)
				var latest TelegramBusinessEvent
				require.NoError(t, common.UnmarshalJsonStr(tasks[2].Payload, &latest))
				assert.Equal(t, "other", latest.UserGroup)
				assert.Equal(t, "standard", latest.GroupName)
				assert.Equal(t, 5.0, latest.OldRatio)
				assert.Equal(t, 6.0, latest.NewRatio)
			})

			t.Run("group_ratio_final_send_rejects_disabled_settings_and_stale_prices", func(t *testing.T) {
				other, _ := telegramGroupRatioReminderFixture(t, "ratio-send", "93")
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"standard":2,"discount":1,"free":0,"hidden":7,"auto":1}`))
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				var row TelegramBotOutbox
				require.NoError(t, db.Where("user_id = ? AND kind = ?", other.Id, "group_ratio").First(&row).Error)
				row.Status, row.LeaseOwner, row.LeaseUntil = "processing", "group-ratio-send", time.Now().Unix()+120
				require.NoError(t, db.Save(&row).Error)
				allowed, err := AuthorizeTelegramBotSend(&row)
				require.NoError(t, err)
				assert.True(t, allowed)
				for _, enabled := range []bool{false, true} {
					require.NoError(t, db.Model(&cfg).Updates(map[string]any{"group_ratio_change_enabled": enabled, "reminder_version": gorm.Expr("reminder_version + 1")}).Error)
					allowed, err = AuthorizeTelegramBotSend(&row)
					require.NoError(t, err)
					assert.False(t, allowed, "后台开关关闭后重新开启也不能恢复旧任务")
				}
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"standard":3,"discount":1,"free":0,"hidden":7,"auto":1}`))
				require.NoError(t, ScanTelegramReminderEvents(context.Background()))
				var newer TelegramBotOutbox
				require.NoError(t, db.Where("user_id = ? AND kind = ?", other.Id, "group_ratio").Order("id desc").First(&newer).Error)
				assert.NotEqual(t, row.ID, newer.ID)
				newer.Status, newer.LeaseOwner, newer.LeaseUntil = "processing", "group-ratio-new-send", time.Now().Unix()+120
				require.NoError(t, db.Save(&newer).Error)
				allowed, err = AuthorizeTelegramBotSend(&newer)
				require.NoError(t, err)
				assert.True(t, allowed)
				require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"standard":4,"discount":1,"free":0,"hidden":7,"auto":1}`))
				allowed, err = AuthorizeTelegramBotSend(&newer)
				require.NoError(t, err)
				assert.False(t, allowed, "发送前已失效的倍率不能发给用户")
				require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"standard":3,"discount":1,"free":0,"hidden":7,"auto":1}`))
				ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.Set("vip", map[string]string{"-:standard": ""})
				allowed, err = AuthorizeTelegramBotSend(&newer)
				require.NoError(t, err)
				assert.False(t, allowed, "用户已无法使用的分组不再发送价格通知")
			})

			t.Run("account_changes_reject_late_bot_checkins", func(t *testing.T) {
				other := User{Username: "telegram-lifecycle", AffCode: "tg-life", Status: common.UserStatusEnabled, TelegramId: "43", Quota: 3000}
				require.NoError(t, db.Create(&other).Error)
				*operation_setting.GetCheckinSetting() = operation_setting.CheckinSetting{Enabled: true, MinQuota: 100, MaxQuota: 100}
				day := CheckinBusinessDate(time.Now())
				intent, err := BeginTelegramBotOAuth(other.Id, prefs)
				require.NoError(t, err)
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return CompleteTelegramBotOAuthTx(tx, other.Id, "43", intent, true) }))
				connected, err := GetTelegramBotConnection(other.Id)
				require.NoError(t, err)
				require.NoError(t, ConfirmTelegramBotConnection(connected, 43))
				_, err = UserCheckinForTelegram(other.Id, day, cfg.BotID, "43", connected.Version)
				require.NoError(t, err)
				require.NoError(t, db.First(&other, other.Id).Error)
				assert.Equal(t, 3100, other.Quota)
				assert.Equal(t, 100, other.UnpaidQuotaBalance)
				require.NoError(t, db.Where("user_id = ?", other.Id).Delete(&Checkin{}).Error)

				// 断开提交后，已经入队的旧版本签到也不能再发奖。
				require.NoError(t, DisconnectTelegramBot(other.Id))
				_, err = UserCheckinForTelegram(other.Id, day, cfg.BotID, "43", connected.Version)
				require.ErrorIs(t, err, ErrTelegramBotNotConnected)
				intent, err = BeginTelegramBotOAuth(other.Id, prefs)
				require.NoError(t, err)
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return CompleteTelegramBotOAuthTx(tx, other.Id, "43", intent, true) }))
				connected, err = GetTelegramBotConnection(other.Id)
				require.NoError(t, err)
				require.NoError(t, ConfirmTelegramBotConnection(connected, 43))
				pending, err := BeginTelegramBotOAuth(other.Id, prefs)
				require.NoError(t, err)

				// 后台封禁再解封不能恢复旧连接或旧授权流程。
				for _, status := range []int{common.UserStatusDisabled, common.UserStatusEnabled} {
					other.Status = status
					require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return other.UpdateWithTx(tx, false) }))
				}
				disconnected, err := GetTelegramBotConnection(other.Id)
				require.NoError(t, err)
				assert.Equal(t, TelegramBotDisconnected, disconnected.Status)
				assert.Greater(t, disconnected.Version, connected.Version)
				require.ErrorIs(t, db.Transaction(func(tx *gorm.DB) error { return CompleteTelegramBotOAuthTx(tx, other.Id, "43", pending, true) }), ErrTelegramBotExpired)
				_, err = UserCheckinForTelegram(other.Id, day, cfg.BotID, "43", connected.Version)
				require.ErrorIs(t, err, ErrTelegramBotNotConnected)
				var checkins int64
				require.NoError(t, db.Model(&Checkin{}).Where("user_id = ?", other.Id).Count(&checkins).Error)
				assert.Zero(t, checkins)
				require.NoError(t, db.First(&other, other.Id).Error)
				assert.Equal(t, 3100, other.Quota)
				assert.Equal(t, 100, other.UnpaidQuotaBalance)
			})
		})
	}
}
