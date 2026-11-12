package model

import (
	"errors"
	"maps"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 分组改名分三步推进，全程不暂停请求：
//  1. 发布别名：新旧两个名字在所有查找里指向同一分组，引用仍在旧名下。
//  2. 所有在线节点加载别名后，在一个事务里把引用迁移到新名。
//  3. 所有节点加载迁移结果、旧缓存过期后，再迁移一次期间按旧名写入的数据，然后收尾。
// 收尾后别名再保留 GroupRenameRetentionSeconds，供残留的旧名请求和长任务结算使用。

// GroupRenameRetentionSeconds 要长于异步任务的超时时间（默认 3 天），任务结算时别名仍在。
const GroupRenameRetentionSeconds int64 = 7 * 24 * 60 * 60

// groupRenameSettleDelaySeconds 是所有节点切到新名后到收尾的等待时间，留给确认前已开始的请求写完。
// 确认后所有写入都会换成新名；缓存里残留的旧名在别名保留期内仍能找到分组，不必等缓存过期。
func groupRenameSettleDelaySeconds() int64 {
	return 10
}

type GroupRenameStatus struct {
	// Alias 是进行中的改名，没有时为空。
	Alias *common.GroupRenameAlias `json:"alias"`
	// Waiting 是还没加载到当前步骤的在线节点。
	Waiting []string `json:"waiting"`
	// SettleAt 是预计收尾的时间。
	SettleAt int64 `json:"settle_at,omitempty"`
}

type groupReferenceCounts struct {
	Users, Tokens, Channels, Subscriptions int64
	PlanIDs                                []int
}

// groupReferenceColumns 是以分组名作为值的数据列。历史日志、已完成任务等记录保持原样。
var groupReferenceColumns = []struct {
	model   any
	columns []string
}{
	{&User{}, []string{"group"}},
	{&Token{}, []string{"group"}},
	{&Ability{}, []string{"group"}},
	{&SubscriptionPlan{}, []string{"upgrade_group", "downgrade_group"}},
	{&UserSubscription{}, []string{"upgrade_group", "downgrade_group", "prev_user_group"}},
}

var finishedTaskStatuses = []string{TaskStatusSuccess, TaskStatusFailure}

// StartGroupRename 发布改名别名，后续步骤由系统任务推进。
func StartGroupRename(oldName, newName string) (*common.GroupRenameAlias, error) {
	for _, name := range []string{oldName, newName} {
		if name == "" || name != strings.TrimSpace(name) || name == "default" || name == "auto" ||
			strings.HasPrefix(name, "+:") || strings.HasPrefix(name, "-:") || strings.ContainsRune(name, ',') ||
			!utf8.ValidString(name) || utf8.RuneCountInString(name) > 64 || strings.ContainsFunc(name, unicode.IsControl) {
			return nil, common.NewMessage("Group names must contain 1 to 64 characters without commas, control characters or surrounding spaces; default and auto cannot be renamed")
		}
	}
	// 任务表的分组列是 varchar(50)。
	if utf8.RuneCountInString(newName) > 50 {
		return nil, common.NewMessage("The new group name must not exceed 50 characters to preserve task compatibility")
	}
	if oldName == newName {
		return nil, common.NewMessage("The new group name must differ from the current name")
	}
	var alias common.GroupRenameAlias
	var published map[string]string
	err := DB.Transaction(func(tx *gorm.DB) error {
		config, err := lockGroupRenameAliases(tx)
		if err != nil {
			return err
		}
		if _, active := config.ActiveAlias(); active {
			return common.NewMessage("Another group rename is in progress; wait for it to finish")
		}
		if config.ReservesName(oldName) {
			return common.NewMessage("The group {{group}} does not exist", map[string]any{"group": oldName})
		}
		// 改回同一分组用过的名字不会合并两个分组，可以直接改。
		if config.ReservesName(newName) && !config.SameChain(oldName, newName) {
			return common.NewMessage("The group name {{group}} was renamed recently and cannot be used again yet", map[string]any{"group": newName})
		}
		values, err := loadGroupRenameOptionValues(tx)
		if err != nil {
			return err
		}
		var ratios map[string]common.RawMessage
		if common.UnmarshalJsonStr(values["GroupRatio"], &ratios) != nil {
			return common.NewMessage("The group setting {{key}} is invalid; fix it before renaming", map[string]any{"key": "GroupRatio"})
		}
		if _, exists := ratios[oldName]; !exists {
			return common.NewMessage("The group {{group}} does not exist", map[string]any{"group": oldName})
		}
		// 新名不能出现在任何配置或数据里，否则改名会把两个分组合并成一个。
		referenced, err := groupReferencedInOptions(values, newName)
		if err != nil {
			return err
		}
		if !referenced {
			referenced, err = groupReferencedInDatabase(tx, newName)
			if err != nil {
				return err
			}
		}
		if referenced {
			return common.NewMessage("The new group name is already referenced; choose another name")
		}
		if _, err := renameChannelGroups(tx, oldName, newName, false); err != nil {
			return err
		}
		config.Revision++
		alias = common.GroupRenameAlias{
			Old: oldName, New: newName, Phase: common.GroupRenameAnnounced,
			AnnouncedRevision: config.Revision, StartedAt: common.GetTimestamp(),
		}
		config.Aliases = append(config.Aliases, alias)
		published, err = saveGroupRenameAliases(tx, config)
		return err
	})
	if err != nil {
		return nil, err
	}
	_ = publishOptions(published)
	return &alias, nil
}

// CancelGroupRename 取消还没开始迁移的改名。迁移开始后只能等它完成。
func CancelGroupRename() (*common.GroupRenameAlias, error) {
	var canceled common.GroupRenameAlias
	var published map[string]string
	err := DB.Transaction(func(tx *gorm.DB) error {
		config, err := lockGroupRenameAliases(tx)
		if err != nil {
			return err
		}
		alias, active := config.ActiveAlias()
		if !active {
			return common.NewMessage("No group rename is in progress")
		}
		if alias.Phase != common.GroupRenameAnnounced {
			return common.NewMessage("Only a rename that has not started migrating can be canceled")
		}
		canceled = *alias
		config.Aliases = slices.DeleteFunc(config.Aliases, func(alias common.GroupRenameAlias) bool { return alias.Active() })
		config.Revision++
		published, err = saveGroupRenameAliases(tx, config)
		return err
	})
	if err != nil {
		return nil, err
	}
	_ = publishOptions(published)
	return &canceled, nil
}

// GetGroupRenameStatus 从数据库读取进行中的改名，设置页据此展示进度。
func GetGroupRenameStatus() (*GroupRenameStatus, error) {
	config, err := readGroupRenameAliases()
	if err != nil {
		return nil, err
	}
	status := &GroupRenameStatus{Waiting: []string{}}
	alias, active := config.ActiveAlias()
	if !active {
		return status, nil
	}
	status.Alias = alias
	switch {
	case alias.Phase == common.GroupRenameAnnounced:
		status.Waiting, err = groupRenameWaitingInstances(alias.AnnouncedRevision)
	case alias.MigratedAckedAt == 0:
		status.Waiting, err = groupRenameWaitingInstances(alias.MigratedRevision)
	default:
		status.SettleAt = alias.MigratedAckedAt + groupRenameSettleDelaySeconds()
	}
	return status, err
}

// AdvanceGroupRename 推进进行中的改名，没有时清理过了保留期的别名。
func AdvanceGroupRename() error {
	config, err := readGroupRenameAliases()
	if err != nil {
		return err
	}
	alias, active := config.ActiveAlias()
	if !active {
		return removeExpiredGroupRenameAliases(config)
	}
	if alias.Phase == common.GroupRenameAnnounced {
		waiting, err := groupRenameWaitingInstances(alias.AnnouncedRevision)
		if err != nil || len(waiting) > 0 {
			return err
		}
		return recordGroupRenameError(*alias, migrateGroupRename(*alias, false))
	}
	if alias.MigratedAckedAt == 0 {
		waiting, err := groupRenameWaitingInstances(alias.MigratedRevision)
		if err != nil || len(waiting) > 0 {
			return err
		}
		now := common.GetTimestamp()
		return updateActiveGroupRename(*alias, func(alias *common.GroupRenameAlias) { alias.MigratedAckedAt = now })
	}
	if common.GetTimestamp()-alias.MigratedAckedAt < groupRenameSettleDelaySeconds() {
		return nil
	}
	return recordGroupRenameError(*alias, migrateGroupRename(*alias, true))
}

// UpdateGroupOption 保存一项分组配置。改名进行中不能保存；带了版本时，改名前打开的页面会被拒绝。
func UpdateGroupOption(key, value, expectedRevision string) error {
	if err := validateOptionValue(key, value); err != nil {
		return err
	}
	values := map[string]string{key: value}
	for _, pair := range groupRatioOptionAliases {
		if key == pair[0] {
			values[pair[1]] = value
		} else if key == pair[1] {
			values[pair[0]] = value
		}
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		config, err := lockGroupRenameAliases(tx)
		if err != nil {
			return err
		}
		if _, active := config.ActiveAlias(); active {
			return common.NewMessage("A group rename is in progress; save group settings after it finishes")
		}
		if expectedRevision != "" && expectedRevision != strconv.FormatInt(config.Revision, 10) {
			return common.NewMessage("Group settings changed; reload the page before saving")
		}
		if raw, ok := values["GroupRatio"]; ok {
			if err := checkGroupRatioChanges(tx, config, raw); err != nil {
				return err
			}
		}
		return upsertOptions(tx, values)
	})
	if err != nil {
		return err
	}
	before := ratio_setting.GetGroupRatioCopy()
	if err := publishOptions(values); err != nil {
		return err
	}
	if _, ok := values["GroupRatio"]; ok {
		recordGroupRatioChanges(before, ratio_setting.GetGroupRatioCopy())
	}
	return nil
}

