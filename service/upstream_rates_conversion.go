package service

import (
	"cmp"
	"context"
	"math"
	"net"
	"net/url"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/shopspring/decimal"
)

// UpstreamRateConversionRule 在 Key 匹配完成后换算上游倍率，范围越具体越优先。
// 原始快照及其涨跌历史始终保持上游口径，不把配置调整记录为上游变更。
type UpstreamRateConversionRule struct {
	SourceID          string  `json:"source_id"`
	SiteURL           string  `json:"site_url"`
	UpstreamChannelID int     `json:"upstream_channel_id,omitempty"`
	GroupID           int     `json:"group_id,omitempty"`
	GroupName         string  `json:"group_name,omitempty"`
	Factor            float64 `json:"factor"`
}

type UpstreamRateConversionGroup struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

type UpstreamRateConversionChannel struct {
	ID     int                           `json:"id"`
	Name   string                        `json:"name"`
	Groups []UpstreamRateConversionGroup `json:"groups"`
}

// UpstreamRateConversionSite 只公开选择规则所需的名称和标识，不携带凭据或指纹。
type UpstreamRateConversionSite struct {
	SourceID   string                          `json:"source_id"`
	SourceName string                          `json:"source_name"`
	SiteURL    string                          `json:"site_url"`
	Channels   []UpstreamRateConversionChannel `json:"channels"`
}

type upstreamRateConversionTarget struct {
	SourceID  string
	SiteURL   string
	ChannelID int
	GroupID   int
	GroupName string
}

// upstreamRateConversionSiteURL 只统一同一地址的写法，保留协议、非默认端口和基础路径。
// 不合并 api 子域名或其他别名，规则始终绑定 Key 命中后返回的真实上游站点。
func upstreamRateConversionSiteURL(raw string) (string, bool) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || len(raw) > 1024 || u.Hostname() == "" || u.User != nil || u.Opaque != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return "", false
	}
	u.Scheme = strings.ToLower(u.Scheme)
	if u.Scheme != "https" && u.Scheme != "http" {
		return "", false
	}
	host, port := strings.ToLower(u.Hostname()), u.Port()
	if u.Scheme == "https" && port == "443" || u.Scheme == "http" && port == "80" {
		port = ""
	}
	u.Host = host
	if port != "" {
		u.Host = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		u.Host = "[" + host + "]"
	}
	u.Path = strings.TrimRight(u.Path, "/")
	u.RawPath = strings.TrimRight(u.RawPath, "/")
	return u.String(), true
}

func upstreamRateConversionSites(sources []upstreamRateSource, snapshots map[string]upstreamRateSnapshot) []UpstreamRateConversionSite {
	sites := make([]UpstreamRateConversionSite, 0)
	for _, source := range sources {
		byURL := map[string][]UpstreamRateConversionChannel{}
		for _, record := range snapshots[source.ID].Channels {
			siteURL, ok := upstreamRateConversionSiteURL(record.Data.SiteURL)
			if !ok || record.Data.ID <= 0 {
				continue
			}
			channel := UpstreamRateConversionChannel{ID: record.Data.ID, Name: record.Data.Name, Groups: []UpstreamRateConversionGroup{}}
			seen := map[string]bool{}
			for _, group := range record.Data.Groups {
				identity := upstreamRateGroupIdentity(group.ID, group.Name)
				if group.ID < 0 || group.Name == "" || seen[identity] {
					continue
				}
				seen[identity] = true
				channel.Groups = append(channel.Groups, UpstreamRateConversionGroup{ID: group.ID, Name: group.Name})
			}
			slices.SortFunc(channel.Groups, func(a, b UpstreamRateConversionGroup) int {
				return cmp.Or(strings.Compare(a.Name, b.Name), cmp.Compare(a.ID, b.ID))
			})
			byURL[siteURL] = append(byURL[siteURL], channel)
		}
		for siteURL, channels := range byURL {
			slices.SortFunc(channels, func(a, b UpstreamRateConversionChannel) int { return cmp.Compare(a.ID, b.ID) })
			sites = append(sites, UpstreamRateConversionSite{SourceID: source.ID, SourceName: source.Name, SiteURL: siteURL, Channels: channels})
		}
	}
	slices.SortFunc(sites, func(a, b UpstreamRateConversionSite) int {
		return cmp.Or(strings.Compare(a.SourceID, b.SourceID), strings.Compare(a.SiteURL, b.SiteURL))
	})
	return sites
}

func normalizeUpstreamRateConversionRule(rule UpstreamRateConversionRule) (UpstreamRateConversionRule, upstreamRateConversionTarget, bool) {
	siteURL, ok := upstreamRateConversionSiteURL(rule.SiteURL)
	if !ok || rule.SourceID == "" || len(rule.SourceID) > 64 || rule.UpstreamChannelID < 0 || rule.GroupID < 0 || utf8.RuneCountInString(rule.GroupName) > 256 || math.IsNaN(rule.Factor) || math.IsInf(rule.Factor, 0) || rule.Factor < 1e-6 || rule.Factor > 1e6 {
		return rule, upstreamRateConversionTarget{}, false
	}
	if rule.UpstreamChannelID == 0 && (rule.GroupID != 0 || rule.GroupName != "") {
		return rule, upstreamRateConversionTarget{}, false
	}
	if rule.GroupID > 0 {
		rule.GroupName = ""
	} else if rule.GroupName != "" && strings.TrimSpace(rule.GroupName) == "" {
		return rule, upstreamRateConversionTarget{}, false
	}
	rule.SiteURL = siteURL
	target := upstreamRateConversionTarget{SourceID: rule.SourceID, SiteURL: siteURL, ChannelID: rule.UpstreamChannelID, GroupID: rule.GroupID, GroupName: rule.GroupName}
	return rule, target, true
}

