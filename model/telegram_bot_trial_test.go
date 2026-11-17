package model

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func telegramTrialAccountFixture(t *testing.T, suffix int) (*User, TelegramTrialIdentity) {
	t.Helper()
	user := User{
		Username: fmt.Sprintf("trial-%d", suffix), AffCode: fmt.Sprintf("trial-%d", suffix),
		Status: common.UserStatusEnabled, TelegramId: fmt.Sprintf("6500%d", suffix),
		Email: fmt.Sprintf("trial-%d@example.com", suffix), Quota: 40, UnpaidQuotaBalance: 10,
	}
	require.NoError(t, DB.Create(&user).Error)
	connection := TelegramBotConnection{UserID: user.Id, BotID: 123, TelegramID: user.TelegramId, ChatID: user.TelegramId, Status: TelegramBotConnected, Version: 1}
	require.NoError(t, DB.Create(&connection).Error)
	bot, err := GetTelegramBotConfig()
	require.NoError(t, err)
	return &user, TelegramTrialIdentity{UserID: user.Id, BotID: 123, BotConfigVersion: bot.Version, TelegramID: user.TelegramId, ConnectionVersion: 1}
}

// TestTelegramBotTrialDatabaseContracts 用真实数据库验证直接领取、防重、预算和赠送入账。
func TestTelegramBotTrialDatabaseContracts(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			dsn := "local"
			if dialect == "mysql" {
				dsn = os.Getenv("TG_TRIAL_TEST_MYSQL_DSN")
			}
			if dialect == "postgres" {
				dsn = os.Getenv("TG_TRIAL_TEST_POSTGRES_DSN")
			}
			if dsn == "" {
				t.Skip("dedicated database DSN is not configured")
			}
			originalDB, originalLogs, originalPath := DB, LOG_DB, common.SQLitePath
			mainType, logType := common.MainDatabaseType(), common.LogDatabaseType()
			originalRedis, originalBotEnabled := common.RedisEnabled, system_setting.TelegramBotEnabled()
			t.Cleanup(func() {
				DB, LOG_DB, common.SQLitePath = originalDB, originalLogs, originalPath
				common.SetDatabaseTypes(mainType, logType)
				common.RedisEnabled = originalRedis
				system_setting.SetTelegramBotEnabled(originalBotEnabled)
				initCol()
			})
			common.SQLitePath = filepath.Join(t.TempDir(), "telegram-trial.db")
			t.Setenv("TG_TRIAL_DATABASE_DSN", dsn)
			db, dbType, err := chooseDB("TG_TRIAL_DATABASE_DSN", false)
			require.NoError(t, err)
			DB, LOG_DB = db, db
			common.SetDatabaseTypes(dbType, dbType)
			common.RedisEnabled = false
			system_setting.SetTelegramBotEnabled(false)
			initCol()
			sqlDB, err := db.DB()
			require.NoError(t, err)
			if dialect == "sqlite" {
				sqlDB.SetMaxOpenConns(1)
			}
			t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			var databaseVersion string
			versionQuery := "SELECT version()"
			if dialect == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(versionQuery).Scan(&databaseVersion).Error)
			t.Logf("%s database version: %s", dialect, databaseVersion)
			base := []any{&User{}, &TelegramBotConfig{}, &TelegramBotConnection{}}
			added := []any{&TelegramBotTrialConfig{}, &TelegramBotTrialDay{}, &TelegramBotTrialClaim{}}
			tables := append(append([]any{}, base...), added...)
			for _, table := range tables {
				require.False(t, db.Migrator().HasTable(table), "database must be a dedicated empty test database")
			}
			t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(tables...)) })
			// 全新安装重复迁移，再回到旧表结构验证保留现有数据的升级。
			for range 2 {
				require.NoError(t, db.AutoMigrate(tables...))
			}
			require.NoError(t, db.Migrator().DropTable(added...))
			bot := TelegramBotConfig{ID: 1, Enabled: true, BotID: 123, BotUsername: "trial_test_bot", Version: 1}
			require.NoError(t, db.Create(&bot).Error)
			legacy, legacyIdentity := telegramTrialAccountFixture(t, 1)
			for range 2 {
				require.NoError(t, db.AutoMigrate(tables...))
			}
			var migrated User
			require.NoError(t, db.First(&migrated, legacy.Id).Error)
			assert.Equal(t, legacy.Quota, migrated.Quota)
			assert.Equal(t, legacy.UnpaidQuotaBalance, migrated.UnpaidQuotaBalance)
			initial, err := GetTelegramBotTrialConfig()
			require.NoError(t, err)
			assert.False(t, initial.Enabled)
			assert.Zero(t, initial.TotalGranted)
			initial.Enabled, initial.Quota, initial.DailyLimit, initial.TotalLimit = true, 100, 100000, 100000
			_, err = SaveTelegramBotTrialConfig(*initial)
			require.ErrorIs(t, err, ErrInvalidTelegramTrialConfig)
			initial.MinUserID = legacy.Id + 1
			_, err = SaveTelegramBotTrialConfig(*initial)
			require.NoError(t, err)
			config, err := GetTelegramBotTrialConfig()
			require.NoError(t, err)
			_, granted, err := GrantTelegramTrial(legacyIdentity, 19, config.Version, TelegramTrialMembershipProof{})
			require.ErrorIs(t, err, ErrTelegramTrialUserIDRequired)
			assert.False(t, granted)
			status, err := GetTelegramTrialStatus(legacy.Id)
			require.NoError(t, err)
			assert.True(t, status.Enabled)
			assert.False(t, status.UserIDEligible)
			assert.Equal(t, config.MinUserID, status.MinUserID)
			require.NoError(t, db.First(&migrated, legacy.Id).Error)
			assert.Equal(t, legacy.Quota, migrated.Quota)
			assert.Equal(t, legacy.UnpaidQuotaBalance, migrated.UnpaidQuotaBalance)

			t.Run("direct_claim_credits_gift_once_and_reply_retry_preserves_history", func(t *testing.T) {
				user, identity := telegramTrialAccountFixture(t, 2)
				config, err := GetTelegramBotTrialConfig()
				require.NoError(t, err)
				assert.Equal(t, config.MinUserID, user.Id)
				status, err := GetTelegramTrialStatus(user.Id)
				require.NoError(t, err)
				assert.True(t, status.UserIDEligible)
				claim, granted, err := GrantTelegramTrial(identity, 21, config.Version, TelegramTrialMembershipProof{})
				require.NoError(t, err)
				assert.True(t, granted)
				assert.Equal(t, 100, claim.Quota)
				var after User
				require.NoError(t, db.First(&after, user.Id).Error)
				assert.Equal(t, user.Quota+100, after.Quota)
				assert.Equal(t, user.UnpaidQuotaBalance+100, after.UnpaidQuotaBalance)
				assert.Zero(t, after.PaidQuotaConsumed)
				assert.Zero(t, after.AffQuota)
				config, err = GetTelegramBotTrialConfig()
				require.NoError(t, err)
				assert.EqualValues(t, 100, config.TotalGranted)
				assert.EqualValues(t, 100, config.TodayGranted)
				config.Enabled = false
				config.MinUserID = user.Id + 1
				_, err = SaveTelegramBotTrialConfig(*config)
				require.NoError(t, err)
				retry, granted, err := GrantTelegramTrial(identity, 21, config.Version, TelegramTrialMembershipProof{})
				require.NoError(t, err)
				assert.False(t, granted)
				assert.Equal(t, claim.ID, retry.ID)
				_, pausedIdentity := telegramTrialAccountFixture(t, 3)
				paused, err := GetTelegramBotTrialConfig()
				require.NoError(t, err)
				_, _, err = GrantTelegramTrial(pausedIdentity, 24, paused.Version, TelegramTrialMembershipProof{})
				assert.ErrorIs(t, err, ErrTelegramTrialUnavailable)
				config, err = GetTelegramBotTrialConfig()
				require.NoError(t, err)
				assert.EqualValues(t, 100, config.TotalGranted)
				config.Enabled = true
				config.MinUserID = user.Id
				config, err = SaveTelegramBotTrialConfig(*config)
				require.NoError(t, err)
				_, _, err = GrantTelegramTrial(identity, 22, config.Version, TelegramTrialMembershipProof{})
				assert.ErrorIs(t, err, ErrTelegramTrialAlreadyClaimed)
				// 同一站内账号换绑 Telegram 和邮箱，也不能再次领取。
				require.NoError(t, db.Model(user).Updates(map[string]any{"telegram_id": "65009999", "email": "replacement@example.com"}).Error)
				require.NoError(t, db.Model(&TelegramBotConnection{}).Where("user_id = ?", user.Id).Updates(map[string]any{"telegram_id": "65009999", "chat_id": "65009999"}).Error)
				identity.TelegramID = "65009999"
				_, _, err = GrantTelegramTrial(identity, 23, config.Version, TelegramTrialMembershipProof{})
				assert.ErrorIs(t, err, ErrTelegramTrialAlreadyClaimed)
				page := &common.PageInfo{Page: 1, PageSize: 10}
				// 明细使用当前资料，领取时的 Telegram ID 和发放金额保留原值。
				items, total, err := ListTelegramTrialClaims(TelegramTrialClaimFilter{
					Keyword: strconv.Itoa(user.Id), StartTime: claim.ClaimedAt, EndTime: claim.ClaimedAt,
				}, page)
				require.NoError(t, err)
				require.Len(t, items, 1)
				assert.EqualValues(t, 1, total)
				assert.Equal(t, user.Id, items[0].UserID)
				assert.Equal(t, user.Username, items[0].Username)
				assert.Equal(t, "***@example.com", items[0].EmailMasked)
				assert.Equal(t, user.TelegramId, items[0].TelegramID)
				assert.Equal(t, claim.Quota, items[0].Quota)
				assert.False(t, items[0].UserDeleted)
				items, total, err = ListTelegramTrialClaims(TelegramTrialClaimFilter{Keyword: "%"}, page)
				require.NoError(t, err)
				assert.Empty(t, items)
				assert.Zero(t, total)
				items, _, err = ListTelegramTrialClaims(TelegramTrialClaimFilter{Keyword: "trial-2"}, page)
				require.NoError(t, err)
				require.Len(t, items, 1)
				items, _, err = ListTelegramTrialClaims(TelegramTrialClaimFilter{StartTime: claim.ClaimedAt + 1}, page)
				require.NoError(t, err)
				assert.Empty(t, items)
			})

			t.Run("email_connection_versions_and_wallet_limits_are_checked_before_credit", func(t *testing.T) {
				for index, condition := range []string{"email", "invalid_email", "disconnected", "connection", "bot_version", "config_version", "disabled_user", "wallet", "unpaid_wallet"} {
					t.Run(condition, func(t *testing.T) {
						user, identity := telegramTrialAccountFixture(t, 10+index)
						config, err := GetTelegramBotTrialConfig()
						require.NoError(t, err)
						expected := ErrTelegramBotNotConnected
						switch condition {
						case "email":
							expected = ErrTelegramTrialEmailRequired
							require.NoError(t, db.Model(user).Update("email", "").Error)
						case "invalid_email":
							expected = ErrTelegramTrialEmailRequired
							require.NoError(t, db.Model(user).Update("email", "invalid-email").Error)
						case "disconnected":
							require.NoError(t, db.Model(&TelegramBotConnection{}).Where("user_id = ?", user.Id).Update("status", TelegramBotDisconnected).Error)
						case "connection":
							require.NoError(t, db.Model(&TelegramBotConnection{}).Where("user_id = ?", user.Id).Update("version", 2).Error)
						case "bot_version":
							expected = ErrTelegramBotChanged
							require.NoError(t, db.Model(&TelegramBotConfig{}).Where("id = ?", 1).Update("version", identity.BotConfigVersion+1).Error)
						case "config_version":
							expected = ErrTelegramTrialChanged
							_, err = SaveTelegramBotTrialConfig(*config)
							require.NoError(t, err)
						case "disabled_user":
							require.NoError(t, db.Model(user).Update("status", common.UserStatusDisabled).Error)
						case "wallet":
							expected = ErrWalletQuotaLimitExceeded
							require.NoError(t, db.Model(user).Update("quota", common.MaxWalletQuota).Error)
						case "unpaid_wallet":
							expected = ErrWalletQuotaLimitExceeded
							require.NoError(t, db.Model(user).Update("unpaid_quota_balance", common.MaxWalletQuota).Error)
						}
						_, granted, err := GrantTelegramTrial(identity, int64(101+index), config.Version, TelegramTrialMembershipProof{})
						assert.ErrorIs(t, err, expected)
						assert.False(t, granted)
						var after User
						require.NoError(t, db.First(&after, user.Id).Error)
						assert.Equal(t, user.Quota, after.Quota)
						assert.Equal(t, user.UnpaidQuotaBalance, after.UnpaidQuotaBalance)
						current, err := GetTelegramBotTrialConfig()
						require.NoError(t, err)
						assert.Equal(t, config.TotalGranted, current.TotalGranted)
						var claims int64
						require.NoError(t, db.Model(&TelegramBotTrialClaim{}).Where("user_id = ?", user.Id).Count(&claims).Error)
						assert.Zero(t, claims)
					})
				}
			})

			t.Run("membership_proof_must_match_current_settings_and_be_recent", func(t *testing.T) {
				_, identity := telegramTrialAccountFixture(t, 20)
				config, err := GetTelegramBotTrialConfig()
				require.NoError(t, err)
				config.RequireMembership, config.ChatID, config.JoinURL = true, "-100123456", "https://t.me/example_trial"
				config, err = SaveTelegramBotTrialConfig(*config)
				require.NoError(t, err)
				for index, proof := range []TelegramTrialMembershipProof{
					{},
					{ConfigVersion: config.Version, Confirmed: true, CheckedAt: time.Now().Unix() - 61},
					{ConfigVersion: config.Version - 1, Confirmed: true, CheckedAt: time.Now().Unix()},
					{ConfigVersion: config.Version, Confirmed: true, CheckedAt: time.Now().Unix() + 60},
				} {
					_, _, err = GrantTelegramTrial(identity, int64(200+index), config.Version, proof)
					assert.ErrorIs(t, err, ErrTelegramTrialMembershipRequired)
				}
				proof := TelegramTrialMembershipProof{ConfigVersion: config.Version, Confirmed: true, CheckedAt: time.Now().Unix()}
				_, granted, err := GrantTelegramTrial(identity, 204, config.Version, proof)
				require.NoError(t, err)
				assert.True(t, granted)
				config.RequireMembership = false
				_, err = SaveTelegramBotTrialConfig(*config)
				require.NoError(t, err)
			})

			t.Run("concurrent_messages_cannot_grant_twice", func(t *testing.T) {
				user, identity := telegramTrialAccountFixture(t, 21)
				config, err := GetTelegramBotTrialConfig()
				require.NoError(t, err)
				var workers sync.WaitGroup
				results := make(chan error, 2)
				for index := range 2 {
					workers.Go(func() {
						_, _, err := GrantTelegramTrial(identity, int64(211+index), config.Version, TelegramTrialMembershipProof{})
						results <- err
					})
				}
				workers.Wait()
				close(results)
				var success, duplicate int
				for err := range results {
					if err == nil {
						success++
					} else {
						require.ErrorIs(t, err, ErrTelegramTrialAlreadyClaimed)
						duplicate++
					}
				}
				assert.Equal(t, 1, success)
				assert.Equal(t, 1, duplicate)
				var after User
				require.NoError(t, db.First(&after, user.Id).Error)
				assert.Equal(t, user.Quota+100, after.Quota)
				assert.Equal(t, user.UnpaidQuotaBalance+100, after.UnpaidQuotaBalance)
			})

			t.Run("daily_and_total_budgets_limit_actual_credit", func(t *testing.T) {
				for index, limit := range []string{"daily", "total"} {
					t.Run(limit, func(t *testing.T) {
						config, err := GetTelegramBotTrialConfig()
						require.NoError(t, err)
						config.DailyLimit, config.TotalLimit = 100000, 100000
						if limit == "daily" {
							config.DailyLimit = int(config.TodayGranted) + config.Quota
						} else {
							config.TotalLimit = int(config.TotalGranted) + config.Quota
						}
						config, err = SaveTelegramBotTrialConfig(*config)
						require.NoError(t, err)
						_, identity := telegramTrialAccountFixture(t, 30+index*2)
						_, _, err = GrantTelegramTrial(identity, int64(301+index*20), config.Version, TelegramTrialMembershipProof{})
						require.NoError(t, err)
						other, another := telegramTrialAccountFixture(t, 31+index*2)
						_, _, err = GrantTelegramTrial(another, int64(303+index*20), config.Version, TelegramTrialMembershipProof{})
						assert.ErrorIs(t, err, ErrTelegramTrialBudgetExceeded)
						var after User
						require.NoError(t, db.First(&after, other.Id).Error)
						assert.Equal(t, other.Quota, after.Quota)
						assert.Equal(t, other.UnpaidQuotaBalance, after.UnpaidQuotaBalance)
						current, err := GetTelegramBotTrialConfig()
						require.NoError(t, err)
						assert.Equal(t, config.TotalGranted+int64(config.Quota), current.TotalGranted)
						assert.Equal(t, config.TodayGranted+int64(config.Quota), current.TodayGranted)
					})
				}
			})

			t.Run("deleting_user_keeps_telegram_and_email_permanent_claims", func(t *testing.T) {
				config, err := GetTelegramBotTrialConfig()
				require.NoError(t, err)
				config.DailyLimit, config.TotalLimit = 100000, 100000
				config, err = SaveTelegramBotTrialConfig(*config)
				require.NoError(t, err)
				user, identity := telegramTrialAccountFixture(t, 40)
				_, _, err = GrantTelegramTrial(identity, 401, config.Version, TelegramTrialMembershipProof{})
				require.NoError(t, err)
				require.NoError(t, db.Unscoped().Delete(user).Error)
				items, total, err := ListTelegramTrialClaims(TelegramTrialClaimFilter{Keyword: identity.TelegramID}, &common.PageInfo{Page: 1, PageSize: 10})
				require.NoError(t, err)
				require.Len(t, items, 1)
				assert.EqualValues(t, 1, total)
				assert.True(t, items[0].UserDeleted)
				assert.Equal(t, user.Id, items[0].UserID)
				assert.Equal(t, identity.TelegramID, items[0].TelegramID)
				assert.Empty(t, items[0].Username)
				assert.Empty(t, items[0].EmailMasked)
				for index, reuse := range []string{"telegram", "email"} {
					other, otherIdentity := telegramTrialAccountFixture(t, 41+index)
					if reuse == "telegram" {
						require.NoError(t, db.Model(other).Update("telegram_id", identity.TelegramID).Error)
						require.NoError(t, db.Model(&TelegramBotConnection{}).Where("user_id = ?", other.Id).Updates(map[string]any{"telegram_id": identity.TelegramID, "chat_id": identity.TelegramID}).Error)
						otherIdentity.TelegramID = identity.TelegramID
					} else {
						require.NoError(t, db.Model(other).Update("email", strings.ToUpper(user.Email)).Error)
					}
					_, _, err = GrantTelegramTrial(otherIdentity, int64(402+index), config.Version, TelegramTrialMembershipProof{})
					assert.ErrorIs(t, err, ErrTelegramTrialAlreadyClaimed)
				}
			})
			// 既有领取和预算在重复启动迁移后仍然保留。
			before, err := GetTelegramBotTrialConfig()
			require.NoError(t, err)
			for range 2 {
				require.NoError(t, db.AutoMigrate(tables...))
			}
			after, err := GetTelegramBotTrialConfig()
			require.NoError(t, err)
			assert.Equal(t, before.TotalGranted, after.TotalGranted)
			assert.Equal(t, before.TodayGranted, after.TodayGranted)
			assert.Equal(t, before.Version, after.Version)
			assert.Equal(t, before.MinUserID, after.MinUserID)
			var claims int64
			require.NoError(t, db.Model(&TelegramBotTrialClaim{}).Count(&claims).Error)
			assert.EqualValues(t, 6, claims)
		})
	}
}
