package service

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/bytedance/gopkg/util/gopool"
)

// UpstreamRateGuardReason 是倍率守护停用渠道时写入的状态原因，也是前端翻译的键。
// 恢复时只认这个原因，管理员手动禁用或请求失败自动禁用的渠道都不会被它启用。
const UpstreamRateGuardReason = "Upstream rate is higher than the group ratio"

// upstreamRateGuardBatch 是每次读取上游倍率视图的渠道数，与前端分批一致。
const upstreamRateGuardBatch = 200

type upstreamRateGuardSetting struct {
	Enabled bool `json:"enabled"`
}

func loadUpstreamRateGuardSetting(ctx context.Context) (upstreamRateGuardSetting, error) {
	setting := upstreamRateGuardSetting{}
	raw, err := model.ReadUpstreamRatesState(ctx, "guard")
	if err == nil && raw != "" {
		err = common.UnmarshalJsonStr(raw, &setting)
	}
	return setting, err
}

// GetUpstreamRateGuardEnabled 返回倍率守护是否开启，默认关闭。
func GetUpstreamRateGuardEnabled(ctx context.Context) (bool, error) {
	setting, err := loadUpstreamRateGuardSetting(ctx)
	return setting.Enabled, err
}

// SetUpstreamRateGuardEnabled 开关倍率守护。开启后立即检查一次；关闭时恢复所有由守护停用的渠道，
// 避免它们在功能关闭后一直停着没人管。手动禁用和请求失败自动禁用的渠道不受影响。
func SetUpstreamRateGuardEnabled(ctx context.Context, enabled bool) error {
	err := model.MutateUpstreamRatesState(ctx, "guard", func(string) (string, error) {
		encoded, err := common.Marshal(upstreamRateGuardSetting{Enabled: enabled})
		return string(encoded), err
	})
	if err != nil {
		return err
	}
	// 检查要读取全部渠道的上游倍率，放到后台执行，不让保存请求等待。
	gopool.Go(func() {
		run := releaseUpstreamRateGuard
		if enabled {
			run = applyUpstreamRateGuard
		}
		if err := run(context.Background()); err != nil {
			common.SysError(common.LogText("upstream rate guard failed: %v", err))
		}
	})
	return nil
}

// upstreamRateGuardVerdict 判断一条渠道当前是否亏损。trusted 为 false 表示数据不足以下结论，
// 此时既不停用也不恢复，保持原状。
func upstreamRateGuardVerdict(channel *model.Channel, view UpstreamRateView, groupRatios map[string]float64) (losing bool, trusted bool, detail string) {
	var upstream float64
	matched := 0
	for _, key := range view.Keys {
		if !key.Enabled {
			continue
		}
		// 只用当前快照里确定匹配的值，历史回退、冲突、未同步都不作数。
		if key.Status != "matched" || key.Ratio == nil {
			return false, false, ""
		}
		matched++
		upstream = max(upstream, *key.Ratio)
	}
	if matched == 0 {
		return false, false, ""
	}
	// 渠道挂在多个分组下时，以最便宜的分组为准：上游价高于任一分组售价就停用整条渠道。
	lowestGroup, lowestRatio := "", 0.0
	for _, group := range strings.Split(channel.Group, ",") {
		group = strings.TrimSpace(group)
		if group == "" {
			continue
		}
		ratio, ok := groupRatios[common.CurrentGroupName(group)]
		if !ok {
			continue
		}
		if lowestGroup == "" || ratio < lowestRatio {
			lowestGroup, lowestRatio = group, ratio
		}
	}
	if lowestGroup == "" {
		return false, false, ""
	}
	detail = fmt.Sprintf("%s: %s > %s", lowestGroup, strconv.FormatFloat(upstream, 'f', -1, 64), strconv.FormatFloat(lowestRatio, 'f', -1, 64))
	return upstream > lowestRatio, true, detail
}

func upstreamRateGuardDisabled(channel *model.Channel) bool {
	if channel.Status != common.ChannelStatusAutoDisabled {
		return false
	}
	reason, _ := channel.GetOtherInfo()["status_reason"].(string)
	return reason == UpstreamRateGuardReason
}

