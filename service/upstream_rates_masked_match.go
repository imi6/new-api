package service

import (
	"slices"
	"strings"
	"unicode"
)

type upstreamRateHintCandidate struct {
	Key      upstreamRateAPIKey
	Group    upstreamRateGroup
	Conflict bool
}

type upstreamRateHintMatch struct {
	Source    upstreamRateSource
	Record    upstreamRateRecord
	Candidate upstreamRateHintCandidate
	Status    string
}

// 同一 Key 的重复记录仅在提示、分组和倍率一致时合并，其他重复均保留冲突。
func upstreamRateHintCandidateIndex(channel upstreamRateRemoteChannel) (map[string][]upstreamRateHintCandidate, bool) {
	index := map[string][]upstreamRateHintCandidate{}
	byID := map[int][]int{}
	candidates := []upstreamRateHintCandidate{}
	invalidGroups := conflictingUpstreamRateGroups(channel)
	complete := true
	for _, group := range channel.Groups {
		identity := upstreamRateGroupIdentity(group.ID, group.Name)
		for _, key := range group.Keys {
			validPrefix := len(key.KeyPrefix) <= 3 && strings.IndexFunc(key.KeyPrefix, unicode.IsSpace) < 0 && strings.IndexFunc(key.KeyPrefix, unicode.IsControl) < 0
			validSuffix := len(key.KeySuffix) == 4 && strings.IndexFunc(key.KeySuffix, unicode.IsSpace) < 0 && strings.IndexFunc(key.KeySuffix, unicode.IsControl) < 0
			if key.ID <= 0 || !validPrefix || !validSuffix {
				complete = false
			}
			if !validSuffix {
				continue
			}
			// 尾号可辨认但前缀损坏时仍保留为冲突候选，不能跳过后宣称唯一。
			if !validPrefix {
				key.KeyPrefix = ""
			}
			candidate := upstreamRateHintCandidate{Key: key, Group: group, Conflict: invalidGroups[identity] || key.ID <= 0 || !validPrefix}
			duplicate := false
			for _, i := range byID[key.ID] {
				prior := &candidates[i]
				if upstreamRateGroupIdentity(prior.Group.ID, prior.Group.Name) == identity && prior.Group.Name == group.Name && prior.Group.Ratio != nil && group.Ratio != nil && *prior.Group.Ratio == *group.Ratio && prior.Group.UpdatedAt == group.UpdatedAt && prior.Key.Fingerprint == key.Fingerprint && prior.Key.KeyPrefix == key.KeyPrefix && prior.Key.KeySuffix == key.KeySuffix {
					prior.Conflict = prior.Conflict || candidate.Conflict
					duplicate = true
					continue
				}
				prior.Conflict, candidate.Conflict = true, true
			}
			if !duplicate {
				byID[key.ID] = append(byID[key.ID], len(candidates))
				candidates = append(candidates, candidate)
			}
		}
	}
	for _, candidate := range candidates {
		index[candidate.Key.KeySuffix] = append(index[candidate.Key.KeySuffix], candidate)
	}
	return index, complete
}

func (index *upstreamRateMatchIndex) addHintSource(source upstreamRateSource, snapshot upstreamRateSnapshot, now int64) {
	// 来源读取失败或批量范围缺失时，不依据残缺响应推导新的近似归属。
	if snapshot.Error != "" || snapshot.ReadAt <= 0 || snapshot.HintChannelIDs == nil {
		index.HintsIncomplete = true
		return
	}
	seen := map[int]bool{}
	for _, id := range snapshot.HintChannelIDs {
		if seen[id] {
			continue
		}
		seen[id] = true
		record, exists := snapshot.Channels[id]
		if !exists || id <= 0 || record.Data.ID != id {
			index.HintsIncomplete = true
			continue
		}
		quality := upstreamRateRecordStatus(record, now)
		if quality != "ready" && quality != "partial" {
			index.HintsIncomplete = true
			continue
		}
		channel := record.Data
		status := ""
		if channel.HintsComplete == nil || !*channel.HintsComplete || len(channel.UnavailableHintIDs) > 0 {
			status = "not_synced"
		}
		if channel.HintNormalization != "trim_strip_sk_prefix" {
			status = "unsupported_protocol"
		}
		candidates, complete := upstreamRateHintCandidateIndex(channel)
		if !complete {
			status = "invalid_response"
		}
		// 提示不完整的渠道不能提供新倍率，但已返回候选仍参与跨站点冲突判断。
		for suffix, matches := range candidates {
			for _, candidate := range matches {
				index.Hints[suffix] = append(index.Hints[suffix], upstreamRateHintMatch{Source: source, Record: record, Candidate: candidate, Status: status})
			}
		}
	}
}