// checkGroupRatioChanges 拒绝删除仍被使用的分组（应该改名），也拒绝复用刚改掉的旧名。
func checkGroupRatioChanges(tx *gorm.DB, config *common.GroupRenameAliasConfig, raw string) error {
	var proposed map[string]float64
	if common.UnmarshalJsonStr(raw, &proposed) != nil {
		return common.NewMessage("Invalid group settings")
	}
	values, err := loadGroupRenameOptionValues(tx)
	if err != nil {
		return err
	}
	var current map[string]float64
	_ = common.UnmarshalJsonStr(values["GroupRatio"], &current)
	for name := range proposed {
		if _, existed := current[name]; !existed && config.ReservesName(name) {
			return common.NewMessage("The group name {{group}} was renamed recently and cannot be used again yet", map[string]any{"group": name})
		}
	}
	for name := range current {
		if _, kept := proposed[name]; kept {
			continue
		}
		used, err := groupReferencedInDatabase(tx, name)
		if err != nil {
			return err
		}
		if used {
			return common.NewMessage("This group is still in use; use Rename group instead of deleting it")
		}
	}
	return nil
}

// migrateGroupRename 迁移引用。settle 为 false 是第 2 步，为 true 是收尾的第 3 步。
func migrateGroupRename(expected common.GroupRenameAlias, settle bool) error {
	var published map[string]string
	var planIDs []int
	err := DB.Transaction(func(tx *gorm.DB) error {
		config, err := lockGroupRenameAliases(tx)
		if err != nil {
			return err
		}
		alias, active := config.ActiveAlias()
		if !active || alias.Old != expected.Old || alias.New != expected.New || alias.Phase != expected.Phase {
			return nil // 其他执行者已推进或取消
		}
		values, err := loadGroupRenameOptionValues(tx)
		if err != nil {
			return err
		}
		changed, _, err := renameGroupInOptions(values, alias.Old, alias.New, settle)
		if err != nil {
			return err
		}
		counts, err := migrateGroupReferences(tx, alias.Old, alias.New)
		if err != nil {
			return err
		}
		planIDs = counts.PlanIDs
		now := common.GetTimestamp()
		alias.Error = nil
		if settle {
			alias.Phase, alias.SettledAt = common.GroupRenameSettled, now
			if len(changed) > 0 {
				config.Revision++
			}
		} else {
			config.Revision++
			alias.Phase, alias.MigratedRevision, alias.MigratedAt = common.GroupRenameMigrated, config.Revision, now
			alias.Users, alias.Tokens, alias.Channels, alias.Subscriptions = counts.Users, counts.Tokens, counts.Channels, counts.Subscriptions
		}
		if err := upsertOptions(tx, changed); err != nil {
			return err
		}
		aliasValues, err := saveGroupRenameAliases(tx, config)
		if err != nil {
			return err
		}
		maps.Copy(changed, aliasValues)
		published = changed
		return nil
	})
	if err != nil || published == nil {
		return err
	}
	// 渠道和能力表的分组列在同一事务里改了。先登记渠道同步再登记配置同步：节点每轮一次读出
	// 全部主题的最新任务，能看到配置任务时也一定能看到渠道任务，上报改名版本前渠道缓存已重载。
	BumpSyncTopic(SyncTopicChannels)
	_ = publishOptions(published)
	for _, id := range planIDs {
		InvalidateSubscriptionPlanCache(id)
	}
	InitChannelCache()
	return nil
}

