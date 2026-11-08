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
	record := mergeUpstreamRateRecord(upstreamRateRecord{}, channel, now)
	require.Contains(t, record.Known, "trim_strip_sk_prefix:"+fingerprint)
	assert.Nil(t, record.Known["trim_strip_sk_prefix:"+fingerprint].Change)

	channel.KeySyncedAt = time.Unix(now+60, 0).UTC().Format(time.RFC3339)
	channel.Groups[0].UpdatedAt = channel.KeySyncedAt
	channel.Groups[0].Ratio = common.GetPointer(0.12)
	record = mergeUpstreamRateRecord(record, channel, now+60)
	change := record.Known["trim_strip_sk_prefix:"+fingerprint].Change
	require.NotNil(t, change)
	assert.Equal(t, UpstreamRateChange{From: 0.1, To: 0.12, At: now + 60}, *change)

	channel.KeySyncedAt = time.Unix(now+120, 0).UTC().Format(time.RFC3339)
	channel.Groups[0].UpdatedAt = channel.KeySyncedAt
	channel.Groups[0].ID, channel.Groups[0].Name = 2, "目标分组"
	channel.Groups[0].Ratio = common.GetPointer(0.08)
	record = mergeUpstreamRateRecord(record, channel, now+120)
	known := record.Known["trim_strip_sk_prefix:"+fingerprint]
	assert.Equal(t, "原分组", known.MovedFrom)
	assert.Equal(t, now+120, known.MovedAt)
	assert.Nil(t, known.Change, "迁组不能误报为原分组降价")

	channel.Status, channel.Complete, channel.UnavailableIDs = "partial", common.GetPointer(false), []int{11}
	channel.Groups[0].Ratio = common.GetPointer(0.5)
	record = mergeUpstreamRateRecord(record, channel, now+180)
	assert.Equal(t, 0.08, record.Known["trim_strip_sk_prefix:"+fingerprint].Ratio, "不可用 Key 的旧指纹不能更新可信历史")

	channel.Status, channel.Complete, channel.UnavailableIDs = "ready", common.GetPointer(true), nil
	channel.KeySyncedAt = time.Unix(now-60, 0).UTC().Format(time.RFC3339)
	record = mergeUpstreamRateRecord(record, channel, now+240)
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
	record := mergeUpstreamRateRecord(upstreamRateRecord{}, channel, now)
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
		t.Run(tc.name, func(t *testing.T) { assert.Equal(t, tc.expected, upstreamRateChannelQuality(tc.input, now)) })
	}
	channel.KeySyncedAt = time.Unix(now-3901, 0).UTC().Format(time.RFC3339)
	assert.Equal(t, "ready", upstreamRateChannelQuality(channel, now), "采集时间较旧不再判定过期")
	channel.KeySyncedAt = time.Unix(now+61, 0).UTC().Format(time.RFC3339)
	assert.Equal(t, "invalid_time", upstreamRateChannelQuality(channel, now), "仍拒绝异常的未来时间")
}

func TestUpstreamRateOldSnapshotsRemainMatchedAndRecoverable(t *testing.T) {
	now := int64(1794096000)
	source := upstreamRateSource{ID: "source-a", Enabled: true, PollSeconds: 300}
	fingerprint, err := upstreamRateFingerprint("sk-abc", "trim")
	require.NoError(t, err)
	for _, tc := range []struct {
		name      string
		collected int64
		readAt    int64
	}{
		{"采集时间超过原过期阈值仍可匹配", now - 4000, now},
		{"采集时间超过七天仍保留可信回退倍率", now - 8*86400, now},
		{"本地读取时间超过三次间隔不自动判定失败", now - 4000, now - 901},
	} {
		t.Run(tc.name, func(t *testing.T) {
			at := time.Unix(tc.collected, 0).UTC().Format(time.RFC3339)
			remote := upstreamRateRemoteChannel{
				ID: 4, Algorithm: "sha256", Normalization: "trim", Status: "ready", Complete: common.GetPointer(true), KeySyncedAt: at,
				Groups: []upstreamRateGroup{{ID: 1, Name: "实际分组", Ratio: common.GetPointer(1.9), UpdatedAt: at, Keys: []upstreamRateAPIKey{{ID: 11, Fingerprint: fingerprint}}}},
			}
			record := mergeUpstreamRateRecord(upstreamRateRecord{}, remote, tc.readAt)
			require.Contains(t, record.Known, "trim:"+fingerprint)
			require.Contains(t, record.History, upstreamRateGroupIdentity(1, "实际分组"))
			snapshots := map[string]upstreamRateSnapshot{source.ID: {ReadAt: tc.readAt, Complete: true, Channels: map[int]upstreamRateRecord{4: record}}}
			item := buildUpstreamRateMatchIndex([]upstreamRateSource{source}, snapshots, now).match("sk-abc", "", nil, now)
			assert.Equal(t, "matched", item.Status)
			require.NotNil(t, item.Ratio)
			assert.Equal(t, 1.9, *item.Ratio)
			assert.Equal(t, tc.collected, item.CollectedAt)
			assert.Equal(t, tc.collected, item.KeySyncedAt)
			assert.Equal(t, tc.readAt, item.ReadAt)

			record.Error = "request_failed"
			snapshots[source.ID].Channels[4] = record
			item = buildUpstreamRateMatchIndex([]upstreamRateSource{source}, snapshots, now).match("sk-abc", "", nil, now)
			assert.Equal(t, "read_failed", item.Status, "实际请求失败仍应明确标记")
			require.NotNil(t, item.Ratio)
			assert.Equal(t, 1.9, *item.Ratio, "读取失败时保留最近一次可信倍率")
		})
	}
}

