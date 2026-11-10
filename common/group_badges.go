package common

import (
	"regexp"
	"slices"
	"strings"
	"sync/atomic"
	"unicode"
	"unicode/utf8"
)

const GroupBadgeConfigOption = "GroupBadgeConfig"

// GroupLabel 只保存分组标签的短文字与受控样式标识。
type GroupLabel struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Icon  string `json:"icon"`
	Color string `json:"color"`
}

type GroupBadgeConfig struct {
	Labels []GroupLabel        `json:"labels"`
	Groups map[string][]string `json:"groups"`
}

type groupBadgeSnapshot struct {
	json   string
	groups map[string][]GroupLabel
}

var groupBadgeIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
var groupBadgeState atomic.Pointer[groupBadgeSnapshot]

// ParseGroupBadgeConfig 在写入前验证完整目录与引用，避免保存无法展示的配置。
func ParseGroupBadgeConfig(raw string) (*GroupBadgeConfig, error) {
	if strings.TrimSpace(raw) == "" {
		return &GroupBadgeConfig{Labels: []GroupLabel{}, Groups: map[string][]string{}}, nil
	}
	if len(raw) > 1024*1024 {
		return nil, NewMessage("Invalid parameters")
	}
	var config GroupBadgeConfig
	if err := UnmarshalJsonStr(raw, &config); err != nil || config.Labels == nil || config.Groups == nil || len(config.Labels) > 64 || len(config.Groups) > 10000 {
		return nil, NewMessage("Invalid parameters")
	}
	labels := make(map[string]struct{}, len(config.Labels))
	for i := range config.Labels {
		label := &config.Labels[i]
		if !groupBadgeIDPattern.MatchString(label.ID) || label.Name == "" || label.Name != strings.TrimSpace(label.Name) || utf8.RuneCountInString(label.Name) > 12 || strings.ContainsFunc(label.Name, unicode.IsControl) {
			return nil, NewMessage("Invalid parameters")
		}
		if _, duplicate := labels[label.ID]; duplicate {
			return nil, NewMessage("Invalid parameters")
		}
		if !slices.Contains([]string{"none", "shield", "badge-check", "award", "sparkles", "star", "zap", "heart"}, label.Icon) || !slices.Contains([]string{"teal", "amber", "violet", "blue", "green", "red", "slate"}, label.Color) {
			return nil, NewMessage("Invalid parameters")
		}
		labels[label.ID] = struct{}{}
	}
	for group, ids := range config.Groups {
		if strings.TrimSpace(group) == "" || utf8.RuneCountInString(group) > 255 || strings.ContainsFunc(group, unicode.IsControl) || ids == nil || len(ids) > 4 {
			return nil, NewMessage("Invalid parameters")
		}
		seen := make(map[string]struct{}, len(ids))
		for _, id := range ids {
			if _, exists := labels[id]; !exists {
				return nil, NewMessage("Invalid parameters")
			}
			if _, duplicate := seen[id]; duplicate {
				return nil, NewMessage("Invalid parameters")
			}
			seen[id] = struct{}{}
		}
	}
	return &config, nil
}

// UpdateGroupBadgeConfig 完整替换不可变快照，读接口不会接触正在修改的目录。
func UpdateGroupBadgeConfig(raw string) error {
	config, err := ParseGroupBadgeConfig(raw)
	if err != nil {
		return err
	}
	encoded, err := Marshal(config)
	if err != nil {
		return err
	}
	labels := make(map[string]GroupLabel, len(config.Labels))
	for _, label := range config.Labels {
		labels[label.ID] = label
	}
	groups := make(map[string][]GroupLabel, len(config.Groups))
	for group, ids := range config.Groups {
		assigned := make([]GroupLabel, 0, len(ids))
		for _, id := range ids {
			assigned = append(assigned, labels[id])
		}
		groups[group] = assigned
	}
	groupBadgeState.Store(&groupBadgeSnapshot{json: string(encoded), groups: groups})
	return nil
}

func GroupBadgeConfigJSONString() string {
	if snapshot := groupBadgeState.Load(); snapshot != nil {
		return snapshot.json
	}
	return `{"labels":[],"groups":{}}`
}

// GetGroupBadges 返回副本，调用方的修改不会影响后续请求。
func GetGroupBadges(group string) []GroupLabel {
	if snapshot := groupBadgeState.Load(); snapshot != nil {
		return slices.Clone(snapshot.groups[group])
	}
	return nil
}