// migrateGroupReferences 把数据里对 oldName 的精确引用改成 newName。
// 余额、额度和计费快照不变；Redis 里的令牌、用户缓存不删除（其中有尚未落库的额度计数），
// 缓存过期前读到的旧名由别名兜底。
func migrateGroupReferences(tx *gorm.DB, oldName, newName string) (*groupReferenceCounts, error) {
	counts := &groupReferenceCounts{}
	result := tx.Unscoped().Model(&User{}).Where(groupExactMatch("group", oldName)).UpdateColumn("group", newName)
	if result.Error != nil {
		return nil, result.Error
	}
	counts.Users = result.RowsAffected

	var tokenIDs []int
	if err := tx.Unscoped().Model(&Token{}).Where(groupExactMatch("group", oldName)).Pluck("id", &tokenIDs).Error; err != nil {
		return nil, err
	}
	if err := tx.Unscoped().Model(&Token{}).Where(groupExactMatch("group", oldName)).UpdateColumn("group", newName).Error; err != nil {
		return nil, err
	}
	var autoTokens []Token
	if err := tx.Unscoped().Select("id", "auto_groups").Where("auto_groups <> ?", "").Find(&autoTokens).Error; err != nil {
		return nil, err
	}
	for _, token := range autoTokens {
		groups, err := token.GetAutoGroups()
		if err != nil {
			continue // 无法解析的旧数据保持原样，鉴权时同样按无效处理
		}
		renamed, changed, _ := renameGroupInNames(groups, oldName, newName)
		if !changed {
			continue
		}
		if err := token.SetAutoGroups(renamed); err != nil {
			return nil, err
		}
		if err := tx.Unscoped().Model(&Token{}).Where("id = ?", token.Id).UpdateColumn("auto_groups", token.AutoGroups).Error; err != nil {
			return nil, err
		}
		if !slices.Contains(tokenIDs, token.Id) {
			tokenIDs = append(tokenIDs, token.Id)
		}
	}
	counts.Tokens = int64(len(tokenIDs))

	channels, err := renameChannelGroups(tx, oldName, newName, true)
	if err != nil {
		return nil, err
	}
	counts.Channels = channels
	// 能力表以分组、模型、渠道为主键。新名下已有同一模型和渠道时，旧名那条是重复的，先删掉。
	var existing []Ability
	if err := tx.Select("model", "channel_id").Where(groupExactMatch("group", newName)).Find(&existing).Error; err != nil {
		return nil, err
	}
	for _, ability := range existing {
		if err := tx.Where(groupExactMatch("group", oldName)).Where("model = ? AND channel_id = ?", ability.Model, ability.ChannelId).Delete(&Ability{}).Error; err != nil {
			return nil, err
		}
	}
	if err := tx.Model(&Ability{}).Where(groupExactMatch("group", oldName)).UpdateColumn("group", newName).Error; err != nil {
		return nil, err
	}

	if err := tx.Model(&SubscriptionPlan{}).Where(clause.Or(groupExactMatch("upgrade_group", oldName), groupExactMatch("downgrade_group", oldName))).Pluck("id", &counts.PlanIDs).Error; err != nil {
		return nil, err
	}
	if err := tx.Model(&UserSubscription{}).Where(clause.Or(groupExactMatch("upgrade_group", oldName), groupExactMatch("downgrade_group", oldName), groupExactMatch("prev_user_group", oldName))).Count(&counts.Subscriptions).Error; err != nil {
		return nil, err
	}
	for _, reference := range groupReferenceColumns[3:] {
		for _, column := range reference.columns {
			if err := tx.Model(reference.model).Where(groupExactMatch(column, oldName)).UpdateColumn(column, newName).Error; err != nil {
				return nil, err
			}
		}
	}

	// 未完成的任务结算时按任务记录的分组取倍率，改名后同样要找得到。
	if err := tx.Model(&Task{}).Where(groupExactMatch("group", oldName)).Where("(status NOT IN ? OR status IS NULL)", finishedTaskStatuses).UpdateColumn("group", newName).Error; err != nil {
		return nil, err
	}
	return counts, nil
}

