package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

// GetGroups 返回全部分组名。带 with_ratio=true 时返回分组名到分组倍率的映射，渠道列表据此在分组旁显示倍率。
func GetGroups(c *gin.Context) {
	ratios := ratio_setting.GetGroupRatioCopy()
	if c.Query("with_ratio") == "true" {
		common.ApiSuccess(c, ratios)
		return
	}
	groupNames := make([]string, 0, len(ratios))
	for groupName := range ratios {
		groupNames = append(groupNames, groupName)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    groupNames,
	})
}

func GetUserGroups(c *gin.Context) {
	usableGroups := make(map[string]map[string]any)
	userGroup := ""
	userId := c.GetInt("id")
	userGroup, _ = model.GetUserGroup(userId, false)
	userUsableGroups := service.GetUserUsableGroups(userGroup)
	// GroupPlatformMap is admin-validated JSON; a parse failure only drops the
	// optional platform hint, so the frontend falls back to name matching.
	groupPlatforms := make(map[string]string)
	if common.GroupPlatformMap != "" {
		_ = common.UnmarshalJsonStr(common.GroupPlatformMap, &groupPlatforms)
	}
	ratioChanges := model.RecentGroupRatioChanges()
	for groupName := range ratio_setting.GetGroupRatioCopy() {
		// UserUsableGroups contains the groups that the user can use
		if desc, ok := userUsableGroups[groupName]; ok {
			info := map[string]any{
				"ratio": service.GetUserGroupRatio(userGroup, groupName),
				"desc":  desc,
			}
			if platform := groupPlatforms[groupName]; platform != "" {
				info["platform"] = platform
			}
			if badges := common.GetGroupBadges(groupName); len(badges) > 0 {
				info["badges"] = badges
			}
			// A user with a special ratio for the group does not pay the
			// group ratio, so its change would mislead them.
			if change, ok := ratioChanges[groupName]; ok {
				if _, special := ratio_setting.GetGroupGroupRatio(userGroup, groupName); !special {
					info["ratio_change"] = change
				}
			}
			usableGroups[groupName] = info
		}
	}
	if _, ok := userUsableGroups["auto"]; ok {
		usableGroups["auto"] = map[string]any{
			"ratio": "auto",
			"desc":  setting.GetUsableGroupDescription("auto"),
		}
		if badges := common.GetGroupBadges("auto"); len(badges) > 0 {
			usableGroups["auto"]["badges"] = badges
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    usableGroups,
	})
}
