package service

import (
	"net"
	"net/url"
	"slices"
	"strconv"
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
}

type upstreamRateHintSite struct {
	BySuffix map[string][]upstreamRateHintMatch
	Status   string
}

// 保留协议、有效端口与基础路径，只兼容末尾斜杠和一个 /v1。
func upstreamRateSiteIdentity(raw string) string {
	site, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || site.Hostname() == "" || site.User != nil || site.RawQuery != "" || site.Fragment != "" || site.Opaque != "" {
		return ""
	}
	scheme := strings.ToLower(site.Scheme)
	if scheme != "http" && scheme != "https" {
		return ""
	}
	host, port := strings.ToLower(site.Hostname()), site.Port()
	if port != "" {
		number, err := strconv.Atoi(port)
		if err != nil || number <= 0 || number > 65535 {
			return ""
		}
		port = strconv.Itoa(number)
	}
	if (scheme == "https" && port == "443") || (scheme == "http" && port == "80") {
		port = ""
	}
	if port != "" {
		host = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	path := strings.TrimRight(site.EscapedPath(), "/")
	path = strings.TrimSuffix(path, "/v1")
	return scheme + "://" + host + path
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
			if key.ID <= 0 || len(key.KeyPrefix) > 3 || len(key.KeySuffix) != 4 || strings.IndexFunc(key.KeyPrefix+key.KeySuffix, unicode.IsSpace) >= 0 || strings.IndexFunc(key.KeyPrefix+key.KeySuffix, unicode.IsControl) >= 0 {
				complete = false
				continue
			}
			candidate := upstreamRateHintCandidate{Key: key, Group: group, Conflict: invalidGroups[identity]}
			duplicate := false
			for _, i := range byID[key.ID] {
				prior := &candidates[i]
				if upstreamRateGroupIdentity(prior.Group.ID, prior.Group.Name) == identity && prior.Group.Name == group.Name && prior.Group.Ratio != nil && group.Ratio != nil && *prior.Group.Ratio == *group.Ratio && prior.Group.UpdatedAt == group.UpdatedAt && prior.Key.Fingerprint == key.Fingerprint && prior.Key.KeyPrefix == key.KeyPrefix && prior.Key.KeySuffix == key.KeySuffix {
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
	// 来源整体不可读或未取得批量范围时，无法排除其中还有同站点账号。
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
		site := upstreamRateSiteIdentity(record.Data.SiteURL)
		if !exists || id <= 0 || record.Data.ID != id || site == "" {
			index.HintsIncomplete = true
			continue
		}
		scope := index.Hints[site]
		if scope == nil {
			scope = &upstreamRateHintSite{BySuffix: map[string][]upstreamRateHintMatch{}}
			index.Hints[site] = scope
		}
		quality := upstreamRateRecordStatus(record, now)
		if quality != "ready" && quality != "partial" {
			scope.Status = quality
			continue
		}
		channel := record.Data
		if channel.HintsComplete == nil || !*channel.HintsComplete || len(channel.UnavailableHintIDs) > 0 {
			scope.Status = "not_synced"
			continue
		}
		if channel.HintNormalization != "trim_strip_sk_prefix" {
			scope.Status = "unsupported_protocol"
			continue
		}
		candidates, complete := upstreamRateHintCandidateIndex(channel)
		if !complete {
			scope.Status = "invalid_response"
			continue
		}
		for suffix, matches := range candidates {
			for _, candidate := range matches {
				scope.BySuffix[suffix] = append(scope.BySuffix[suffix], upstreamRateHintMatch{Source: source, Record: record, Candidate: candidate})
			}
		}
	}
}

func (index upstreamRateMatchIndex) matchHint(rawKey, siteURL string, localKeys []string, now int64) (UpstreamRateKeyView, bool) {
	item := UpstreamRateKeyView{Status: "unmatched"}
	site := upstreamRateSiteIdentity(siteURL)
	if index.HintsIncomplete || site == "" {
		return item, false
	}
	scope := index.Hints[site]
	if scope == nil {
		return item, false
	}
	if scope.Status != "" {
		item.Status = scope.Status
		return item, false
	}
	value := strings.TrimPrefix(strings.TrimSpace(rawKey), "sk-")
	if len(value) < 4 {
		return item, false
	}
	matches := []upstreamRateHintMatch{}
	for _, candidate := range scope.BySuffix[value[len(value)-4:]] {
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
