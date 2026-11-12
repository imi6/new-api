package ratio_setting

import (
	"encoding/json"
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/types"
)

var defaultGroupRatio = map[string]float64{
	"default": 1,
	"vip":     1,
	"svip":    1,
}

var groupRatioMap = types.NewRWMap[string, float64]()

var defaultGroupGroupRatio = map[string]map[string]float64{
	"vip": {
		"edit_this": 0.9,
	},
}

var groupGroupRatioMap = types.NewRWMap[string, map[string]float64]()

var defaultGroupSpecialUsableGroup = map[string]map[string]string{}

type GroupRatioSetting struct {
	GroupRatio              *types.RWMap[string, float64]            `json:"group_ratio"`
	GroupGroupRatio         *types.RWMap[string, map[string]float64] `json:"group_group_ratio"`
	GroupSpecialUsableGroup *types.RWMap[string, map[string]string]  `json:"group_special_usable_group"`
}

var groupRatioSetting GroupRatioSetting

func init() {
	groupSpecialUsableGroup := types.NewRWMap[string, map[string]string]()
	groupSpecialUsableGroup.AddAll(defaultGroupSpecialUsableGroup)

	groupRatioMap.AddAll(defaultGroupRatio)
	groupGroupRatioMap.AddAll(defaultGroupGroupRatio)

	groupRatioSetting = GroupRatioSetting{
		GroupSpecialUsableGroup: groupSpecialUsableGroup,
		GroupRatio:              groupRatioMap,
		GroupGroupRatio:         groupGroupRatioMap,
	}

	config.GlobalConfig.Register("group_ratio_setting", &groupRatioSetting)
}

func GetGroupRatioSetting() *GroupRatioSetting {
	if groupRatioSetting.GroupSpecialUsableGroup == nil {
		groupRatioSetting.GroupSpecialUsableGroup = types.NewRWMap[string, map[string]string]()
		groupRatioSetting.GroupSpecialUsableGroup.AddAll(defaultGroupSpecialUsableGroup)
	}
	return &groupRatioSetting
}

func GetGroupRatioCopy() map[string]float64 {
	return groupRatioMap.ReadAll()
}

// lookupGroupRatio 改名期间同一分组可能还以别名出现在配置里，用别名兜底。
func lookupGroupRatio(name string) (float64, bool) {
	return common.LookupRenamedGroup(name, groupRatioMap.Get)
}

func ContainsGroupRatio(name string) bool {
	_, ok := lookupGroupRatio(name)
	return ok
}

func GroupRatio2JSONString() string {
	return groupRatioMap.MarshalJSONString()
}

func UpdateGroupRatioByJSONString(jsonStr string) error {
	return types.LoadFromJsonString(groupRatioMap, jsonStr)
}

func GetGroupRatio(name string) float64 {
	ratio, ok := lookupGroupRatio(name)
	if !ok {
		common.SysLog(common.LogText("group ratio not found: %s", name))
		return 1
	}
	return ratio
}

// lookupUserGroupRatios 返回用户组的特殊倍率表，改名期间同样接受别名。
func lookupUserGroupRatios(userGroup string) (map[string]float64, bool) {
	return common.LookupRenamedGroup(userGroup, groupGroupRatioMap.Get)
}

func GetGroupGroupRatio(userGroup, usingGroup string) (float64, bool) {
	gp, ok := lookupUserGroupRatios(userGroup)
	if !ok {
		return -1, false
	}
	ratio, ok := common.LookupRenamedGroup(usingGroup, func(name string) (float64, bool) {
		ratio, ok := gp[name]
		return ratio, ok
	})
	if !ok {
		return -1, false
	}
	return ratio, true
}

// HasGroupSpecialRatio reports whether users of the group have a special ratio
// rule, that is, the group is a user group in GroupGroupRatio.
func HasGroupSpecialRatio(userGroup string) bool {
	rules, ok := lookupUserGroupRatios(userGroup)
	return ok && len(rules) > 0
}

func GroupGroupRatio2JSONString() string {
	return groupGroupRatioMap.MarshalJSONString()
}

func UpdateGroupGroupRatioByJSONString(jsonStr string) error {
	return types.LoadFromJsonString(groupGroupRatioMap, jsonStr)
}

func CheckGroupRatio(jsonStr string) error {
	checkGroupRatio := make(map[string]float64)
	err := json.Unmarshal([]byte(jsonStr), &checkGroupRatio)
	if err != nil {
		return err
	}
	for name, ratio := range checkGroupRatio {
		if ratio < 0 {
			return errors.New("group ratio must be not less than 0: " + name)
		}
	}
	return nil
}