func TestUpstreamRateConfigIgnoresLegacyScanInterval(t *testing.T) {
	var config upstreamRateConfig
	require.NoError(t, common.UnmarshalJsonStr(`{"sources":[{"id":"source-a","name":"来源甲","base_url":"https://rates.example.com","enabled":true,"poll_seconds":300,"scan_minutes":30,"revision":"existing-revision"}]}`, &config))
	require.Len(t, config.Sources, 1)
	assert.Equal(t, 300, config.Sources[0].PollSeconds)
	assert.Equal(t, "existing-revision", config.Sources[0].Revision, "忽略旧字段不影响已有快照的版本")
	encoded, err := common.Marshal(config)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "scan_minutes")
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
	source := upstreamRateSource{ID: "source-a", Name: "来源甲", Enabled: true, PollSeconds: 60}
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
			snapshots[source.ID].Channels[7] = mergeUpstreamRateRecord(upstreamRateRecord{}, other, now)
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
			snapshots[source.ID].Channels[7] = mergeUpstreamRateRecord(upstreamRateRecord{}, other, now)
			return sources
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			sources := []upstreamRateSource{source}
			snapshots := map[string]upstreamRateSnapshot{source.ID: {ReadAt: now, Complete: true, Channels: map[int]upstreamRateRecord{4: mergeUpstreamRateRecord(upstreamRateRecord{}, remote, now)}}}
			if tc.setup != nil {
				sources = tc.setup(sources, snapshots)
			}
			item := buildUpstreamRateMatchIndex(sources, snapshots, now).match("  sk-abc\n", "", nil, now)
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
	t.Run("搜索范围不完整且当前 Key 未命中时返回未同步", func(t *testing.T) {
		snapshots := map[string]upstreamRateSnapshot{source.ID: {
			ReadAt: now, Complete: false,
			Channels: map[int]upstreamRateRecord{4: mergeUpstreamRateRecord(upstreamRateRecord{}, remote, now)},
		}}
		item := buildUpstreamRateMatchIndex([]upstreamRateSource{source}, snapshots, now).match("sk-missing", "", nil, now)
		assert.Equal(t, "not_synced", item.Status)
		assert.Nil(t, item.Ratio)
	})
}

func upstreamRateMaskedFixture(now int64) (upstreamRateSource, upstreamRateRemoteChannel) {
	at := time.Unix(now, 0).UTC().Format(time.RFC3339)
	return upstreamRateSource{ID: "source-a", Name: "来源甲", BaseURL: "https://collector.example", Enabled: true, PollSeconds: 300}, upstreamRateRemoteChannel{
		ID: 4, Name: "上游账号", SiteURL: "https://provider.example", Algorithm: "sha256", Normalization: "trim", Status: "ready", Complete: common.GetPointer(true), KeySyncedAt: at,
		HintNormalization: "trim_strip_sk_prefix", HintsComplete: common.GetPointer(true),
		Groups: []upstreamRateGroup{{ID: 1, Name: "实际分组", Ratio: common.GetPointer(1.9), UpdatedAt: at, Keys: []upstreamRateAPIKey{{ID: 11, MaskedKey: "sk-e1a...cac1", KeyPrefix: "e1a", KeySuffix: "cac1"}}}},
	}
}