// SaveUpstreamRateConversionRules 替换换算规则。新增范围必须来自已同步目录；已有范围
// 在上游暂时不返回时仍允许保留或修改系数，避免接口故障导致既有修正无法保存。
func SaveUpstreamRateConversionRules(ctx context.Context, rules []UpstreamRateConversionRule) error {
	upstreamRateGuardMu.Lock()
	defer upstreamRateGuardMu.Unlock()
	if len(rules) > 200 {
		return ErrUpstreamRateConfig
	}
	config, err := loadUpstreamRateConfig(ctx)
	if err != nil {
		return err
	}
	snapshots := make(map[string]upstreamRateSnapshot, len(config.Sources))
	revisions := make(map[string]string, len(config.Sources))
	for _, source := range config.Sources {
		snapshot, err := loadUpstreamRateSnapshot(ctx, source)
		if err != nil {
			return err
		}
		snapshots[source.ID], revisions[source.ID] = snapshot, source.Revision
	}
	available := map[upstreamRateConversionTarget]bool{}
	for _, site := range upstreamRateConversionSites(config.Sources, snapshots) {
		target := upstreamRateConversionTarget{SourceID: site.SourceID, SiteURL: site.SiteURL}
		available[target] = true
		for _, channel := range site.Channels {
			target.ChannelID = channel.ID
			available[target] = true
			for _, group := range channel.Groups {
				groupTarget := target
				groupTarget.GroupID = group.ID
				if group.ID == 0 {
					groupTarget.GroupName = group.Name
				}
				available[groupTarget] = true
			}
		}
	}
	normalized := make([]UpstreamRateConversionRule, 0, len(rules))
	seen := map[upstreamRateConversionTarget]bool{}
	for _, rule := range rules {
		rule, target, ok := normalizeUpstreamRateConversionRule(rule)
		if !ok || seen[target] {
			return ErrUpstreamRateConfig
		}
		seen[target] = true
		normalized = append(normalized, rule)
	}
	return model.MutateUpstreamRatesState(ctx, "config", func(raw string) (string, error) {
		var current upstreamRateConfig
		if err := common.UnmarshalJsonStr(raw, &current); err != nil {
			return "", err
		}
		sources := make(map[string]string, len(current.Sources))
		for _, source := range current.Sources {
			sources[source.ID] = source.Revision
		}
		existing := map[upstreamRateConversionTarget]bool{}
		for _, rule := range current.ConversionRules {
			_, target, ok := normalizeUpstreamRateConversionRule(rule)
			if ok {
				existing[target] = true
			}
		}
		for _, rule := range normalized {
			_, target, _ := normalizeUpstreamRateConversionRule(rule)
			revision, exists := sources[rule.SourceID]
			if !exists || !existing[target] && (!available[target] || revision != revisions[rule.SourceID]) {
				return "", ErrUpstreamRateConfig
			}
		}
		current.ConversionRules = normalized
		encoded, err := common.Marshal(current)
		return string(encoded), err
	})
}

// convertedUpstreamRate 使用十进制乘法，避免 5.5 × 0.1 的浮点尾差误触发停用。
func convertedUpstreamRate(value, factor float64) (float64, bool) {
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || math.IsNaN(factor) || math.IsInf(factor, 0) || factor < 1e-6 || factor > 1e6 {
		return 0, false
	}
	if factor == 1 {
		return value, true
	}
	converted := decimal.NewFromFloat(value).Mul(decimal.NewFromFloat(factor)).InexactFloat64()
	return converted, !math.IsInf(converted, 0) && !math.IsNaN(converted) && (value == 0 || converted > 0)
}

func applyUpstreamRateConversion(item *UpstreamRateKeyView, rules []UpstreamRateConversionRule) {
	if item.Ratio == nil {
		return
	}
	factor, specificity := 1.0, -1
	siteURL, siteOK := upstreamRateConversionSiteURL(item.SiteURL)
	for _, rule := range rules {
		if !siteOK || rule.SourceID != item.SourceID || rule.SiteURL != siteURL {
			continue
		}
		level := 0
		if rule.UpstreamChannelID != 0 {
			if rule.UpstreamChannelID != item.UpstreamChannelID {
				continue
			}
			level = 1
		}
		if rule.GroupID > 0 {
			if rule.GroupID != item.GroupID {
				continue
			}
			// 上游后来补齐 ID 时，稳定 ID 规则优先于保留的旧名称规则，不能由列表顺序决定。
			level = 3
		} else if rule.GroupName != "" {
			if rule.GroupName != item.GroupName {
				continue
			}
			level = 2
		}
		if level > specificity {
			factor, specificity = rule.Factor, level
		}
	}
	raw := *item.Ratio
	converted, ok := convertedUpstreamRate(raw, factor)
	item.RawRatio, item.ConversionFactor = &raw, factor
	if !ok {
		item.Status, item.Ratio, item.RawRatio, item.Change = "invalid_response", nil, nil, nil
		return
	}
	item.Ratio = &converted
	if item.Change != nil {
		change := *item.Change
		from, fromOK := convertedUpstreamRate(change.From, factor)
		to, toOK := convertedUpstreamRate(change.To, factor)
		if !fromOK || !toOK {
			item.Status, item.Ratio, item.Change = "invalid_response", nil, nil
			return
		}
		change.From, change.To = from, to
		item.Change = &change
	}
}