// renameChannelGroups 把渠道分组列表里的 oldName 换成 newName，返回涉及的渠道数。
// apply 为 false 时只检查改名后是否超过列长度，不写入。
func renameChannelGroups(tx *gorm.DB, oldName, newName string, apply bool) (int64, error) {
	var channels []Channel
	if err := tx.Select("id", "group").Find(&channels).Error; err != nil {
		return 0, err
	}
	var count int64
	for _, channel := range channels {
		renamed, changed := renameGroupInChannelList(channel.Group, oldName, newName)
		if !changed {
			continue
		}
		if utf8.RuneCountInString(renamed) > 64 {
			return 0, common.NewMessage("Renaming would exceed a channel's 64-character group list limit")
		}
		if apply {
			if err := tx.Model(&Channel{}).Where("id = ?", channel.Id).UpdateColumn("group", renamed).Error; err != nil {
				return 0, err
			}
		}
		count++
	}
	return count, nil
}

// groupReferencedInDatabase 判断数据里是否还有对 name 的引用。
func groupReferencedInDatabase(tx *gorm.DB, name string) (bool, error) {
	for _, reference := range groupReferenceColumns {
		conditions := make([]clause.Expression, 0, len(reference.columns))
		for _, column := range reference.columns {
			conditions = append(conditions, groupExactMatch(column, name))
		}
		var count int64
		if err := tx.Unscoped().Model(reference.model).Where(clause.Or(conditions...)).Count(&count).Error; err != nil {
			return false, err
		}
		if count > 0 {
			return true, nil
		}
	}
	var unfinished int64
	if err := tx.Model(&Task{}).Where(groupExactMatch("group", name)).Where("(status NOT IN ? OR status IS NULL)", finishedTaskStatuses).Count(&unfinished).Error; err != nil {
		return false, err
	}
	if unfinished > 0 {
		return true, nil
	}
	var tokens []Token
	if err := tx.Unscoped().Select("id", "auto_groups").Where("auto_groups <> ?", "").Find(&tokens).Error; err != nil {
		return false, err
	}
	for _, token := range tokens {
		if groups, err := token.GetAutoGroups(); err == nil && slices.Contains(groups, name) {
			return true, nil
		}
	}
	var channels []Channel
	if err := tx.Select("id", "group").Find(&channels).Error; err != nil {
		return false, err
	}
	for _, channel := range channels {
		for item := range strings.SplitSeq(channel.Group, ",") {
			if strings.TrimSpace(item) == name {
				return true, nil
			}
		}
	}
	return false, nil
}