func (index upstreamRateMatchIndex) matchHint(rawKey string, localKeys []string, now int64) (UpstreamRateKeyView, bool) {
	item := UpstreamRateKeyView{Status: "unmatched"}
	if index.HintsIncomplete {
		return item, false
	}
	value := strings.TrimPrefix(strings.TrimSpace(rawKey), "sk-")
	if len(value) < 4 {
		return item, false
	}
	matches := []upstreamRateHintMatch{}
	for _, candidate := range index.Hints[value[len(value)-4:]] {
		if strings.HasPrefix(value, candidate.Candidate.Key.KeyPrefix) {
			matches = append(matches, candidate)
		}
	}
	if len(matches) == 0 {
		return item, false
	}
	if len(matches) > 1 || matches[0].Candidate.Conflict {
		item.Status = "conflict"
		return item, true
	}
	match := matches[0]
	if match.Status != "" {
		item.Status = match.Status
		return item, false
	}
	key, group, record := match.Candidate.Key, match.Candidate.Group, match.Record
	// 必须先统计所有提示候选，不能排除不匹配的完整指纹后伪造唯一性。
	if key.Fingerprint != "" {
		if !validUpstreamRateFingerprint(key.Fingerprint) {
			item.Status = "invalid_response"
			return item, true
		}
		fingerprint, err := upstreamRateFingerprint(rawKey, record.Data.Normalization)
		if err != nil || (key.Fingerprint != fingerprint && !slices.Contains(record.Data.UnavailableIDs, key.ID)) {
			return item, true
		}
	}
	for _, other := range localKeys {
		otherValue := strings.TrimPrefix(strings.TrimSpace(other), "sk-")
		// 提示规则和凭据身份规则独立；trim 下带 sk- 与不带 sk- 是不同 Key。
		sameCredential := strings.TrimSpace(other) == strings.TrimSpace(rawKey) || (record.Data.Normalization == "trim_strip_sk_prefix" && otherValue == value)
		if !sameCredential && strings.HasPrefix(otherValue, key.KeyPrefix) && strings.HasSuffix(otherValue, key.KeySuffix) {
			item.Status = "conflict"
			return item, true
		}
	}
	if !validUpstreamRateGroup(group, now) {
		item.Status = "invalid_response"
		return item, true
	}
	item.Status, item.MatchMethod = "matched", "masked"
	item.SourceID, item.SourceName = match.Source.ID, match.Source.Name
	item.UpstreamChannelID, item.UpstreamChannelName = record.Data.ID, record.Data.Name
	item.SiteURL, item.ReadAt, item.OnlyWithKeys = record.Data.SiteURL, record.ReadAt, record.Data.OnlyWithKeys
	item.SyncStatus = upstreamRateRecordStatus(record, now)
	item.GroupID, item.GroupName, item.Ratio = group.ID, group.Name, group.Ratio
	item.CollectedAt, item.KeySyncedAt = upstreamRateTimestamp(group.UpdatedAt), upstreamRateTimestamp(record.Data.KeySyncedAt)
	if history, exists := record.History[upstreamRateGroupIdentity(group.ID, group.Name)]; exists {
		if history.CollectedAt > item.CollectedAt || (history.CollectedAt == item.CollectedAt && history.Ratio != *item.Ratio) {
			item.Status, item.Ratio, item.CollectedAt = "older_snapshot", &history.Ratio, history.CollectedAt
		} else {
			item.Change = history.Change
		}
	}
	if item.Change != nil && now-item.Change.At > 86400 {
		item.Change = nil
	}
	return item, true
}
