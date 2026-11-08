package service

type upstreamRateCandidate struct {
	Group       upstreamRateGroup
	Unavailable bool
	Conflict    bool
}

type UpstreamRateKeyView struct {
	Index               int                 `json:"index"`
	Enabled             bool                `json:"enabled"`
	Status              string              `json:"status"`
	SourceID            string              `json:"source_id,omitempty"`
	SourceName          string              `json:"source_name,omitempty"`
	UpstreamChannelID   int                 `json:"upstream_channel_id,omitempty"`
	UpstreamChannelName string              `json:"upstream_channel_name,omitempty"`
	SiteURL             string              `json:"site_url,omitempty"`
	SyncStatus          string              `json:"sync_status,omitempty"`
	OnlyWithKeys        bool                `json:"only_with_keys"`
	ReadAt              int64               `json:"read_at"`
	Error               string              `json:"error,omitempty"`
	GroupID             int                 `json:"group_id,omitempty"`
	GroupName           string              `json:"group_name,omitempty"`
	Ratio               *float64            `json:"ratio,omitempty"`
	CollectedAt         int64               `json:"collected_at"`
	KeySyncedAt         int64               `json:"key_synced_at"`
	Change              *UpstreamRateChange `json:"change,omitempty"`
	MovedFrom           string              `json:"moved_from,omitempty"`
	MovedAt             int64               `json:"moved_at,omitempty"`
}

type UpstreamRateView struct {
	ChannelID             int                   `json:"channel_id"`
	Status                string                `json:"status"`
	SourceID              string                `json:"source_id,omitempty"`
	SourceName            string                `json:"source_name,omitempty"`
	UpstreamChannelID     int                   `json:"upstream_channel_id,omitempty"`
	UpstreamChannelName   string                `json:"upstream_channel_name,omitempty"`
	SiteURL               string                `json:"site_url,omitempty"`
	SyncStatus            string                `json:"sync_status,omitempty"`
	OnlyWithKeys          bool                  `json:"only_with_keys"`
	ReadAt                int64                 `json:"read_at"`
	Error                 string                `json:"error,omitempty"`
	Keys                  []UpstreamRateKeyView `json:"keys"`
	EnabledKeys           int                   `json:"enabled_keys"`
	MatchedKeys           int                   `json:"matched_keys"`
	RefreshAvailable      bool                  `json:"refresh_available"`
	ForceRefreshAvailable bool                  `json:"force_refresh_available"`
}

func upstreamRateCandidateIndex(channel upstreamRateRemoteChannel) map[string][]upstreamRateCandidate {
	index := map[string][]upstreamRateCandidate{}
	unavailable := map[int]bool{}
	invalidGroups := map[string]bool{}
	groups := map[string]upstreamRateGroup{}
	for _, group := range channel.Groups {
		identity := upstreamRateGroupIdentity(group.ID, group.Name)
		if prior, ok := groups[identity]; ok && (prior.Ratio == nil || group.Ratio == nil || *prior.Ratio != *group.Ratio || prior.UpdatedAt != group.UpdatedAt) {
			invalidGroups[identity] = true
		}
		groups[identity] = group
	}
	for _, id := range channel.UnavailableIDs {
		unavailable[id] = true
	}
	for _, group := range channel.Groups {
		for _, key := range group.Keys {
			if key.ID <= 0 || !validUpstreamRateFingerprint(key.Fingerprint) {
				continue
			}
			identity := upstreamRateGroupIdentity(group.ID, group.Name)
			candidate := upstreamRateCandidate{Group: group, Unavailable: unavailable[key.ID], Conflict: invalidGroups[identity]}
			duplicate := false
			for i := range index[key.Fingerprint] {
				prior := &index[key.Fingerprint][i]
				if upstreamRateGroupIdentity(prior.Group.ID, prior.Group.Name) != identity {
					continue
				}
				if prior.Group.Ratio != nil && group.Ratio != nil && *prior.Group.Ratio == *group.Ratio && prior.Group.UpdatedAt == group.UpdatedAt {
					prior.Unavailable = prior.Unavailable || candidate.Unavailable
					duplicate = true
				}
			}
			if !duplicate {
				index[key.Fingerprint] = append(index[key.Fingerprint], candidate)
			}
		}
	}
	return index
}

