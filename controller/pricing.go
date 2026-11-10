package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

func filterPricingByUsableGroups(pricing []model.Pricing, usableGroup map[string]string) []model.Pricing {
	if len(pricing) == 0 {
		return pricing
	}
	if len(usableGroup) == 0 {
		return []model.Pricing{}
	}

	filtered := make([]model.Pricing, 0, len(pricing))
	for _, item := range pricing {
		// The pricing cache is shared by all viewers.
		groups := make([]string, 0, len(item.EnableGroup))
		for _, group := range item.EnableGroup {
			if _, ok := usableGroup[group]; ok || group == "all" {
				groups = append(groups, group)
			}
		}
		if len(groups) > 0 {
			item.EnableGroup = groups
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func GetPricing(c *gin.Context) {
	userGroup := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
	usableGroup := service.GetUserUsableGroups(userGroup)
	pricing := filterPricingByUsableGroups(model.GetPricing(), usableGroup)
	groupRatio := ratio_setting.GetGroupRatioCopy()
	for group := range groupRatio {
		if _, ok := usableGroup[group]; !ok {
			delete(groupRatio, group)
			continue
		}
		if userGroup != "" {
			if ratio, ok := ratio_setting.GetGroupGroupRatio(userGroup, group); ok {
				groupRatio[group] = ratio
			}
		}
	}
	// 只展示可用分组的近期变化；用户专属倍率会隐藏被替代的基础倍率变化。
	groupRatioChanges := map[string]model.GroupRatioChangeInfo{}
	for name, change := range model.RecentGroupRatioChanges() {
		if _, ok := groupRatio[name]; !ok {
			continue
		}
		if _, special := ratio_setting.GetGroupGroupRatio(userGroup, name); special {
			continue
		}
		groupRatioChanges[name] = change
	}
	// The platform an administrator assigned to each shown group. A group
	// without one is matched by name on the page, as in the key dialog.
	groupPlatforms := map[string]string{}
	if common.GroupPlatformMap != "" {
		assigned := map[string]string{}
		_ = common.UnmarshalJsonStr(common.GroupPlatformMap, &assigned)
		for name, platform := range assigned {
			if _, ok := usableGroup[name]; ok && platform != "" {
				groupPlatforms[name] = platform
			}
		}
	}

	groupBadges := make(map[string][]common.GroupLabel)
	for name := range usableGroup {
		if _, exists := groupRatio[name]; !exists && name != "auto" {
			continue
		}
		if badges := common.GetGroupBadges(name); len(badges) > 0 {
			groupBadges[name] = badges
		}
	}

	c.JSON(200, gin.H{
		"success":             true,
		"data":                pricing,
		"vendors":             model.GetVendors(),
		"group_ratio":         groupRatio,
		"group_ratio_changes": groupRatioChanges,
		"group_platforms":     groupPlatforms,
		"group_badges":        groupBadges,
		"usable_group":        usableGroup,
		"supported_endpoint":  model.GetSupportedEndpointMap(),
		"auto_groups":         service.GetUserAutoGroup(userGroup),
		"pricing_version":     "a42d372ccf0b5dd13ecf71203521f9d2",
	})
}

func ResetModelRatio(c *gin.Context) {
	defaultStr := ratio_setting.DefaultModelRatio2JSONString()
	err := model.UpdateOption("ModelRatio", defaultStr)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	err = ratio_setting.UpdateModelRatioByJSONString(defaultStr)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccessT(c, "Model ratios reset", nil)
}