func TestUpstreamRateMaskedKeyAndSiteMatching(t *testing.T) {
	now := int64(1794096000)
	const key, mask, site = "sk-e1a-test-only-secret-cac1", "sk-e1a...cac1", "https://provider.example"
	for _, tc := range []struct {
		name, prefix, suffix, maskedKey, localURL, remoteURL string
		matched                                              bool
	}{
		{"指纹保留前缀时提示仍独立去掉通用前缀", "e1a", "cac1", mask, site, site, true},
		{"纯四位尾号可以兜底", "", "cac1", "...cac1", site, site, true},
		{"一位可见前缀可以兜底", "e", "cac1", mask, site, site, true},
		{"展示字段格式不参与匹配", "e1a", "cac1", "不解析这个展示值", site, site, true},
		{"未提供展示字段仍使用结构化提示", "e1a", "cac1", "", site, site, true},
		{"只有展示值不能猜测结构化提示", "", "", mask, site, site, false},
		{"尾号相同但前缀不同不能退回尾号匹配", "e1b", "cac1", mask, site, site, false},
		{"提示保留大小写不能忽略大小写匹配", "E1a", "cac1", mask, site, site, false},
		{"前缀相同但尾号不同不能命中", "e1a", "ffff", mask, site, site, false},
		{"尾号不足四位不能命中", "e1a", "ac1", mask, site, site, false},
		{"尾号超过四位不能命中", "e1a", "-cac1", mask, site, site, false},
		{"可见前缀超过三位不能命中", "e1a-", "cac1", mask, site, site, false},
		{"主机大小写默认端口和末尾版本路径兼容", "e1a", "cac1", mask, "https://PROVIDER.example:443/v1/", site + "/", true},
		{"相同自定义路径兼容末尾版本路径", "e1a", "cac1", mask, site + "/proxy/v1/", site + "/proxy", true},
		{"不同自定义路径不能仅靠域名命中", "e1a", "cac1", mask, site + "/proxy", site + "/other", false},
		{"其他站点的同尾号不能命中", "e1a", "cac1", mask, "https://other.example", site, false},
		{"不同协议不能命中", "e1a", "cac1", mask, "http://provider.example", site, false},
		{"不同有效端口不能命中", "e1a", "cac1", mask, site + ":8443", site, false},
		{"缺少本地站点不能兜底", "e1a", "cac1", mask, "", site, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source, remote := upstreamRateMaskedFixture(now)
			remote.SiteURL, remote.Groups[0].Keys[0].MaskedKey = tc.remoteURL, tc.maskedKey
			remote.Groups[0].Keys[0].KeyPrefix, remote.Groups[0].Keys[0].KeySuffix = tc.prefix, tc.suffix
			record := mergeUpstreamRateRecord(upstreamRateRecord{}, remote, now)
			snapshots := map[string]upstreamRateSnapshot{source.ID: {ReadAt: now, Complete: true, HintChannelIDs: []int{4}, Channels: map[int]upstreamRateRecord{4: record}}}
			item := buildUpstreamRateMatchIndex([]upstreamRateSource{source}, snapshots, now).match(key, tc.localURL, []string{key}, now)
			assert.Equal(t, tc.matched, item.Status == "matched")
			if !tc.matched {
				assert.Nil(t, item.Ratio)
				return
			}
			require.NotNil(t, item.Ratio)
			assert.Equal(t, 1.9, *item.Ratio)
			assert.Equal(t, "masked", item.MatchMethod)
			assert.Equal(t, "实际分组", item.GroupName)
			assert.Equal(t, source.ID, item.SourceID)
		})
	}
}