// groupReferencedInOptions 借用配置改名逻辑判断配置里是否出现了 name：
// 把它改成一个不可能出现的名字，有配置发生变化就说明出现过。
func groupReferencedInOptions(values map[string]string, name string) (bool, error) {
	changed, _, err := renameGroupInOptions(values, name, "\x00", false)
	return len(changed) > 0, err
}

// groupExactMatch 按大小写精确比较分组名。MySQL 默认排序规则不区分大小写，
// 而分组配置的键区分大小写，所以要按二进制比较，避免把 VIP 和 vip 当成同一分组。
func groupExactMatch(column, name string) clause.Expression {
	if common.UsingMainDatabase(common.DatabaseTypeMySQL) {
		return clause.Expr{SQL: "BINARY ? = BINARY ?", Vars: []any{clause.Column{Name: column}, name}}
	}
	return clause.Eq{Column: clause.Column{Name: column}, Value: name}
}

// groupRenameWaitingInstances 返回仍在线、但还没加载到 revision 的节点。
// 超过 SystemInstanceStaleAfterSeconds 没上报的节点视为已下线，重启时会从数据库加载最新配置。
func groupRenameWaitingInstances(revision int64) ([]string, error) {
	var instances []SystemInstance
	if err := DB.Where("last_seen_at >= ?", common.GetTimestamp()-SystemInstanceStaleAfterSeconds).Find(&instances).Error; err != nil {
		return nil, err
	}
	if len(instances) == 0 {
		// 没有任何节点上报时无法确认，先等待。
		return []string{common.NodeName}, nil
	}
	waiting := make([]string, 0)
	for _, instance := range instances {
		var info struct {
			GroupRenameRevision int64 `json:"group_rename_revision"`
		}
		if common.UnmarshalJsonStr(instance.Info, &info) != nil || info.GroupRenameRevision < revision {
			waiting = append(waiting, instance.NodeName)
		}
	}
	slices.Sort(waiting)
	return waiting, nil
}

