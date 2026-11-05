package operation_setting

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

// ChannelStatusSetting holds the display options of the channel status page,
// stored as channel_status_setting.<json key> options.
type ChannelStatusSetting struct {
	// CacheHitRateEnabled shows each group's cache hit rate on its card.
	CacheHitRateEnabled bool `json:"cache_hit_rate_enabled"`
	// CacheHitRateMinutes is the window of the card's cache hit rate. Cache
	// counts older than it are deleted.
	CacheHitRateMinutes int `json:"cache_hit_rate_minutes"`
}

const (
	channelStatusOptionScope = "channel_status_setting."

	CacheHitRateMinMinutes     = 5
	CacheHitRateMaxMinutes     = 1440
	defaultCacheHitRateMinutes = 60
)

var channelStatusSetting = ChannelStatusSetting{
	CacheHitRateEnabled: true,
	CacheHitRateMinutes: defaultCacheHitRateMinutes,
}

func init() {
	config.GlobalConfig.Register("channel_status_setting", &channelStatusSetting)
}

func GetChannelStatusSetting() *ChannelStatusSetting {
	return &channelStatusSetting
}

// CacheHitRateMinutes clamps the stored window to the allowed range.
func CacheHitRateMinutes() int {
	minutes := channelStatusSetting.CacheHitRateMinutes
	if minutes <= 0 {
		return defaultCacheHitRateMinutes
	}
	return min(max(minutes, CacheHitRateMinMinutes), CacheHitRateMaxMinutes)
}

// ValidateChannelStatusSettingOption checks one channel_status_setting.*
// option before it is saved. Keys outside these settings are accepted.
func ValidateChannelStatusSettingOption(key, value string) error {
	field, ok := strings.CutPrefix(key, channelStatusOptionScope)
	if !ok {
		return nil
	}
	switch field {
	case "cache_hit_rate_enabled":
		if _, err := strconv.ParseBool(strings.TrimSpace(value)); err != nil {
			return common.NewMessage("Invalid parameters")
		}
	case "cache_hit_rate_minutes":
		minutes, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil || minutes < CacheHitRateMinMinutes || minutes > CacheHitRateMaxMinutes {
			return invoiceRangeError(CacheHitRateMinMinutes, CacheHitRateMaxMinutes)
		}
	default:
		return common.NewMessage("Invalid parameters")
	}
	return nil
}
