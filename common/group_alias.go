package common

import (
	"slices"
	"strings"
	"sync/atomic"
)

// GroupRenameAliasOption 保存分组改名的别名表。改名先发布别名，等所有节点加载后
// 才迁移引用，所以迁移前后的配置、缓存和在途请求里的名字都能找到同一分组，
// 改名期间不需要暂停请求。
const GroupRenameAliasOption = "GroupRenameAliases"

// GroupRenameRevisionOption 是别名表版本的只读镜像，设置页保存分组配置时带上它，
// 后端据此拒绝改名前打开的旧页面。
const GroupRenameRevisionOption = "GroupRenameRevision"

const (
	// GroupRenameAnnounced 别名已发布，引用仍在旧名下，等待所有节点加载别名。
	GroupRenameAnnounced = "announced"
	// GroupRenameMigrated 引用已迁移到新名，等待所有节点切到新名后收尾。
	GroupRenameMigrated = "migrated"
	// GroupRenameSettled 已收尾。别名再保留一段时间供残留请求使用，期间旧名不能再用。
	GroupRenameSettled = "settled"
)

type GroupRenameAlias struct {
	Old               string `json:"old"`
	New               string `json:"new"`
	Phase             string `json:"phase"`
	AnnouncedRevision int64  `json:"announced_revision"`
	MigratedRevision  int64  `json:"migrated_revision,omitempty"`
	StartedAt         int64  `json:"started_at"`
	MigratedAt        int64  `json:"migrated_at,omitempty"`
	// MigratedAckedAt 是确认所有节点都切到新名的时间，收尾从这之后再等一会儿。
	MigratedAckedAt int64 `json:"migrated_acked_at,omitempty"`
	SettledAt       int64 `json:"settled_at,omitempty"`
	Users           int64 `json:"users"`
	Tokens          int64 `json:"tokens"`
	Channels        int64 `json:"channels"`
	Subscriptions   int64 `json:"subscriptions"`
	// Error 是最近一次推进失败的原因，设置页翻译后展示；推进成功后清空。
	Error *Message `json:"error,omitempty"`
}

// Active 表示改名尚未收尾。同一时间只允许一个改名在进行。
func (alias GroupRenameAlias) Active() bool {
	return alias.Phase == GroupRenameAnnounced || alias.Phase == GroupRenameMigrated
}

// LiveName 返回这次改名当前使用的名字：迁移前是旧名，迁移后是新名。
func (alias GroupRenameAlias) LiveName() string {
	if alias.Phase == GroupRenameAnnounced {
		return alias.Old
	}
	return alias.New
}

type GroupRenameAliasConfig struct {
	// Revision 在发布、迁移和收尾改动配置时递增，节点上报已加载的版本，改名据此进入下一步。
	Revision int64              `json:"revision"`
	Aliases  []GroupRenameAlias `json:"aliases"`
}

// ActiveAlias 返回进行中的改名，修改返回值会改到 config 里。
func (config *GroupRenameAliasConfig) ActiveAlias() (*GroupRenameAlias, bool) {
	for i := range config.Aliases {
		if config.Aliases[i].Active() {
			return &config.Aliases[i], true
		}
	}
	return nil, false
}

// chainOf 返回与 name 通过改名连在一起的全部名字。
func (config *GroupRenameAliasConfig) chainOf(name string) map[string]bool {
	linked := map[string]bool{name: true}
	for grown := true; grown; {
		grown = false
		for _, alias := range config.Aliases {
			if linked[alias.Old] != linked[alias.New] {
				linked[alias.Old], linked[alias.New] = true, true
				grown = true
			}
		}
	}
	return linked
}

// SameChain 表示两个名字通过改名连在一起，指向同一分组。
func (config *GroupRenameAliasConfig) SameChain(a, b string) bool {
	return config.chainOf(a)[b]
}

// LiveNameOf 返回 name 所在改名链当前使用的名字。别名按时间顺序追加，链上最后一次改名决定结果。
func (config *GroupRenameAliasConfig) LiveNameOf(name string) string {
	chain := config.chainOf(name)
	live := name
	for _, alias := range config.Aliases {
		if chain[alias.Old] {
			live = alias.LiveName()
		}
	}
	return live
}

// ReservesName 表示 name 是别名表里已不再使用的名字。新建分组或改名到这样的名字，
// 会让别名把两个不同分组当成同一个，所以在别名删除前不能使用；改回同一链上的旧名除外。
func (config *GroupRenameAliasConfig) ReservesName(name string) bool {
	return config.LiveNameOf(name) != name
}

type groupRenameAliasSnapshot struct {
	revision int64
	// chains 记录每个名字所在改名链上的全部名字，例如 A→B→C 三个名字互为别名。
	chains map[string][]string
	// live 记录每个名字所在改名链当前使用的名字，写入数据时统一换成它。
	live              map[string]string
	active            bool
	earliestSettledAt int64
}

var groupRenameAliasState atomic.Pointer[groupRenameAliasSnapshot]