// applyUpstreamRateGuard 在上游倍率同步后检查全部已启用渠道和由守护停用的渠道。
func applyUpstreamRateGuard(ctx context.Context) error {
	enabled, err := GetUpstreamRateGuardEnabled(ctx)
	if err != nil || !enabled {
		return err
	}
	var channels []*model.Channel
	if err := model.DB.WithContext(ctx).
		Select("id", "name", "group", "status", "other_info", "channel_info").
		Where("status IN ?", []int{common.ChannelStatusEnabled, common.ChannelStatusAutoDisabled}).
		Find(&channels).Error; err != nil {
		return err
	}
	candidates := make([]*model.Channel, 0, len(channels))
	for _, channel := range channels {
		if channel.Status == common.ChannelStatusEnabled || upstreamRateGuardDisabled(channel) {
			candidates = append(candidates, channel)
		}
	}
	groupRatios := ratio_setting.GetGroupRatioCopy()
	// 自动禁用不会立即通知其他节点；这里是按价格停用，一轮结束后统一通知一次，
	// 其他节点几秒内重载渠道缓存，不必等定时同步。
	changed := false
	defer func() {
		if changed {
			model.BumpSyncTopic(model.SyncTopicChannels)
		}
	}()
	for start := 0; start < len(candidates); start += upstreamRateGuardBatch {
		batch := candidates[start:min(start+upstreamRateGuardBatch, len(candidates))]
		ids := make([]int, len(batch))
		for i, channel := range batch {
			ids[i] = channel.Id
		}
		views, err := GetUpstreamRates(ctx, ids)
		if err != nil {
			return err
		}
		byID := make(map[int]UpstreamRateView, len(views))
		for _, view := range views {
			byID[view.ChannelID] = view
		}
		for _, channel := range batch {
			view, ok := byID[channel.Id]
			if !ok {
				continue
			}
			losing, trusted, detail := upstreamRateGuardVerdict(channel, view, groupRatios)
			if !trusted {
				continue
			}
			switch {
			case losing && channel.Status == common.ChannelStatusEnabled:
				changed = disableChannelForUpstreamRate(channel, detail) || changed
			case !losing && upstreamRateGuardDisabled(channel):
				changed = enableChannelAfterUpstreamRate(channel) || changed
			}
		}
	}
	return nil
}

// releaseUpstreamRateGuard 关闭守护时恢复它停用的渠道。
func releaseUpstreamRateGuard(ctx context.Context) error {
	var channels []*model.Channel
	if err := model.DB.WithContext(ctx).
		Select("id", "name", "status", "other_info").
		Where("status = ?", common.ChannelStatusAutoDisabled).
		Find(&channels).Error; err != nil {
		return err
	}
	changed := false
	for _, channel := range channels {
		if upstreamRateGuardDisabled(channel) {
			changed = enableChannelAfterUpstreamRate(channel) || changed
		}
	}
	if changed {
		model.BumpSyncTopic(model.SyncTopicChannels)
	}
	return nil
}

// disableChannelForUpstreamRate 返回渠道状态是否确实改变。
func disableChannelForUpstreamRate(channel *model.Channel, detail string) bool {
	if !model.UpdateChannelStatus(channel.Id, "", common.ChannelStatusAutoDisabled, UpstreamRateGuardReason) {
		return false
	}
	common.SysLog(common.LogText("channel %q (#%d) disabled because its upstream rate is higher than its group ratio: %s", channel.Name, channel.Id, detail))
	CloseActiveWebSocketsForChannel(channel.Id, ChannelDisabledCloseReason)
	params := map[string]any{"Name": channel.Name, "Id": channel.Id, "Reason": UpstreamRateGuardReason + " (" + detail + ")"}
	NotifyChannelWatchers(formatNotifyType(channel.Id, common.ChannelStatusAutoDisabled), func(lang string) (string, string) {
		return i18n.Translate(lang, i18n.MsgChannelNotifyDisabledSubject, params), i18n.Translate(lang, i18n.MsgChannelNotifyDisabledContent, params)
	})
	return true
}

// enableChannelAfterUpstreamRate 返回渠道状态是否确实改变。
func enableChannelAfterUpstreamRate(channel *model.Channel) bool {
	if !model.UpdateChannelStatus(channel.Id, "", common.ChannelStatusEnabled, "") {
		return false
	}
	common.SysLog(common.LogText("channel %q (#%d) enabled because its upstream rate is no longer higher than its group ratio", channel.Name, channel.Id))
	params := map[string]any{"Name": channel.Name, "Id": channel.Id}
	NotifyChannelWatchers(formatNotifyType(channel.Id, common.ChannelStatusEnabled), func(lang string) (string, string) {
		return i18n.Translate(lang, i18n.MsgChannelNotifyEnabledSubject, params), i18n.Translate(lang, i18n.MsgChannelNotifyEnabledContent, params)
	})
	return true
}