func TestUpstreamRateMaskedCandidateSelection(t *testing.T) {
	now := int64(1794096000)
	const key = "sk-e1a-test-only-secret-cac1"
	fingerprint, err := upstreamRateFingerprint(key, "trim")
	require.NoError(t, err)
	for _, tc := range []struct {
		name, status, method string
		edit                 func(*upstreamRateRemoteChannel)
		extra                string
		localKeys            []string
	}{
		{name: "指纹不完整但当前脱敏条目可用时成功", status: "matched", edit: func(remote *upstreamRateRemoteChannel) {
			remote.Status, remote.Complete = "partial", common.GetPointer(false)
		}},
		{name: "指纹不可用不否决完整的脱敏提示", status: "matched", edit: func(remote *upstreamRateRemoteChannel) {
			remote.UnavailableIDs = []int{11}
		}},
		{name: "不可用的旧指纹不作为提示不匹配的反证", status: "matched", edit: func(remote *upstreamRateRemoteChannel) {
			remote.Groups[0].Keys[0].Fingerprint = strings.Repeat("a", 64)
			remote.UnavailableIDs = []int{11}
		}},
		{name: "脱敏命中不能绕过非法倍率", status: "invalid_response", edit: func(remote *upstreamRateRemoteChannel) {
			remote.Groups[0].Ratio = nil
		}},
		{name: "不同完整指纹不能通过尾号兜底", status: "unmatched", edit: func(remote *upstreamRateRemoteChannel) {
			remote.Groups[0].Keys[0].Fingerprint = strings.Repeat("a", 64)
		}},
		{name: "损坏的非空指纹不能通过尾号兜底", status: "invalid_response", edit: func(remote *upstreamRateRemoteChannel) {
			remote.Groups[0].Keys[0].Fingerprint = "invalid-fingerprint"
		}},
		{name: "完整指纹优先于其他分组的脱敏候选", status: "matched", method: "fingerprint", edit: func(remote *upstreamRateRemoteChannel) {
			other := remote.Groups[0]
			other.ID, other.Name, other.Ratio = 2, "其他分组", common.GetPointer(9.9)
			other.Keys = append([]upstreamRateAPIKey{}, other.Keys...)
			remote.Groups[0].Keys[0].Fingerprint = fingerprint
			remote.Groups = append(remote.Groups, other)
		}},
		{name: "完整指纹不可用时不能绕过到另一个脱敏分组", status: "unavailable", edit: func(remote *upstreamRateRemoteChannel) {
			other := remote.Groups[0]
			other.ID, other.Name, other.Keys = 2, "其他分组", []upstreamRateAPIKey{{ID: 12, KeyPrefix: "e1a", KeySuffix: "cac1"}}
			remote.Groups[0].Keys[0].Fingerprint = fingerprint
			remote.UnavailableIDs = []int{11}
			remote.Groups = append(remote.Groups, other)
		}},
		{name: "同一上游Key同组重复记录去重", status: "matched", edit: func(remote *upstreamRateRemoteChannel) {
			remote.Groups = append(remote.Groups, remote.Groups[0])
		}},
		{name: "同组不同上游Key同片段不能任选一个", status: "conflict", edit: func(remote *upstreamRateRemoteChannel) {
			remote.Groups[0].Keys = append(remote.Groups[0].Keys, upstreamRateAPIKey{ID: 12, KeyPrefix: "e1a", KeySuffix: "cac1"})
		}},
		{name: "不可用的同片段候选仍参与冲突判断", status: "conflict", edit: func(remote *upstreamRateRemoteChannel) {
			remote.Groups[0].Keys = append(remote.Groups[0].Keys, upstreamRateAPIKey{ID: 12, KeyPrefix: "e1a", KeySuffix: "cac1"})
			remote.UnavailableIDs = []int{12}
		}},
		{name: "完整指纹不同的同片段候选仍参与冲突判断", status: "conflict", edit: func(remote *upstreamRateRemoteChannel) {
			remote.Groups[0].Keys = append(remote.Groups[0].Keys, upstreamRateAPIKey{ID: 12, Fingerprint: strings.Repeat("a", 64), KeyPrefix: "e1a", KeySuffix: "cac1"})
		}},
		{name: "首尾提示与仅尾号提示同时命中仍为冲突", status: "conflict", edit: func(remote *upstreamRateRemoteChannel) {
			remote.Groups[0].Keys = append(remote.Groups[0].Keys, upstreamRateAPIKey{ID: 12, KeySuffix: "cac1"})
		}},
		{name: "跨分组同片段不能任选一个", status: "conflict", edit: func(remote *upstreamRateRemoteChannel) {
			other := remote.Groups[0]
			other.ID, other.Name = 2, "其他分组"
			remote.Groups = append(remote.Groups, other)
		}},
		{name: "同一个上游Key同组不同倍率不能任选一个", status: "conflict", edit: func(remote *upstreamRateRemoteChannel) {
			other := remote.Groups[0]
			other.Ratio = common.GetPointer(9.9)
			remote.Groups = append(remote.Groups, other)
		}},
		{name: "同站点跨上游账号同片段返回冲突", status: "conflict", extra: "channel"},
		{name: "同站点跨来源同片段返回冲突", status: "conflict", extra: "source"},
		{name: "本地不同完整Key对应同一脱敏候选返回冲突", status: "conflict", localKeys: []string{key, "sk-e1a-other-test-secret-cac1"}},
		{name: "本地相同完整Key重复不制造冲突", status: "matched", localKeys: []string{key, " " + key + "\n"}},
		{name: "仅去除空白时带通用前缀和不带前缀是不同凭据", status: "conflict", localKeys: []string{key, strings.TrimPrefix(key, "sk-")}},
		{name: "指纹规则去除通用前缀时等价凭据不制造冲突", status: "matched", localKeys: []string{key, strings.TrimPrefix(key, "sk-")}, edit: func(remote *upstreamRateRemoteChannel) {
			remote.Normalization = "trim_strip_sk_prefix"
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source, remote := upstreamRateMaskedFixture(now)
			if tc.edit != nil {
				tc.edit(&remote)
			}
			sources := []upstreamRateSource{source}
			snapshot := upstreamRateSnapshot{ReadAt: now, Complete: true, HintChannelIDs: []int{4}, Channels: map[int]upstreamRateRecord{4: mergeUpstreamRateRecord(upstreamRateRecord{}, remote, now)}}
			snapshots := map[string]upstreamRateSnapshot{}
			switch tc.extra {
			case "channel":
				remote.ID = 7
				snapshot.Channels[7] = mergeUpstreamRateRecord(upstreamRateRecord{}, remote, now)
				snapshot.HintChannelIDs = append(snapshot.HintChannelIDs, 7)
			case "source":
				other := source
				other.ID = "source-b"
				sources = append(sources, other)
				snapshots[other.ID] = snapshot
			}
			snapshots[source.ID] = snapshot
			keys := tc.localKeys
			if keys == nil {
				keys = []string{key}
			}
			item := buildUpstreamRateMatchIndex(sources, snapshots, now).match(key, "https://provider.example/v1", keys, now)
			assert.Equal(t, tc.status, item.Status)
			if tc.status == "matched" {
				require.NotNil(t, item.Ratio)
				assert.Equal(t, 1.9, *item.Ratio)
				assert.Equal(t, "实际分组", item.GroupName)
				method := tc.method
				if method == "" {
					method = "masked"
				}
				assert.Equal(t, method, item.MatchMethod)
			} else if tc.status == "conflict" || tc.status == "invalid_response" || tc.status == "unmatched" {
				assert.Nil(t, item.Ratio)
			}
		})
	}
}