// recordGroupRenameError 把推进失败的原因记到别名上展示给管理员，改名停在当前步骤，
// 下一轮会重试；还没开始迁移的改名也可以取消。
func recordGroupRenameError(expected common.GroupRenameAlias, cause error) error {
	if cause == nil {
		return nil
	}
	// 业务原因（例如渠道分组列表超长）原样展示，等管理员处理，不算任务失败；
	// 其他错误只展示通用原因，细节记在任务和日志里。
	var reason *common.Message
	business := errors.As(cause, &reason)
	if !business {
		reason = common.NewMessage("Failed to rename group")
	}
	if err := updateActiveGroupRename(expected, func(alias *common.GroupRenameAlias) { alias.Error = reason }); err != nil {
		return err
	}
	if business {
		return nil
	}
	return cause
}

// updateActiveGroupRename 修改进行中的改名记录，不改变版本。改名已被推进或取消时不做任何事。
func updateActiveGroupRename(expected common.GroupRenameAlias, mutate func(*common.GroupRenameAlias)) error {
	var published map[string]string
	err := DB.Transaction(func(tx *gorm.DB) error {
		config, err := lockGroupRenameAliases(tx)
		if err != nil {
			return err
		}
		alias, active := config.ActiveAlias()
		if !active || alias.Old != expected.Old || alias.New != expected.New || alias.Phase != expected.Phase {
			return nil
		}
		mutate(alias)
		published, err = saveGroupRenameAliases(tx, config)
		return err
	})
	if err == nil && published != nil {
		_ = publishOptions(published)
	}
	return err
}

