package service

import (
	"context"
	"encoding/base64"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestUpstreamRateFingerprintContract(t *testing.T) {
	const abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
	for _, tc := range []struct{ name, key, rule, expected string }{
		{"去除一次前缀", "  sk-abc \n", "trim_strip_sk_prefix", abc},
		{"仅去除首尾空白", " abc\t", "trim", abc},
	} {
		t.Run(tc.name, func(t *testing.T) {
			actual, err := upstreamRateFingerprint(tc.key, tc.rule)
			require.NoError(t, err)
			assert.Equal(t, tc.expected, actual)
		})
	}
	plain, err := upstreamRateFingerprint("sk-abc", "trim")
	require.NoError(t, err)
	assert.NotEqual(t, abc, plain)
	upper, err := upstreamRateFingerprint("SK-abc", "trim_strip_sk_prefix")
	require.NoError(t, err)
	assert.NotEqual(t, abc, upper)
	double, err := upstreamRateFingerprint("sk-sk-abc", "trim_strip_sk_prefix")
	require.NoError(t, err)
	assert.Equal(t, plain, double)
	_, err = upstreamRateFingerprint("abc", "guessed")
	require.Error(t, err)
	_, err = upstreamRateFingerprint("sk-", "trim_strip_sk_prefix")
	require.Error(t, err)
}

func TestUpstreamRateHistoryRejectsUntrustedSnapshotsAndSeparatesGroupMoves(t *testing.T) {
	now := int64(1794096000)
	fingerprint, err := upstreamRateFingerprint("sk-abc", "trim_strip_sk_prefix")
	require.NoError(t, err)
	channel := upstreamRateRemoteChannel{
		ID: 4, Algorithm: "sha256", Normalization: "trim_strip_sk_prefix", Status: "ready", Complete: common.GetPointer(true),
		KeySyncedAt: time.Unix(now, 0).UTC().Format(time.RFC3339),
		Groups:      []upstreamRateGroup{{ID: 1, Name: "原分组", Ratio: common.GetPointer(0.1), UpdatedAt: time.Unix(now, 0).UTC().Format(time.RFC3339), Keys: []upstreamRateAPIKey{{ID: 11, Fingerprint: fingerprint}}}},
	}
	record := mergeUpstreamRateRecord(upstreamRateRecord{}, channel, now, 3900)
	require.Contains(t, record.Known, "trim_strip_sk_prefix:"+fingerprint)
	assert.Nil(t, record.Known["trim_strip_sk_prefix:"+fingerprint].Change)

	channel.KeySyncedAt = time.Unix(now+60, 0).UTC().Format(time.RFC3339)
	channel.Groups[0].UpdatedAt = channel.KeySyncedAt
	channel.Groups[0].Ratio = common.GetPointer(0.12)
	record = mergeUpstreamRateRecord(record, channel, now+60, 3900)
	change := record.Known["trim_strip_sk_prefix:"+fingerprint].Change
	require.NotNil(t, change)
	assert.Equal(t, UpstreamRateChange{From: 0.1, To: 0.12, At: now + 60}, *change)

	channel.KeySyncedAt = time.Unix(now+120, 0).UTC().Format(time.RFC3339)
	channel.Groups[0].UpdatedAt = channel.KeySyncedAt
	channel.Groups[0].ID, channel.Groups[0].Name = 2, "目标分组"
	channel.Groups[0].Ratio = common.GetPointer(0.08)
	record = mergeUpstreamRateRecord(record, channel, now+120, 3900)
	known := record.Known["trim_strip_sk_prefix:"+fingerprint]
	assert.Equal(t, "原分组", known.MovedFrom)
	assert.Equal(t, now+120, known.MovedAt)
	assert.Nil(t, known.Change, "迁组不能误报为原分组降价")

	channel.Status, channel.Complete, channel.UnavailableIDs = "partial", common.GetPointer(false), []int{11}
	channel.Groups[0].Ratio = common.GetPointer(0.5)
	record = mergeUpstreamRateRecord(record, channel, now+180, 3900)
	assert.Equal(t, 0.08, record.Known["trim_strip_sk_prefix:"+fingerprint].Ratio, "不可用 Key 的旧指纹不能更新可信历史")

	channel.Status, channel.Complete, channel.UnavailableIDs = "ready", common.GetPointer(true), nil
	channel.KeySyncedAt = time.Unix(now-60, 0).UTC().Format(time.RFC3339)
	record = mergeUpstreamRateRecord(record, channel, now+240, 3900)
	assert.Equal(t, "older_snapshot", record.Error)
	assert.Equal(t, 0.08, record.Known["trim_strip_sk_prefix:"+fingerprint].Ratio)
}

func TestUpstreamRateConflictsAndQuality(t *testing.T) {
	now := int64(1794096000)
	fingerprint := strings.Repeat("a", 64)
	channel := upstreamRateRemoteChannel{Algorithm: "sha256", Normalization: "trim", Status: "ready", Complete: common.GetPointer(true), KeySyncedAt: time.Unix(now, 0).UTC().Format(time.RFC3339)}
	group := upstreamRateGroup{ID: 1, Name: "分组甲", Ratio: common.GetPointer(0.0), UpdatedAt: channel.KeySyncedAt, Keys: []upstreamRateAPIKey{{ID: 1, Fingerprint: fingerprint}}}
	assert.True(t, validUpstreamRateGroup(group, now), "零倍率必须保留")
	channel.Groups = []upstreamRateGroup{group, group}
	assert.Len(t, upstreamRateCandidateIndex(channel)[fingerprint], 1)
	channel.Groups[1].ID, channel.Groups[1].Name = 2, "分组乙"
	assert.Len(t, upstreamRateCandidateIndex(channel)[fingerprint], 2, "跨组冲突不能任选第一项")
	channel.Groups[1].ID, channel.Groups[1].Name = 1, "分组甲"
	channel.Groups[1].Ratio = common.GetPointer(0.2)
	record := mergeUpstreamRateRecord(upstreamRateRecord{}, channel, now, 3900)
	assert.Empty(t, record.Known, "同组矛盾数据不能建立基线")
	for _, tc := range []struct {
		name     string
		input    upstreamRateRemoteChannel
		expected string
	}{
		{"尚未同步不要求算法元数据", upstreamRateRemoteChannel{Status: "not_synced"}, "not_synced"},
		{"同步失败不误报协议不支持", upstreamRateRemoteChannel{Status: "failed"}, "failed"},
		{"缺少完整性标记", upstreamRateRemoteChannel{Status: "ready", Algorithm: "sha256", Normalization: "trim"}, "unsupported_protocol"},
		{"正常快照", channel, "ready"},
	} {
		t.Run(tc.name, func(t *testing.T) { assert.Equal(t, tc.expected, upstreamRateChannelQuality(tc.input, now, 3900)) })
	}
	channel.KeySyncedAt = time.Unix(now-3901, 0).UTC().Format(time.RFC3339)
	assert.Equal(t, "stale", upstreamRateChannelQuality(channel, now, 3900))
}

func TestUpstreamRateEncryptedCredentialBindsSource(t *testing.T) {
	t.Setenv("CRYPTO_SECRET", "")
	t.Setenv("SESSION_SECRET", "")
	_, err := upstreamRateCipher()
	require.ErrorIs(t, err, ErrUpstreamRateEncryption)
	t.Setenv("CRYPTO_SECRET", "test-only-stable-secret")
	previous := common.CryptoSecret
	common.CryptoSecret = "test-only-stable-secret"
	t.Cleanup(func() { common.CryptoSecret = previous })
	aead, err := upstreamRateCipher()
	require.NoError(t, err)
	nonce := make([]byte, aead.NonceSize())
	sealed := aead.Seal(nonce, nonce, []byte("test-only-token"), []byte("source-a"))
	source := upstreamRateSource{ID: "source-a", TokenCiphertext: base64.StdEncoding.EncodeToString(sealed)}
	plaintext, err := upstreamRateSourceToken(source)
	require.NoError(t, err)
	assert.Equal(t, "test-only-token", plaintext)
	source.ID = "source-b"
	_, err = upstreamRateSourceToken(source)
	require.EqualError(t, err, "credential_unavailable")
	source.TokenPlaintext = "must-not-fallback-after-decryption-failure"
	_, err = upstreamRateSourceToken(source)
	require.EqualError(t, err, "credential_unavailable")
	source.TokenCiphertext = "invalid-ciphertext"
	_, err = upstreamRateSourceToken(source)
	require.EqualError(t, err, "credential_unavailable")
	_, err = upstreamRateSourceToken(upstreamRateSource{ID: "missing-token"})
	require.EqualError(t, err, "credential_unavailable")
}

func TestUpstreamRateAutomaticMatchingAcrossChannelsAndSources(t *testing.T) {
	now := int64(1794096000)
	source := upstreamRateSource{ID: "source-a", Name: "来源甲", Enabled: true, PollSeconds: 60, ScanMinutes: 30}
	fingerprint, err := upstreamRateFingerprint("sk-abc", "trim_strip_sk_prefix")
	require.NoError(t, err)
	remote := upstreamRateRemoteChannel{ID: 4, Name: "上游账号", Algorithm: "sha256", Normalization: "trim_strip_sk_prefix", Status: "ready", Complete: common.GetPointer(true), KeySyncedAt: time.Unix(now, 0).UTC().Format(time.RFC3339), Groups: []upstreamRateGroup{{ID: 1, Name: "实际分组", Ratio: common.GetPointer(0.1), UpdatedAt: time.Unix(now, 0).UTC().Format(time.RFC3339), Keys: []upstreamRateAPIKey{{ID: 11, Fingerprint: fingerprint}}}}}
	for _, tc := range []struct {
		name, status string
		setup        func([]upstreamRateSource, map[string]upstreamRateSnapshot) []upstreamRateSource
	}{
		{"无需绑定即可通过本地 Key 定位上游渠道和分组", "matched", nil},
		{"相同 Key 跨上游渠道出现时返回冲突", "conflict", func(sources []upstreamRateSource, snapshots map[string]upstreamRateSnapshot) []upstreamRateSource {
			other := remote
			other.ID = 7
			snapshots[source.ID].Channels[7] = mergeUpstreamRateRecord(upstreamRateRecord{}, other, now, 3900)
			return sources
		}},
		{"相同 Key 跨来源出现时返回冲突", "conflict", func(sources []upstreamRateSource, snapshots map[string]upstreamRateSnapshot) []upstreamRateSource {
			other := source
			other.ID = "source-b"
			snapshots[other.ID] = snapshots[source.ID]
			return append(sources, other)
		}},
		{"禁用来源不参与匹配或制造冲突", "matched", func(sources []upstreamRateSource, snapshots map[string]upstreamRateSnapshot) []upstreamRateSource {
			other := source
			other.ID, other.Enabled = "source-disabled", false
			snapshots[other.ID] = snapshots[source.ID]
			return append(sources, other)
		}},
		{"不可用 Key 的旧指纹只返回历史倍率", "unavailable", func(sources []upstreamRateSource, snapshots map[string]upstreamRateSnapshot) []upstreamRateSource {
			record := snapshots[source.ID].Channels[4]
			record.Data.UnavailableIDs = []int{11}
			snapshots[source.ID].Channels[4] = record
			return sources
		}},
		{"Key 跨渠道迁移后新匹配优先于旧归属历史", "matched", func(sources []upstreamRateSource, snapshots map[string]upstreamRateSnapshot) []upstreamRateSource {
			record := snapshots[source.ID].Channels[4]
			record.Data.Groups = nil
			snapshots[source.ID].Channels[4] = record
			other := remote
			other.ID = 7
			snapshots[source.ID].Channels[7] = mergeUpstreamRateRecord(upstreamRateRecord{}, other, now, 3900)
			return sources
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			sources := []upstreamRateSource{source}
			snapshots := map[string]upstreamRateSnapshot{source.ID: {ReadAt: now, Complete: true, Channels: map[int]upstreamRateRecord{4: mergeUpstreamRateRecord(upstreamRateRecord{}, remote, now, 3900)}}}
			if tc.setup != nil {
				sources = tc.setup(sources, snapshots)
			}
			item := buildUpstreamRateMatchIndex(sources, snapshots, now).match("  sk-abc\n", now)
			assert.Equal(t, tc.status, item.Status)
			if tc.status == "conflict" {
				assert.Nil(t, item.Ratio, "不能从冲突归属中任选一个倍率")
				assert.Empty(t, item.SourceID)
				return
			}
			require.NotNil(t, item.Ratio)
			assert.Equal(t, 0.1, *item.Ratio)
			assert.Equal(t, source.ID, item.SourceID)
			assert.Positive(t, item.UpstreamChannelID)
			assert.Equal(t, "实际分组", item.GroupName)
		})
	}
}

func TestUpstreamRatePersistenceDatabaseMatrix(t *testing.T) {
	for _, dialect := range []struct {
		kind common.DatabaseType
		env  string
	}{
		{common.DatabaseTypeSQLite, ""},
		{common.DatabaseTypeMySQL, "TEST_UPSTREAM_RATES_MYSQL_DSN"},
		{common.DatabaseTypePostgreSQL, "TEST_UPSTREAM_RATES_POSTGRES_DSN"},
	} {
		t.Run(string(dialect.kind), func(t *testing.T) {
			var driver gorm.Dialector = sqlite.Open(":memory:")
			if dialect.env != "" {
				dsn := os.Getenv(dialect.env)
				if dsn == "" {
					t.Skip(dialect.env + " is not configured")
				}
				if dialect.kind == common.DatabaseTypeMySQL {
					driver = mysql.Open(dsn)
				} else {
					driver = postgres.Open(dsn)
				}
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			previousDB, previousMain, previousLog := model.DB, common.MainDatabaseType(), common.LogDatabaseType()
			model.DB = db
			common.SetDatabaseTypes(dialect.kind, previousLog)
			t.Cleanup(func() { model.DB = previousDB; common.SetDatabaseTypes(previousMain, previousLog) })
			require.NoError(t, db.AutoMigrate(&model.Option{}, &model.Channel{}))
			t.Run("未配置环境密钥时可保存并在重启后读取令牌", func(t *testing.T) {
				t.Setenv("CRYPTO_SECRET", "")
				t.Setenv("SESSION_SECRET", "")
				previousSecret := common.CryptoSecret
				t.Cleanup(func() { common.CryptoSecret = previousSecret })
				ctx := context.Background()
				const token = "test-only-plaintext-token-0123456789"
				input := UpstreamRateSourceInput{Name: "未加密来源", BaseURL: "https://rates.example.com", Token: token, Enabled: true, PollSeconds: 60, ScanMinutes: 30}
				require.NoError(t, SaveUpstreamRateSource(ctx, input))
				config, err := loadUpstreamRateConfig(ctx)
				require.NoError(t, err)
				require.Len(t, config.Sources, 1)
				input.ID = config.Sources[0].ID
				raw, err := model.ReadUpstreamRatesState(ctx, "config")
				require.NoError(t, err)
				assert.Contains(t, raw, token, "无环境密钥时明确使用明文存储")
				common.CryptoSecret = "different-ephemeral-secret-after-restart"
				config, err = loadUpstreamRateConfig(ctx)
				require.NoError(t, err)
				decoded, err := upstreamRateSourceToken(config.Sources[0])
				require.NoError(t, err)
				assert.Equal(t, token, decoded)
				input.Token, input.Name = "", "仅修改名称"
				require.NoError(t, SaveUpstreamRateSource(ctx, input))
				view, err := GetUpstreamRateConfig(ctx)
				require.NoError(t, err)
				assert.False(t, view.EncryptionReady)
				require.Len(t, view.Sources, 1)
				assert.True(t, view.Sources[0].TokenConfigured)
				encoded, err := common.Marshal(view)
				require.NoError(t, err)
				assert.NotContains(t, string(encoded), token, "配置读取不向浏览器返回令牌")
				input.BaseURL = "https://different.example.com"
				require.ErrorIs(t, SaveUpstreamRateSource(ctx, input), ErrUpstreamRateConfig)
				input.BaseURL = "https://rates.example.com"
				t.Setenv("CRYPTO_SECRET", "test-only-later-configured-secret")
				common.CryptoSecret = "test-only-later-configured-secret"
				config, err = loadUpstreamRateConfig(ctx)
				require.NoError(t, err)
				decoded, err = upstreamRateSourceToken(config.Sources[0])
				require.NoError(t, err)
				assert.Equal(t, token, decoded, "后续配置密钥不影响已保存的明文令牌")
				input.Token = token
				require.NoError(t, SaveUpstreamRateSource(ctx, input))
				raw, err = model.ReadUpstreamRatesState(ctx, "config")
				require.NoError(t, err)
				assert.NotContains(t, raw, token, "重新输入令牌时切换为加密存储并清除明文")
				config, err = loadUpstreamRateConfig(ctx)
				require.NoError(t, err)
				decoded, err = upstreamRateSourceToken(config.Sources[0])
				require.NoError(t, err)
				assert.Equal(t, token, decoded)
				t.Setenv("CRYPTO_SECRET", "")
				require.NoError(t, SaveUpstreamRateSource(ctx, input))
				config, err = loadUpstreamRateConfig(ctx)
				require.NoError(t, err)
				assert.Empty(t, config.Sources[0].TokenCiphertext, "切回明文时清除旧密文")
				decoded, err = upstreamRateSourceToken(config.Sources[0])
				require.NoError(t, err)
				assert.Equal(t, token, decoded)
				require.NoError(t, DeleteUpstreamRateSource(ctx, input.ID))
			})
			t.Setenv("CRYPTO_SECRET", "test-only-upstream-credential-secret")
			previousSecret := common.CryptoSecret
			common.CryptoSecret = "test-only-upstream-credential-secret"
			t.Cleanup(func() { common.CryptoSecret = previousSecret })
			ctx := context.Background()
			const token = "test-only-external-token-0123456789"
			require.NoError(t, SaveUpstreamRateSource(ctx, UpstreamRateSourceInput{Name: strings.Repeat("源", 80), BaseURL: "https://rates.example.com", Token: token, Enabled: true, PollSeconds: 60, ScanMinutes: 30}))
			config, err := loadUpstreamRateConfig(ctx)
			require.NoError(t, err)
			require.Len(t, config.Sources, 1)
			source := config.Sources[0]
			raw, err := model.ReadUpstreamRatesState(ctx, "config")
			require.NoError(t, err)
			assert.NotContains(t, raw, token)
			decoded, err := upstreamRateSourceToken(source)
			require.NoError(t, err)
			assert.Equal(t, token, decoded)
			require.Error(t, model.UpdateOption("UpstreamRates.config", "{}"), "普通设置入口不能覆盖内部凭据")
			channel := model.Channel{Key: "sk-abc\nsk-other\nsk-disabled", ChannelInfo: model.ChannelInfo{IsMultiKey: true, MultiKeyStatusList: map[int]int{2: common.ChannelStatusManuallyDisabled}}}
			require.NoError(t, db.Create(&channel).Error)
			require.NoError(t, model.MutateUpstreamRatesState(ctx, "config", func(raw string) (string, error) {
				var legacy map[string]any
				if err := common.UnmarshalJsonStr(raw, &legacy); err != nil {
					return "", err
				}
				legacy["bindings"] = map[int]map[string]any{channel.Id: {"source_id": source.ID, "channel_id": 9999}}
				encoded, err := common.Marshal(legacy)
				return string(encoded), err
			}))
			now := time.Now().Unix()
			fingerprint, err := upstreamRateFingerprint("sk-abc", "trim")
			require.NoError(t, err)
			remote := upstreamRateRemoteChannel{ID: 4, Name: "上游账号", Algorithm: "sha256", Normalization: "trim", Status: "ready", Complete: common.GetPointer(true), KeySyncedAt: time.Unix(now, 0).UTC().Format(time.RFC3339), Groups: []upstreamRateGroup{{Name: "实际分组", Ratio: common.GetPointer(0.1), UpdatedAt: time.Unix(now, 0).UTC().Format(time.RFC3339), Keys: []upstreamRateAPIKey{{ID: 11, Fingerprint: fingerprint}}}}}
			require.NoError(t, mutateUpstreamRateSnapshot(ctx, source, func(snapshot *upstreamRateSnapshot) error {
				snapshot.Channels[4] = mergeUpstreamRateRecord(upstreamRateRecord{}, remote, now, 3900)
				snapshot.ReadAt = now
				snapshot.Complete = true
				return nil
			}))
			views, err := GetUpstreamRates(ctx, []int{channel.Id})
			require.NoError(t, err)
			require.Len(t, views, 1)
			assert.Equal(t, "partial", views[0].Status)
			assert.Equal(t, 2, views[0].EnabledKeys)
			assert.Equal(t, 1, views[0].MatchedKeys)
			assert.Equal(t, 4, views[0].Keys[0].UpstreamChannelID, "旧绑定不会限制自动搜索范围")
			assert.Equal(t, 0.1, *views[0].Keys[0].Ratio)
			assert.False(t, views[0].Keys[2].Enabled)
			encoded, err := common.Marshal(views)
			require.NoError(t, err)
			assert.NotContains(t, string(encoded), "sk-abc")
			assert.NotContains(t, string(encoded), fingerprint)
			assert.NotContains(t, string(encoded), token)
			secondFingerprint, err := upstreamRateFingerprint("sk-other", "trim")
			require.NoError(t, err)
			secondRemote := remote
			secondRemote.ID, secondRemote.Name = 7, "第二上游账号"
			secondRemote.Groups = []upstreamRateGroup{{ID: 1, Name: "另一分组", Ratio: common.GetPointer(0.2), UpdatedAt: remote.KeySyncedAt, Keys: []upstreamRateAPIKey{{ID: 22, Fingerprint: secondFingerprint}}}}
			require.NoError(t, mutateUpstreamRateSnapshot(ctx, source, func(snapshot *upstreamRateSnapshot) error {
				snapshot.Channels[7] = mergeUpstreamRateRecord(upstreamRateRecord{}, secondRemote, now, 3900)
				return nil
			}))
			multi, err := GetUpstreamRates(ctx, []int{channel.Id})
			require.NoError(t, err)
			require.Len(t, multi, 1)
			assert.Equal(t, "matched", multi[0].Status)
			assert.Equal(t, 2, multi[0].MatchedKeys)
			assert.Equal(t, 4, multi[0].Keys[0].UpstreamChannelID)
			assert.Equal(t, 7, multi[0].Keys[1].UpstreamChannelID)
			assert.False(t, multi[0].ForceRefreshAvailable, "多账号归属不能静默挑选一个强刷")
			_, err = EnqueueUpstreamRateRefresh(ctx, "", channel.Id, true)
			require.ErrorIs(t, err, ErrUpstreamRateConfig)
			require.NoError(t, mutateUpstreamRateSnapshot(ctx, source, func(snapshot *upstreamRateSnapshot) error {
				delete(snapshot.Channels, 7)
				return nil
			}))
			single := model.Channel{Key: "sk-abc"}
			require.NoError(t, db.Create(&single).Error)
			for _, tc := range []struct {
				name, status string
				change       func(*upstreamRateRemoteChannel)
			}{
				{"倍率过期仍显示过期状态", "stale", func(input *upstreamRateRemoteChannel) {
					input.Groups[0].UpdatedAt = time.Unix(now-4000, 0).UTC().Format(time.RFC3339)
				}},
				{"无效倍率不误报未匹配", "invalid_response", func(input *upstreamRateRemoteChannel) { input.Groups[0].Ratio = nil }},
				{"同一采集时间的矛盾倍率被忽略", "older_snapshot", func(input *upstreamRateRemoteChannel) { input.Groups[0].Ratio = common.GetPointer(0.2) }},
				{"完整快照中缺少指纹才是未匹配", "unmatched", func(input *upstreamRateRemoteChannel) { input.Groups[0].Keys = nil }},
			} {
				t.Run(tc.name, func(t *testing.T) {
					input := remote
					input.Groups = append([]upstreamRateGroup{}, remote.Groups...)
					tc.change(&input)
					require.NoError(t, mutateUpstreamRateSnapshot(ctx, source, func(snapshot *upstreamRateSnapshot) error {
						snapshot.Channels[4] = mergeUpstreamRateRecord(snapshot.Channels[4], input, now, 3900)
						return nil
					}))
					actual, err := GetUpstreamRates(ctx, []int{single.Id})
					require.NoError(t, err)
					require.Len(t, actual, 1)
					assert.Equal(t, tc.status, actual[0].Status)
					assert.Equal(t, tc.status, actual[0].Keys[0].Status)
					assert.Equal(t, 0, actual[0].MatchedKeys)
					require.NotNil(t, actual[0].Keys[0].Ratio)
					assert.Equal(t, 0.1, *actual[0].Keys[0].Ratio, "失败时只保留明确标记的可信历史值")
				})
			}
			require.NoError(t, db.Delete(&single).Error)
			require.NoError(t, db.AutoMigrate(&model.Option{}, &model.Channel{}))
			preserved, err := model.ReadUpstreamRatesState(ctx, "config")
			require.NoError(t, err)
			assert.Contains(t, preserved, source.ID)
			require.NoError(t, DeleteUpstreamRateSource(ctx, source.ID))
			view, err := GetUpstreamRateConfig(ctx)
			require.NoError(t, err)
			assert.Empty(t, view.Sources, "统一来源可直接删除，不再受渠道绑定限制")
			views, err = GetUpstreamRates(ctx, []int{channel.Id})
			require.NoError(t, err)
			require.Len(t, views, 1)
			assert.Equal(t, "not_configured", views[0].Status)
			assert.False(t, views[0].RefreshAvailable)
			require.NoError(t, db.Delete(&channel).Error)
			var version string
			query := "select version()"
			if dialect.kind == common.DatabaseTypeSQLite {
				query = "select sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("database: %s", version)
		})
	}
}