func TestUpstreamRateMaskedMatchingRequiresCompleteCandidateScope(t *testing.T) {
	now := int64(1794096000)
	const key, site = "sk-e1a-test-only-secret-cac1", "https://provider.example"
	for _, tc := range []struct {
		name    string
		matched bool
		edit    func(*upstreamRateRemoteChannel, *upstreamRateSnapshot)
	}{
		{"批量和指纹不完整但提示完整仍可命中", true, func(remote *upstreamRateRemoteChannel, snapshot *upstreamRateSnapshot) {
			remote.Status, remote.Complete = "partial", common.GetPointer(false)
			snapshot.Complete = false
		}},
		{"旧协议缺少提示完整性不允许兜底", false, func(remote *upstreamRateRemoteChannel, _ *upstreamRateSnapshot) {
			remote.HintsComplete = nil
		}},
		{"提示完整性为否不允许兜底", false, func(remote *upstreamRateRemoteChannel, _ *upstreamRateSnapshot) {
			remote.HintsComplete = common.GetPointer(false)
		}},
		{"提示缺少归一化规则不允许猜测", false, func(remote *upstreamRateRemoteChannel, _ *upstreamRateSnapshot) {
			remote.HintNormalization = ""
		}},
		{"不能将指纹归一化规则用于脱敏提示", false, func(remote *upstreamRateRemoteChannel, _ *upstreamRateSnapshot) {
			remote.HintNormalization = "trim"
		}},
		{"提示不可用标记与完整性冲突时拒绝兜底", false, func(remote *upstreamRateRemoteChannel, _ *upstreamRateSnapshot) {
			remote.UnavailableHintIDs = []int{11}
		}},
		{"没有确认批量候选范围时拒绝兜底", false, func(_ *upstreamRateRemoteChannel, snapshot *upstreamRateSnapshot) {
			snapshot.HintChannelIDs = nil
		}},
		{"批量返回错误渠道但没有站点记录时拒绝兜底", false, func(_ *upstreamRateRemoteChannel, snapshot *upstreamRateSnapshot) {
			snapshot.HintChannelIDs = []int{4, 7}
		}},
		{"批量请求失败时不推导新的近似匹配", false, func(_ *upstreamRateRemoteChannel, snapshot *upstreamRateSnapshot) {
			snapshot.Error = "request_failed"
		}},
		{"没有成功读取过批量快照时拒绝兜底", false, func(_ *upstreamRateRemoteChannel, snapshot *upstreamRateSnapshot) {
			snapshot.ReadAt = 0
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source, remote := upstreamRateMaskedFixture(now)
			snapshot := upstreamRateSnapshot{ReadAt: now, Complete: true, HintChannelIDs: []int{4}, Channels: map[int]upstreamRateRecord{}}
			tc.edit(&remote, &snapshot)
			snapshot.Channels[4] = mergeUpstreamRateRecord(upstreamRateRecord{}, remote, now)
			item := buildUpstreamRateMatchIndex([]upstreamRateSource{source}, map[string]upstreamRateSnapshot{source.ID: snapshot}, now).match(key, site, []string{key}, now)
			assert.Equal(t, tc.matched, item.Status == "matched")
			if tc.matched {
				require.NotNil(t, item.Ratio)
				assert.Equal(t, 1.9, *item.Ratio)
				assert.Equal(t, "masked", item.MatchMethod)
			} else {
				assert.Nil(t, item.Ratio)
			}
		})
	}
	for _, tc := range []struct {
		name, otherSite, otherError     string
		hintsComplete, inScope, matched bool
	}{
		{"同站点另一渠道提示不完整阻断匹配", site + "/v1/", "", false, true, false},
		{"同站点另一渠道读取失败阻断匹配", site, "request_failed", true, true, false},
		{"同站点另一渠道候选完整且无相同提示允许匹配", site, "", true, true, true},
		{"其他站点提示不完整不影响当前站点", "https://other.example", "", false, true, true},
		{"其他站点读取失败不影响当前站点", "https://other.example", "request_failed", true, true, true},
		{"不知道失败渠道站点时不能确认候选范围", "", "request_failed", true, true, false},
		{"已退出本次授权范围的历史失败渠道不阻断", site, "request_failed", false, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source, remote := upstreamRateMaskedFixture(now)
			_, other := upstreamRateMaskedFixture(now)
			other.ID, other.SiteURL, other.Groups, other.HintsComplete = 7, tc.otherSite, nil, common.GetPointer(tc.hintsComplete)
			otherRecord := mergeUpstreamRateRecord(upstreamRateRecord{}, other, now)
			otherRecord.Error = tc.otherError
			snapshot := upstreamRateSnapshot{ReadAt: now, Complete: tc.otherError == "", HintChannelIDs: []int{4}, Channels: map[int]upstreamRateRecord{
				4: mergeUpstreamRateRecord(upstreamRateRecord{}, remote, now), 7: otherRecord,
			}}
			if tc.inScope {
				snapshot.HintChannelIDs = append(snapshot.HintChannelIDs, 7)
			}
			item := buildUpstreamRateMatchIndex([]upstreamRateSource{source}, map[string]upstreamRateSnapshot{source.ID: snapshot}, now).match(key, site, []string{key}, now)
			assert.Equal(t, tc.matched, item.Status == "matched")
			if tc.matched {
				require.NotNil(t, item.Ratio)
				assert.Equal(t, 1.9, *item.Ratio)
			} else {
				assert.Nil(t, item.Ratio)
			}
		})
	}
}