func ParseGroupRenameAliases(raw string) (*GroupRenameAliasConfig, error) {
	config := &GroupRenameAliasConfig{Aliases: []GroupRenameAlias{}}
	if strings.TrimSpace(raw) == "" {
		return config, nil
	}
	if err := UnmarshalJsonStr(raw, config); err != nil || config.Revision < 0 || len(config.Aliases) > 1000 {
		return nil, NewMessage("Invalid group settings")
	}
	if config.Aliases == nil {
		config.Aliases = []GroupRenameAlias{}
	}
	active := 0
	for _, alias := range config.Aliases {
		if alias.Old == "" || alias.New == "" || alias.Old == alias.New {
			return nil, NewMessage("Invalid group settings")
		}
		switch alias.Phase {
		case GroupRenameAnnounced, GroupRenameMigrated:
			active++
		case GroupRenameSettled:
		default:
			return nil, NewMessage("Invalid group settings")
		}
	}
	if active > 1 {
		return nil, NewMessage("Invalid group settings")
	}
	return config, nil
}

// UpdateGroupRenameAliases 整体替换别名快照，读取方不会看到修改到一半的表。
func UpdateGroupRenameAliases(raw string) error {
	config, err := ParseGroupRenameAliases(raw)
	if err != nil {
		return err
	}
	parent := make(map[string]string)
	find := func(name string) string {
		for parent[name] != name {
			name = parent[name]
		}
		return name
	}
	snapshot := &groupRenameAliasSnapshot{revision: config.Revision}
	for _, alias := range config.Aliases {
		for _, name := range []string{alias.Old, alias.New} {
			if _, exists := parent[name]; !exists {
				parent[name] = name
			}
		}
		if oldRoot, newRoot := find(alias.Old), find(alias.New); oldRoot != newRoot {
			parent[oldRoot] = newRoot
		}
		if alias.Active() {
			snapshot.active = true
		} else if snapshot.earliestSettledAt == 0 || alias.SettledAt < snapshot.earliestSettledAt {
			snapshot.earliestSettledAt = alias.SettledAt
		}
	}
	members := make(map[string][]string)
	for name := range parent {
		root := find(name)
		members[root] = append(members[root], name)
	}
	// 别名按时间顺序追加，每条链最后一次改名决定当前名字。
	liveByRoot := make(map[string]string, len(members))
	for _, alias := range config.Aliases {
		liveByRoot[find(alias.Old)] = alias.LiveName()
	}
	snapshot.chains = make(map[string][]string, len(parent))
	snapshot.live = make(map[string]string, len(parent))
	for root, names := range members {
		slices.Sort(names)
		for _, name := range names {
			snapshot.chains[name] = names
			snapshot.live[name] = liveByRoot[root]
		}
	}
	groupRenameAliasState.Store(snapshot)
	return nil
}

// GroupRenameAliasRevision 返回本节点已加载的别名版本。
func GroupRenameAliasRevision() int64 {
	if snapshot := groupRenameAliasState.Load(); snapshot != nil {
		return snapshot.revision
	}
	return 0
}

// GroupRenameNeedsWork 表示本节点加载的别名表里有进行中的改名，或有过了保留期待删除的别名。
func GroupRenameNeedsWork(retentionSeconds, now int64) bool {
	snapshot := groupRenameAliasState.Load()
	if snapshot == nil {
		return false
	}
	return snapshot.active || snapshot.earliestSettledAt > 0 && now-snapshot.earliestSettledAt >= retentionSeconds
}

// GroupRenameCounterparts 返回与 group 在同一改名链上的其他名字。
func GroupRenameCounterparts(group string) []string {
	snapshot := groupRenameAliasState.Load()
	if snapshot == nil || group == "" {
		return nil
	}
	chain, exists := snapshot.chains[group]
	if !exists {
		return nil
	}
	others := make([]string, 0, len(chain)-1)
	for _, name := range chain {
		if name != group {
			others = append(others, name)
		}
	}
	return others
}

// LookupRenamedGroup 先按 group 查找，找不到时依次尝试同一改名链上的其他名字。
// 每条链同一时间只有一个名字存在于分组配置中，所以最多命中一个。
func LookupRenamedGroup[V any](group string, get func(string) (V, bool)) (V, bool) {
	if value, ok := get(group); ok {
		return value, true
	}
	for _, other := range GroupRenameCounterparts(group) {
		if value, ok := get(other); ok {
			return value, true
		}
	}
	var zero V
	return zero, false
}

// CurrentGroupName 把改名链上的任一名字换成当前使用的名字。写入用户、令牌、
// 订阅等数据时调用，旧页面或旧缓存里的名字就不会在改名后被写回去。
func CurrentGroupName(group string) string {
	snapshot := groupRenameAliasState.Load()
	if snapshot == nil {
		return group
	}
	if live, exists := snapshot.live[group]; exists {
		return live
	}
	return group
}

// CurrentGroupNames 对分组名单逐项换成当前名字，并去掉因此产生的重复项。
func CurrentGroupNames(groups []string) []string {
	result := make([]string, 0, len(groups))
	for _, group := range groups {
		if name := CurrentGroupName(group); !slices.Contains(result, name) {
			result = append(result, name)
		}
	}
	return result
}

// CurrentGroupList 对渠道的逗号分隔分组列表逐项换成当前名字。没有需要替换的名字时
// 原样返回；替换后出现重复则去掉重复项。
func CurrentGroupList(groups string) string {
	items := strings.Split(groups, ",")
	replaced := false
	for i, item := range items {
		if live := CurrentGroupName(strings.TrimSpace(item)); live != strings.TrimSpace(item) {
			items[i] = live
			replaced = true
		}
	}
	if !replaced {
		return groups
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		if !slices.Contains(result, item) {
			result = append(result, item)
		}
	}
	return strings.Join(result, ",")
}
