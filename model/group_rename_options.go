package model

import (
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// GroupRenameOptionKeys 包含以本地分组名作为引用的配置，改名时一起迁移，
// 保存这些配置时也要校验改名版本。
var GroupRenameOptionKeys = []string{
	"GroupRatio",
	"group_ratio_setting.group_ratio",
	"GroupGroupRatio",
	"group_ratio_setting.group_group_ratio",
	"group_ratio_setting.group_special_usable_group",
	"UserUsableGroups",
	"TopupGroupRatio",
	"AutoGroups",
	"AffiliateRebateGroups",
	"GroupPlatformMap",
	common.GroupBadgeConfigOption,
	"ModelRequestRateLimitGroup",
	"intelligence_check_setting.targets",
}

// groupRatioOptionAliases 是同一份配置的两个键，迁移时必须写成一致，否则重启后可能恢复旧名。
var groupRatioOptionAliases = [][2]string{
	{"GroupRatio", "group_ratio_setting.group_ratio"},
	{"GroupGroupRatio", "group_ratio_setting.group_group_ratio"},
}

// loadGroupRenameOptionValues 返回分组配置的当前值：以数据库为准，没保存过的用内存默认值。
// 两个别名键在历史数据里不一致时以旧键为准，迁移会把两者写成一致。
func loadGroupRenameOptionValues(tx *gorm.DB) (map[string]string, error) {
	values := make(map[string]string, len(GroupRenameOptionKeys))
	common.OptionMapRWMutex.RLock()
	for _, key := range GroupRenameOptionKeys {
		if value, ok := common.OptionMap[key]; ok {
			values[key] = value
		}
	}
	common.OptionMapRWMutex.RUnlock()
	var stored []Option
	if err := tx.Where(map[string]any{"key": GroupRenameOptionKeys}).Find(&stored).Error; err != nil {
		return nil, err
	}
	persisted := make(map[string]bool, len(stored))
	for _, option := range stored {
		values[option.Key] = option.Value
		persisted[option.Key] = true
	}
	for _, pair := range groupRatioOptionAliases {
		if persisted[pair[0]] || !persisted[pair[1]] {
			values[pair[1]] = values[pair[0]]
		} else {
			values[pair[0]] = values[pair[1]]
		}
	}
	return values, nil
}

// renameGroupInOptions 把配置里对 oldName 的引用改成 newName，只返回值有变化的配置。
// 两个名字同时出现时由 keepNew 决定保留哪一份：正式迁移保留旧名的值（新名条目是迁移前
// 误加的），收尾时保留新名的值（旧名条目是迁移期间的过期写入）。conflict 报告是否遇到过。
func renameGroupInOptions(current map[string]string, oldName, newName string, keepNew bool) (changed map[string]string, conflict bool, err error) {
	changed = make(map[string]string)
	for _, key := range GroupRenameOptionKeys {
		raw := current[key]
		if strings.TrimSpace(raw) == "" {
			continue
		}
		invalid := common.NewMessage("The group setting {{key}} is invalid; fix it before renaming", map[string]any{"key": key})
		var encoded any
		keyChanged, keyConflict := false, false
		switch key {
		case "AffiliateRebateGroups":
			names := make([]string, 0)
			for entry := range strings.SplitSeq(raw, ",") {
				if name := strings.TrimSpace(entry); name != "" {
					names = append(names, name)
				}
			}
			var renamed []string
			renamed, keyChanged, keyConflict = renameGroupInNames(names, oldName, newName)
			if keyChanged {
				changed[key] = strings.Join(renamed, ",")
			}
			conflict = conflict || keyConflict
			continue
		case "AutoGroups":
			var names []string
			if common.UnmarshalJsonStr(raw, &names) != nil {
				return nil, false, invalid
			}
			names, keyChanged, keyConflict = renameGroupInNames(names, oldName, newName)
			encoded = names
		case "intelligence_check_setting.targets":
			var targets []map[string]common.RawMessage
			if common.UnmarshalJsonStr(raw, &targets) != nil {
				return nil, false, invalid
			}
			oldIndex, newIndex := -1, -1
			for i, target := range targets {
				var name string
				if common.Unmarshal(target["group"], &name) != nil {
					return nil, false, invalid
				}
				switch name {
				case oldName:
					oldIndex = i
				case newName:
					newIndex = i
				}
			}
			if oldIndex >= 0 {
				renamed, err := common.Marshal(newName)
				if err != nil {
					return nil, false, err
				}
				targets[oldIndex]["group"] = renamed
				keyChanged = true
				if newIndex >= 0 {
					keyConflict = true
					drop := newIndex
					if keepNew {
						drop = oldIndex
					}
					targets = slices.Delete(targets, drop, drop+1)
				}
			}
			encoded = targets
		case common.GroupBadgeConfigOption:
			var config map[string]common.RawMessage
			var assignments map[string]common.RawMessage
			if common.UnmarshalJsonStr(raw, &config) != nil || common.Unmarshal(config["groups"], &assignments) != nil {
				return nil, false, invalid
			}
			keyChanged, keyConflict = renameGroupKey(assignments, oldName, newName, keepNew)
			if keyChanged {
				groups, err := common.Marshal(assignments)
				if err != nil {
					return nil, false, err
				}
				config["groups"] = groups
			}
			encoded = config
		case "GroupGroupRatio", "group_ratio_setting.group_group_ratio", "group_ratio_setting.group_special_usable_group":
			var rules map[string]map[string]common.RawMessage
			if common.UnmarshalJsonStr(raw, &rules) != nil {
				return nil, false, invalid
			}
			// 特殊可用分组的内层键可能带 "+:" 或 "-:" 前缀。
			prefixes := []string{""}
			if key == "group_ratio_setting.group_special_usable_group" {
				prefixes = []string{"", "+:", "-:"}
			}
			for _, inner := range rules {
				for _, prefix := range prefixes {
					innerChanged, innerConflict := renameGroupKey(inner, prefix+oldName, prefix+newName, keepNew)
					keyChanged = keyChanged || innerChanged
					keyConflict = keyConflict || innerConflict
				}
			}
			outerChanged, outerConflict := renameGroupKey(rules, oldName, newName, keepNew)
			keyChanged = keyChanged || outerChanged
			keyConflict = keyConflict || outerConflict
			encoded = rules
		default:
			var entries map[string]common.RawMessage
			if common.UnmarshalJsonStr(raw, &entries) != nil {
				return nil, false, invalid
			}
			keyChanged, keyConflict = renameGroupKey(entries, oldName, newName, keepNew)
			encoded = entries
		}
		conflict = conflict || keyConflict
		if !keyChanged {
			continue
		}
		value, err := common.Marshal(encoded)
		if err != nil {
			return nil, false, err
		}
		changed[key] = string(value)
	}
	for _, pair := range groupRatioOptionAliases {
		if value, ok := changed[pair[0]]; ok {
			changed[pair[1]] = value
		} else if value, ok := changed[pair[1]]; ok {
			changed[pair[0]] = value
		}
	}
	return changed, conflict, nil
}

// renameGroupKey 把 entries 里 oldName 的条目移到 newName 下。两个名字同时存在时，
// keepNew 为 true 保留新名原有的值，否则用旧名的值覆盖。
func renameGroupKey[V any](entries map[string]V, oldName, newName string, keepNew bool) (changed, conflict bool) {
	value, exists := entries[oldName]
	if !exists {
		return false, false
	}
	delete(entries, oldName)
	if _, taken := entries[newName]; taken {
		if !keepNew {
			entries[newName] = value
		}
		return true, true
	}
	entries[newName] = value
	return true, false
}

// renameGroupInNames 把名单里的 oldName 换成 newName 并去掉因此产生的重复项。
func renameGroupInNames(names []string, oldName, newName string) (renamed []string, changed, conflict bool) {
	conflict = slices.Contains(names, oldName) && slices.Contains(names, newName)
	renamed = make([]string, 0, len(names))
	for _, name := range names {
		if name == oldName {
			name = newName
			changed = true
		}
		if !slices.Contains(renamed, name) {
			renamed = append(renamed, name)
		}
	}
	return renamed, changed, conflict
}

// renameGroupInChannelList 把渠道逗号分隔分组列表里的 oldName 换成 newName 并去重。
func renameGroupInChannelList(groups, oldName, newName string) (string, bool) {
	items := strings.Split(groups, ",")
	changed := false
	for i, item := range items {
		if strings.TrimSpace(item) == oldName {
			items[i] = newName
			changed = true
		}
	}
	if !changed {
		return groups, false
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		if !slices.ContainsFunc(result, func(existing string) bool {
			return strings.TrimSpace(existing) == strings.TrimSpace(item)
		}) {
			result = append(result, item)
		}
	}
	return strings.Join(result, ","), true
}