func TestUpstreamRateMaskedHistoryPreservesChangesWithoutExactBinding(t *testing.T) {
	now := int64(1794096000)
	const key, site = "sk-e1a-test-only-secret-cac1", "https://provider.example"
	source, remote := upstreamRateMaskedFixture(now)
	record := mergeUpstreamRateRecord(upstreamRateRecord{}, remote, now)
	assert.Empty(t, record.Known, "弱匹配不能建立完整指纹绑定")
	remote.KeySyncedAt = time.Unix(now+60, 0).UTC().Format(time.RFC3339)
	remote.Groups[0].UpdatedAt, remote.Groups[0].Ratio = remote.KeySyncedAt, common.GetPointer(2.1)
	record = mergeUpstreamRateRecord(record, remote, now+60)
	snapshots := map[string]upstreamRateSnapshot{source.ID: {ReadAt: now + 60, Complete: true, HintChannelIDs: []int{4}, Channels: map[int]upstreamRateRecord{4: record}}}
	item := buildUpstreamRateMatchIndex([]upstreamRateSource{source}, snapshots, now+60).match(key, site, []string{key}, now+60)
	assert.Equal(t, "matched", item.Status)
	require.NotNil(t, item.Change)
	assert.Equal(t, UpstreamRateChange{From: 1.9, To: 2.1, At: now + 60}, *item.Change)
	assert.Empty(t, record.Known)

	record.Error = "request_failed"
	snapshots[source.ID].Channels[4] = record
	item = buildUpstreamRateMatchIndex([]upstreamRateSource{source}, snapshots, now+90).match(key, site, []string{key}, now+90)
	assert.NotEqual(t, "matched", item.Status)
	assert.Nil(t, item.Ratio, "读取失败时不依据旧提示推导新的近似归属")

	earlier := remote
	earlier.Groups = append([]upstreamRateGroup{}, remote.Groups...)
	earlier.KeySyncedAt = time.Unix(now+120, 0).UTC().Format(time.RFC3339)
	earlier.Groups[0].UpdatedAt = time.Unix(now+30, 0).UTC().Format(time.RFC3339)
	earlier.Groups[0].Ratio = common.GetPointer(0.5)
	record = mergeUpstreamRateRecord(record, earlier, now+120)
	snapshots[source.ID].Channels[4] = record
	item = buildUpstreamRateMatchIndex([]upstreamRateSource{source}, snapshots, now+120).match(key, site, []string{key}, now+120)
	assert.Equal(t, "older_snapshot", item.Status)
	require.NotNil(t, item.Ratio)
	assert.Equal(t, 2.1, *item.Ratio, "较早采集结果不能覆盖已知倍率")
	assert.Empty(t, record.Known)
}

func TestUpstreamRateExactHistorySurvivesIncompleteHints(t *testing.T) {
	now := int64(1794096000)
	const key = "sk-e1a-test-only-secret-cac1"
	source, remote := upstreamRateMaskedFixture(now)
	fingerprint, err := upstreamRateFingerprint(key, "trim")
	require.NoError(t, err)
	remote.Groups[0].Keys[0].Fingerprint = fingerprint
	record := mergeUpstreamRateRecord(upstreamRateRecord{}, remote, now)
	require.Contains(t, record.Known, "trim:"+fingerprint)
	remote.Groups[0].Keys[0].Fingerprint = ""
	remote.Groups[0].Ratio = common.GetPointer(9.9)
	remote.HintsComplete, remote.Complete, remote.Status = common.GetPointer(false), common.GetPointer(false), "partial"
	remote.KeySyncedAt = time.Unix(now+60, 0).UTC().Format(time.RFC3339)
	record = mergeUpstreamRateRecord(record, remote, now+60)
	snapshot := upstreamRateSnapshot{ReadAt: now + 60, Complete: false, HintChannelIDs: []int{4}, Channels: map[int]upstreamRateRecord{4: record}}
	item := buildUpstreamRateMatchIndex([]upstreamRateSource{source}, map[string]upstreamRateSnapshot{source.ID: snapshot}, now+60).match(key, remote.SiteURL, []string{key}, now+60)
	require.NotNil(t, item.Ratio)
	assert.Equal(t, 1.9, *item.Ratio, "提示范围不完整不能抹掉唯一可信的精确历史")
	assert.Equal(t, "fingerprint", item.MatchMethod)
	assert.Equal(t, "实际分组", item.GroupName)
	assert.Equal(t, now, item.CollectedAt)
}

