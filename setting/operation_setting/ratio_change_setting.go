package operation_setting

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

// RatioChangeSetting controls the notice shown next to a group's ratio after
// an administrator changes it, stored as ratio_change_setting.<json key>.
type RatioChangeSetting struct {
	// Enabled shows recent ratio changes and new groups to users.
	Enabled bool `json:"enabled"`
	// Days is how long a change stays marked.
	Days int `json:"days"`
}

const (
	ratioChangeOptionScope = "ratio_change_setting."

	RatioChangeMinDays     = 1
	RatioChangeMaxDays     = 30
	defaultRatioChangeDays = 3
)

var ratioChangeSetting = RatioChangeSetting{
	Enabled: true,
	Days:    defaultRatioChangeDays,
}

func init() {
	config.GlobalConfig.Register("ratio_change_setting", &ratioChangeSetting)
}

func GetRatioChangeSetting() *RatioChangeSetting {
	return &ratioChangeSetting
}

// RatioChangeDays clamps the stored number of days to the allowed range.
func RatioChangeDays() int {
	days := ratioChangeSetting.Days
	if days <= 0 {
		return defaultRatioChangeDays
	}
	return min(max(days, RatioChangeMinDays), RatioChangeMaxDays)
}

// ValidateRatioChangeSettingOption checks one ratio_change_setting.* option
// before it is saved. Keys outside these settings are accepted.
func ValidateRatioChangeSettingOption(key, value string) error {
	field, ok := strings.CutPrefix(key, ratioChangeOptionScope)
	if !ok {
		return nil
	}
	switch field {
	case "enabled":
		if _, err := strconv.ParseBool(strings.TrimSpace(value)); err != nil {
			return common.NewMessage("Invalid parameters")
		}
	case "days":
		days, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil || days < RatioChangeMinDays || days > RatioChangeMaxDays {
			return invoiceRangeError(RatioChangeMinDays, RatioChangeMaxDays)
		}
	default:
		return common.NewMessage("Invalid parameters")
	}
	return nil
}
