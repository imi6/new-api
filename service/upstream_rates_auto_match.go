package service

import (
	"context"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

type upstreamRateKeyMatch struct {
	Source    upstreamRateSource
	Record    upstreamRateRecord
	Candidate upstreamRateCandidate
}

// 指纹索引以来源声明的归一化规则分区，不使用渠道名称或 URL 猜测归属。
type upstreamRateMatchIndex struct {
	Current map[string]map[string][]upstreamRateKeyMatch
	Known   map[string]map[string][]upstreamRateKeyMatch
	Status  string
	Enabled bool
}

func upstreamRateRecordStatus(source upstreamRateSource, record upstreamRateRecord, now int64) string {
	if record.Error != "" {
		switch record.Error {
		case "channel_unavailable":
			return "unavailable"
		case "older_snapshot":
			return "older_snapshot"
		default:
			return "read_failed"
		}
	}
	status := upstreamRateChannelQuality(record.Data, now, int64((source.ScanMinutes*2+5)*60))
	if (status == "ready" || status == "partial") && now-record.ReadAt > int64(source.PollSeconds*3) {
		return "read_failed"
	}
	return status
}

func buildUpstreamRateMatchIndex(sources []upstreamRateSource, snapshots map[string]upstreamRateSnapshot, now int64) upstreamRateMatchIndex {
	index := upstreamRateMatchIndex{Current: map[string]map[string][]upstreamRateKeyMatch{}, Known: map[string]map[string][]upstreamRateKeyMatch{}}
	for _, rule := range []string{"trim", "trim_strip_sk_prefix"} {
		index.Current[rule] = map[string][]upstreamRateKeyMatch{}
		index.Known[rule] = map[string][]upstreamRateKeyMatch{}
	}
	for _, source := range sources {
		if !source.Enabled {
			continue
		}
		index.Enabled = true
		snapshot := snapshots[source.ID]
		status := "unmatched"
		if snapshot.Error != "" {
			status = "read_failed"
		} else if snapshot.ReadAt == 0 {
			status = "not_synced"
		} else if !snapshot.Complete {
			status = "partial"
		}
		recordStatus := ""
		for _, record := range snapshot.Channels {
			quality := upstreamRateRecordStatus(source, record, now)
			if quality == "ready" {
				quality = "unmatched"
			}
			if recordStatus == "" {
				recordStatus = quality
			} else if recordStatus != quality {
				recordStatus = "partial"
			}
			if byFingerprint, supported := index.Current[record.Data.Normalization]; supported {
				for fingerprint, candidates := range upstreamRateCandidateIndex(record.Data) {
					for _, candidate := range candidates {
						byFingerprint[fingerprint] = append(byFingerprint[fingerprint], upstreamRateKeyMatch{Source: source, Record: record, Candidate: candidate})
					}
				}
			}
			for identity := range record.Known {
				rule, fingerprint, found := strings.Cut(identity, ":")
				byFingerprint, supported := index.Known[rule]
				if !found || !supported || !validUpstreamRateFingerprint(fingerprint) {
					continue
				}
				byFingerprint[fingerprint] = append(byFingerprint[fingerprint], upstreamRateKeyMatch{Source: source, Record: record})
			}
		}
		if status == "unmatched" && recordStatus != "" {
			status = recordStatus
		}
		if index.Status == "" {
			index.Status = status
		} else if index.Status != status {
			index.Status = "partial"
		}
	}
	if !index.Enabled {
		index.Status = "not_configured"
		if len(sources) > 0 {
			index.Status = "disabled"
		}
	}
	return index
}

func (index upstreamRateMatchIndex) match(rawKey string, now int64) UpstreamRateKeyView {
	item := UpstreamRateKeyView{Status: index.Status}
	value := strings.TrimSpace(rawKey)
	if value == "" || strings.IndexFunc(value, unicode.IsSpace) >= 0 || strings.IndexFunc(value, unicode.IsControl) >= 0 || strings.HasPrefix(value, "{") || strings.HasPrefix(value, "[") || strings.HasPrefix(value, "\"") {
		item.Status = "unsupported_credential"
		return item
	}
	current, historical := []upstreamRateKeyMatch{}, []upstreamRateKeyMatch{}
	fingerprints := map[string]string{}
	for _, rule := range []string{"trim", "trim_strip_sk_prefix"} {
		fingerprint, err := upstreamRateFingerprint(rawKey, rule)
		if err != nil {
			continue
		}
		fingerprints[rule] = fingerprint
		current = append(current, index.Current[rule][fingerprint]...)
		historical = append(historical, index.Known[rule][fingerprint]...)
	}
	// 跨来源、跨上游渠道或跨分组出现多个候选时，不能取第一项或靠名称消除冲突。
	if len(current) > 1 || (len(current) == 0 && len(historical) > 1) {
		item.Status = "conflict"
		return item
	}
	if len(current) == 0 && len(historical) == 0 {
		return item
	}
	var match upstreamRateKeyMatch
	if len(current) == 1 {
		match = current[0]
	} else {
		match = historical[0]
	}
	source, record := match.Source, match.Record
	quality := upstreamRateRecordStatus(source, record, now)
	item.SourceID, item.SourceName = source.ID, source.Name
	item.UpstreamChannelID, item.UpstreamChannelName = record.Data.ID, record.Data.Name
	item.SiteURL, item.ReadAt, item.Error = record.Data.SiteURL, record.ReadAt, record.Error
	item.SyncStatus, item.OnlyWithKeys = quality, record.Data.OnlyWithKeys
	item.Status = quality
	if quality == "ready" {
		item.Status = "unmatched"
	}
	if len(current) == 1 {
		candidate, group := match.Candidate, match.Candidate.Group
		switch {
		case candidate.Conflict:
			item.Status = "conflict"
		case candidate.Unavailable:
			item.Status = "unavailable"
		case quality != "ready" && quality != "partial":
		case !validUpstreamRateGroup(group, now):
			item.Status = "invalid_response"
		case now-upstreamRateTimestamp(group.UpdatedAt) > int64((source.ScanMinutes*2+5)*60):
			item.Status = "stale"
		default:
			item.Status, item.GroupID, item.GroupName, item.Ratio = "matched", group.ID, group.Name, group.Ratio
			item.CollectedAt, item.KeySyncedAt = upstreamRateTimestamp(group.UpdatedAt), upstreamRateTimestamp(record.Data.KeySyncedAt)
			if history, ok := record.History[upstreamRateGroupIdentity(group.ID, group.Name)]; ok {
				if history.CollectedAt > item.CollectedAt || (history.CollectedAt == item.CollectedAt && history.Ratio != *item.Ratio) {
					item.Status = "older_snapshot"
				} else {
					item.Change = history.Change
				}
			}
		}
	}
	// 只在唯一可信归属中回退历史值，已删除的旧绑定从不参与自动匹配。
	for _, rule := range []string{"trim", "trim_strip_sk_prefix"} {
		known, exists := record.Known[rule+":"+fingerprints[rule]]
		if !exists || (len(current) == 1 && record.Data.Normalization != rule) {
			continue
		}
		item.MovedFrom, item.MovedAt = known.MovedFrom, known.MovedAt
		if item.Status != "matched" {
			item.GroupID, item.GroupName, item.Ratio = known.GroupID, known.GroupName, &known.Ratio
			item.CollectedAt, item.KeySyncedAt = known.CollectedAt, known.KeySyncedAt
		}
		break
	}
	if item.Change != nil && now-item.Change.At > 86400 {
		item.Change = nil
	}
	if item.MovedAt > 0 && now-item.MovedAt > 86400 {
		item.MovedFrom, item.MovedAt = "", 0
	}
	return item
}

func GetUpstreamRates(ctx context.Context, ids []int) ([]UpstreamRateView, error) {
	config, err := loadUpstreamRateConfig(ctx)
	if err != nil {
		return nil, err
	}
	channels, err := model.GetUpstreamRateChannels(ctx, ids)
	if err != nil {
		return nil, err
	}
	snapshots := map[string]upstreamRateSnapshot{}
	for _, source := range config.Sources {
		if !source.Enabled {
			continue
		}
		snapshot, err := loadUpstreamRateSnapshot(ctx, source)
		if err != nil {
			return nil, err
		}
		snapshots[source.ID] = snapshot
	}
	now := time.Now().Unix()
	index := buildUpstreamRateMatchIndex(config.Sources, snapshots, now)
	views := make([]UpstreamRateView, 0, len(channels))
	for _, channel := range channels {
		view := UpstreamRateView{ChannelID: channel.Id, Keys: []UpstreamRateKeyView{}, RefreshAvailable: index.Enabled, OnlyWithKeys: true}
		keys := []string{channel.Key}
		if channel.ChannelInfo.IsMultiKey {
			keys = channel.GetKeys()
		}
		targets := map[string]UpstreamRateKeyView{}
		conflict := false
		for i, rawKey := range keys {
			item := index.match(rawKey, now)
			item.Index, item.Enabled = i+1, true
			if channel.ChannelInfo.IsMultiKey {
				if status, exists := channel.ChannelInfo.MultiKeyStatusList[i]; exists {
					item.Enabled = status == common.ChannelStatusEnabled
				}
			}
			view.Keys = append(view.Keys, item)
			if !item.Enabled {
				continue
			}
			view.EnabledKeys++
			if item.Status == "matched" {
				view.MatchedKeys++
			}
			if item.SourceID != "" && item.UpstreamChannelID > 0 {
				targets[item.SourceID+":"+strconv.Itoa(item.UpstreamChannelID)] = item
				view.OnlyWithKeys = view.OnlyWithKeys && item.OnlyWithKeys
				if view.ReadAt == 0 || item.ReadAt < view.ReadAt {
					view.ReadAt = item.ReadAt
				}
			}
			if view.Error == "" {
				view.Error = item.Error
			}
			status := item.Status
			if status == "matched" && item.SyncStatus == "partial" {
				status = "partial"
			}
			if status == "conflict" {
				conflict = true
			}
			if view.Status == "" {
				view.Status = status
			} else if view.Status != status {
				view.Status = "partial"
			}
		}
		if view.EnabledKeys == 0 {
			view.Status = "disabled"
		} else if conflict {
			view.Status = "conflict"
		} else if view.Status == "matched" && index.Status != "unmatched" {
			// 全局搜索范围不完整时，已有命中仍可展示，但不能宣称整体匹配完整。
			view.Status = "partial"
		}
		if len(targets) == 1 && !conflict {
			for _, target := range targets {
				view.SourceID, view.SourceName = target.SourceID, target.SourceName
				view.UpstreamChannelID, view.UpstreamChannelName = target.UpstreamChannelID, target.UpstreamChannelName
				view.SiteURL, view.SyncStatus = target.SiteURL, target.SyncStatus
				view.ForceRefreshAvailable = true
			}
		}
		views = append(views, view)
	}
	slices.SortFunc(views, func(a, b UpstreamRateView) int { return a.ChannelID - b.ChannelID })
	return views, nil
}