func TestUpstreamRateMaskedKeyJSONDoesNotExposeCredentialsInView(t *testing.T) {
	now := int64(1794096000)
	const key, mask = "sk-e1a-test-only-secret-cac1", "sk-e1a...cac1"
	var apiKey upstreamRateAPIKey
	require.NoError(t, common.UnmarshalJsonStr(`{"api_key_id":11,"masked_key":"sk-e1a...cac1","key_prefix":"e1a","key_suffix":"cac1"}`, &apiKey))
	assert.Equal(t, mask, apiKey.MaskedKey)
	assert.Equal(t, "e1a", apiKey.KeyPrefix)
	assert.Equal(t, "cac1", apiKey.KeySuffix)
	assert.Empty(t, apiKey.Fingerprint)
	source, remote := upstreamRateMaskedFixture(now)
	remote.HintNormalization, remote.HintsComplete, remote.UnavailableHintIDs = "", nil, []int{99}
	require.NoError(t, common.UnmarshalJsonStr(`{"key_hint_normalization":"trim_strip_sk_prefix","key_hints_complete":true,"unavailable_key_hint_ids":[]}`, &remote))
	require.NotNil(t, remote.HintsComplete)
	assert.True(t, *remote.HintsComplete)
	assert.Equal(t, "trim_strip_sk_prefix", remote.HintNormalization)
	assert.Empty(t, remote.UnavailableHintIDs)
	remote.Groups[0].Keys = []upstreamRateAPIKey{apiKey}
	record := mergeUpstreamRateRecord(upstreamRateRecord{}, remote, now)
	snapshots := map[string]upstreamRateSnapshot{source.ID: {ReadAt: now, Complete: true, HintChannelIDs: []int{4}, Channels: map[int]upstreamRateRecord{4: record}}}
	item := buildUpstreamRateMatchIndex([]upstreamRateSource{source}, snapshots, now).match(key, remote.SiteURL, []string{key}, now)
	require.Equal(t, "matched", item.Status)
	encoded, err := common.Marshal(item)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), key)
	assert.NotContains(t, string(encoded), mask)
	assert.NotContains(t, string(encoded), "masked_key")
	assert.NotContains(t, string(encoded), "key_prefix")
	assert.NotContains(t, string(encoded), "key_suffix")
	assert.NotContains(t, string(encoded), `"fingerprint":`)
	assert.Contains(t, string(encoded), `"match_method":"masked"`)
}

func TestUpstreamRateDecodeDisablesHintsForAmbiguousSites(t *testing.T) {
	for _, tc := range []struct {
		name, site    string
		hintsComplete bool
	}{
		{"普通站点保留完整提示", "https://provider.example/api", true},
		{"查询参数不能被清洗后用于近似匹配", "https://provider.example/api?tenant=a", false},
		{"用户信息不能被清洗后用于近似匹配", "https://test-user:test-only-password@provider.example/api", false},
		{"片段不能被清洗后用于近似匹配", "https://provider.example/api#tenant-a", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body, err := common.Marshal(map[string]any{
				"success": true,
				"data": map[string]any{
					"complete": false,
					"channels": []any{map[string]any{
						"channel_id": 4, "channel_name": "上游账号", "site_url": tc.site,
						"key_fingerprint_algorithm": "sha256", "key_fingerprint_normalization": "trim", "key_fingerprints_complete": false,
						"key_hint_normalization": "trim_strip_sk_prefix", "key_hints_complete": true, "unavailable_key_hint_ids": []int{},
						"key_sync_status": "partial", "key_synced_at": "2026-11-08T00:00:00Z", "unavailable_api_key_ids": []int{11},
						"groups": []any{map[string]any{
							"group_id": 1, "group_name": "实际分组", "ratio": 1.9, "updated_at": "2026-11-08T00:00:00Z",
							"api_keys": []any{map[string]any{"api_key_id": 11, "fingerprint": "", "masked_key": "sk-e1a...cac1", "key_prefix": "e1a", "key_suffix": "cac1"}},
						}},
					}},
					"errors": []any{map[string]any{"channel_id": 7, "code": "channel_data_unavailable"}},
				},
			})
			require.NoError(t, err)
			channels, channelErrors, complete, err := decodeUpstreamRateChannels(body, 0)
			require.NoError(t, err)
			require.Len(t, channels, 1)
			channel := channels[0]
			assert.False(t, complete, "解析不能将原始指纹完整性改写成提示完整性")
			assert.Equal(t, map[int]string{7: "channel_unavailable"}, channelErrors, "批量错误渠道必须保留到范围判断")
			assert.Equal(t, "https://provider.example/api", channel.SiteURL)
			require.NotNil(t, channel.HintsComplete)
			assert.Equal(t, tc.hintsComplete, *channel.HintsComplete)
			assert.Equal(t, "trim_strip_sk_prefix", channel.HintNormalization)
			assert.Equal(t, []int{11}, channel.UnavailableIDs)
			assert.Empty(t, channel.UnavailableHintIDs)
			require.Len(t, channel.Groups, 1)
			require.Len(t, channel.Groups[0].Keys, 1)
			assert.Equal(t, upstreamRateAPIKey{ID: 11, MaskedKey: "sk-e1a...cac1", KeyPrefix: "e1a", KeySuffix: "cac1"}, channel.Groups[0].Keys[0])
		})
	}
}