func upstreamRateChannelQuality(channel upstreamRateRemoteChannel, now, maxAge int64) string {
	if channel.Status == "not_synced" || channel.Status == "failed" {
		return channel.Status
	}
	if channel.Algorithm != "sha256" || (channel.Normalization != "trim" && channel.Normalization != "trim_strip_sk_prefix") {
		return "unsupported_protocol"
	}
	if channel.Complete == nil {
		return "unsupported_protocol"
	}
	switch channel.Status {
	case "ready":
	case "partial":
	default:
		return "unsupported_protocol"
	}
	at := upstreamRateTimestamp(channel.KeySyncedAt)
	if at <= 0 || at > now+60 {
		return "invalid_time"
	}
	if now-at > maxAge {
		return "stale"
	}
	if channel.Status == "partial" || !*channel.Complete || len(channel.UnavailableIDs) != 0 {
		return "partial"
	}
	return "ready"
}

func mergeUpstreamRateRecord(old upstreamRateRecord, channel upstreamRateRemoteChannel, now, maxAge int64) upstreamRateRecord {
	if old.History == nil {
		old.History = map[string]upstreamRateHistory{}
	}
	if old.Known == nil {
		old.Known = map[string]upstreamRateKnownMatch{}
	}
	if previous := upstreamRateTimestamp(old.Data.KeySyncedAt); previous > 0 && upstreamRateTimestamp(channel.KeySyncedAt) < previous && (channel.Status == "ready" || channel.Status == "partial") {
		old.Error = "older_snapshot"
		return old
	}
	old.Data, old.ReadAt, old.Error = channel, now, ""
	quality := upstreamRateChannelQuality(channel, now, maxAge)
	if quality != "ready" && quality != "partial" {
		return old
	}
	for fingerprint, candidates := range upstreamRateCandidateIndex(channel) {
		if len(candidates) != 1 || candidates[0].Unavailable || candidates[0].Conflict {
			continue
		}
		group := candidates[0].Group
		at := upstreamRateTimestamp(group.UpdatedAt)
		if !validUpstreamRateGroup(group, now) || now-at > maxAge {
			continue
		}
		identity := upstreamRateGroupIdentity(group.ID, group.Name)
		history, exists := old.History[identity]
		if exists && (at < history.CollectedAt || (at == history.CollectedAt && history.Ratio != *group.Ratio)) {
			continue
		}
		if exists && history.Ratio != *group.Ratio {
			history.Change = &UpstreamRateChange{From: history.Ratio, To: *group.Ratio, At: now}
		}
		history.Ratio, history.CollectedAt = *group.Ratio, at
		old.History[identity] = history
		key := channel.Normalization + ":" + fingerprint
		prior := old.Known[key]
		known := upstreamRateKnownMatch{GroupID: group.ID, GroupName: group.Name, Ratio: *group.Ratio, CollectedAt: at, KeySyncedAt: upstreamRateTimestamp(channel.KeySyncedAt), Normalization: channel.Normalization, Change: history.Change, MovedFrom: prior.MovedFrom, MovedAt: prior.MovedAt}
		if prior.GroupName != "" && upstreamRateGroupIdentity(prior.GroupID, prior.GroupName) != identity {
			known.MovedFrom, known.MovedAt = prior.GroupName, now
		}
		old.Known[key] = known
	}
	// 历史仅用于近期回退，限制已删除或轮换密钥造成的无界增长。
	for key, known := range old.Known {
		if now-known.KeySyncedAt > 7*86400 {
			delete(old.Known, key)
		}
	}
	for key, history := range old.History {
		if now-history.CollectedAt > 7*86400 {
			delete(old.History, key)
		}
	}
	return old
}