// removeExpiredGroupRenameAliases 删除过了保留期的别名。删除前把仍用不再使用的名字的
// 未完成任务改到当前名字，它们结算时才找得到倍率。
func removeExpiredGroupRenameAliases(snapshot *common.GroupRenameAliasConfig) error {
	now := common.GetTimestamp()
	expired := func(alias common.GroupRenameAlias) bool {
		return alias.Phase == common.GroupRenameSettled && now-alias.SettledAt >= GroupRenameRetentionSeconds
	}
	if !slices.ContainsFunc(snapshot.Aliases, expired) {
		return nil
	}
	var published map[string]string
	err := DB.Transaction(func(tx *gorm.DB) error {
		config, err := lockGroupRenameAliases(tx)
		if err != nil {
			return err
		}
		kept := make([]common.GroupRenameAlias, 0, len(config.Aliases))
		for _, alias := range config.Aliases {
			if !expired(alias) {
				kept = append(kept, alias)
				continue
			}
			for _, name := range []string{alias.Old, alias.New} {
				live := config.LiveNameOf(name)
				if live == name {
					continue
				}
				if err := tx.Model(&Task{}).Where(groupExactMatch("group", name)).Where("(status NOT IN ? OR status IS NULL)", finishedTaskStatuses).UpdateColumn("group", live).Error; err != nil {
					return err
				}
			}
		}
		config.Aliases = kept
		published, err = saveGroupRenameAliases(tx, config)
		return err
	})
	if err == nil && published != nil {
		_ = publishOptions(published)
	}
	return err
}

func readGroupRenameAliases() (*common.GroupRenameAliasConfig, error) {
	var option Option
	if err := DB.Where(map[string]any{"key": common.GroupRenameAliasOption}).Limit(1).Find(&option).Error; err != nil {
		return nil, err
	}
	return common.ParseGroupRenameAliases(option.Value)
}

// lockGroupRenameAliases 锁住别名配置行并读出内容。改名的每一步和分组配置的保存都先取这把锁，
// 所以它们互相串行。
func lockGroupRenameAliases(tx *gorm.DB) (*common.GroupRenameAliasConfig, error) {
	option := Option{Key: common.GroupRenameAliasOption}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&option).Error; err != nil {
		return nil, err
	}
	if err := lockForUpdate(tx).Where(map[string]any{"key": common.GroupRenameAliasOption}).First(&option).Error; err != nil {
		return nil, err
	}
	return common.ParseGroupRenameAliases(option.Value)
}

// saveGroupRenameAliases 写入别名配置和供设置页读取的版本号，返回写入的值。
func saveGroupRenameAliases(tx *gorm.DB, config *common.GroupRenameAliasConfig) (map[string]string, error) {
	raw, err := common.Marshal(config)
	if err != nil {
		return nil, err
	}
	values := map[string]string{
		common.GroupRenameAliasOption:    string(raw),
		common.GroupRenameRevisionOption: strconv.FormatInt(config.Revision, 10),
	}
	return values, upsertOptions(tx, values)
}

func upsertOptions(tx *gorm.DB, values map[string]string) error {
	for _, key := range slices.Sorted(maps.Keys(values)) {
		option := Option{Key: key, Value: values[key]}
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "key"}},
			DoUpdates: clause.AssignmentColumns([]string{"value"}),
		}).Create(&option).Error; err != nil {
			return err
		}
	}
	return nil
}

// publishOptions 在提交后更新本节点内存，再通过节点同步让其他节点几秒内重新加载配置。
// 节点加载后上报改名版本，改名据此进入下一步；同步任务丢失时由定时配置同步兜底。
func publishOptions(values map[string]string) error {
	var first error
	for _, key := range slices.Sorted(maps.Keys(values)) {
		if err := updateOptionMap(key, values[key]); err != nil {
			common.SysError(common.LogText("failed to apply group setting %s: %v", key, err))
			if first == nil {
				first = err
			}
		}
	}
	BumpSyncTopic(SyncTopicOptions)
	return first
}