func TestUpstreamRateRefreshAcceptsCompleteMaskedSnapshots(t *testing.T) {
	now := int64(1794096000)
	for _, tc := range []struct {
		name                      string
		complete, mixed, expected bool
		errors                    map[int]string
		edit                      func(*upstreamRateRemoteChannel)
	}{
		{name: "只有完整提示且批量指纹不完整仍刷新成功", expected: true},
		{name: "混合完整指纹渠道和完整提示渠道刷新成功", mixed: true, expected: true},
		{name: "批量存在真正读取失败时刷新失败", errors: map[int]string{7: "channel_unavailable"}},
		{name: "缺少提示完整性时刷新失败", edit: func(channel *upstreamRateRemoteChannel) { channel.HintsComplete = nil }},
		{name: "提示不完整时刷新失败", edit: func(channel *upstreamRateRemoteChannel) { channel.HintsComplete = common.GetPointer(false) }},
		{name: "错误提示归一化规则不能视为完整刷新", edit: func(channel *upstreamRateRemoteChannel) { channel.HintNormalization = "trim" }},
		{name: "坏提示不能视为完整刷新", edit: func(channel *upstreamRateRemoteChannel) { channel.Groups[0].Keys[0].KeySuffix = "ac1" }},
		{name: "提示不可用标记不能视为完整刷新", edit: func(channel *upstreamRateRemoteChannel) { channel.UnavailableHintIDs = []int{11} }},
		{name: "真实同步失败不能视为完整刷新", edit: func(channel *upstreamRateRemoteChannel) { channel.Status = "failed" }},
		{name: "完整指纹的旧协议仍然刷新成功", complete: true, expected: true, edit: func(channel *upstreamRateRemoteChannel) {
			channel.Status, channel.Complete, channel.UnavailableIDs = "ready", common.GetPointer(true), nil
			channel.HintsComplete, channel.HintNormalization = nil, ""
			channel.Groups[0].Keys[0].Fingerprint = strings.Repeat("a", 64)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, remote := upstreamRateMaskedFixture(now)
			remote.Status, remote.Complete, remote.UnavailableIDs = "partial", common.GetPointer(false), []int{11}
			if tc.edit != nil {
				tc.edit(&remote)
			}
			channels := []upstreamRateRemoteChannel{remote}
			if tc.mixed {
				_, exact := upstreamRateMaskedFixture(now)
				exact.ID, exact.SiteURL, exact.HintsComplete, exact.HintNormalization = 7, "https://exact.example", nil, ""
				exact.Groups[0].Keys[0].Fingerprint = strings.Repeat("a", 64)
				channels = append(channels, exact)
			}
			assert.Equal(t, tc.expected, upstreamRateRefreshComplete(channels, tc.errors, tc.complete, now))
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
				input := UpstreamRateSourceInput{Name: "未加密来源", BaseURL: "https://rates.example.com", Token: token, Enabled: true, PollSeconds: 60}
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
			require.NoError(t, SaveUpstreamRateSource(ctx, UpstreamRateSourceInput{Name: strings.Repeat("源", 80), BaseURL: "https://rates.example.com", Token: token, Enabled: true, PollSeconds: 60}))
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
				snapshot.Channels[4] = mergeUpstreamRateRecord(upstreamRateRecord{}, remote, now)
				snapshot.ReadAt = now
				snapshot.Complete = true
				return nil
			}))
			views, err := GetUpstreamRates(ctx, []int{channel.Id})
			require.NoError(t, err)
			require.Len(t, views, 1)
			assert.Equal(t, "not_synced", views[0].Status)
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
				snapshot.Channels[7] = mergeUpstreamRateRecord(upstreamRateRecord{}, secondRemote, now)
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
			for _, tc := range []struct {
				name   string
				change func(*upstreamRateSnapshot)
			}{
				{"无关账号失败不影响当前 Key 命中", func(snapshot *upstreamRateSnapshot) {
					snapshot.Channels[99] = upstreamRateRecord{Error: "request_failed"}
					snapshot.Complete = false
				}},
				{"同账号其他 Key 不完整不影响当前 Key 命中", func(snapshot *upstreamRateSnapshot) {
					record := snapshot.Channels[4]
					record.Data.Complete = common.GetPointer(false)
					snapshot.Channels[4] = record
				}},
			} {
				t.Run(tc.name, func(t *testing.T) {
					require.NoError(t, mutateUpstreamRateSnapshot(ctx, source, func(snapshot *upstreamRateSnapshot) error {
						tc.change(snapshot)
						return nil
					}))
					actual, err := GetUpstreamRates(ctx, []int{channel.Id})
					require.NoError(t, err)
					require.Len(t, actual, 1)
					assert.Equal(t, "matched", actual[0].Status)
					assert.Equal(t, 2, actual[0].MatchedKeys)
					assert.Equal(t, "matched", actual[0].Keys[0].Status)
					assert.Equal(t, "matched", actual[0].Keys[1].Status)
					require.NoError(t, mutateUpstreamRateSnapshot(ctx, source, func(snapshot *upstreamRateSnapshot) error {
						delete(snapshot.Channels, 99)
						snapshot.Complete = true
						snapshot.Channels[4] = mergeUpstreamRateRecord(snapshot.Channels[4], remote, now)
						return nil
					}))
				})
			}
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
				{"早于已知记录的采集时间不会覆盖历史倍率", "older_snapshot", func(input *upstreamRateRemoteChannel) {
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
						snapshot.Channels[4] = mergeUpstreamRateRecord(snapshot.Channels[4], input, now)
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
