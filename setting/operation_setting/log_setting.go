package operation_setting

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

const LogMaxRangeDaysOptionKey = "log_setting.max_range_days"
const PublicKeyUsageEnabledOptionKey = "log_setting.public_key_usage_enabled"

// LogSetting limits how far regular users can reach into usage logs.
type LogSetting struct {
	// UserExportEnabled lets regular users export their own usage logs.
	// Administrators can always export.
	UserExportEnabled bool `json:"user_export_enabled"`
	// CacheHitRateEnabled 控制使用日志及详情中的缓存命中率展示。
	CacheHitRateEnabled bool `json:"cache_hit_rate_enabled"`
	// PublicKeyUsageEnabled 允许持有 API 密钥的访客查询该密钥的公开用量。
	PublicKeyUsageEnabled bool `json:"public_key_usage_enabled"`
	// MaxRangeDays is the longest time range a user can search in their logs
	// and dashboard, and the longest range any export can cover.
	MaxRangeDays int `json:"max_range_days"`
}

var logSetting = LogSetting{
	UserExportEnabled:   true,
	CacheHitRateEnabled: true,
	MaxRangeDays:        365,
}

func init() {
	config.GlobalConfig.Register("log_setting", &logSetting)
}

func GetLogSetting() *LogSetting {
	return &logSetting
}

func LogSettingsSnapshot() LogSetting {
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	return logSetting
}

func (s *LogSetting) MaxRangeSeconds() int64 {
	return int64(max(s.MaxRangeDays, 1)) * 24 * 60 * 60
}

func ValidateLogMaxRangeDays(value string) error {
	days, err := strconv.Atoi(value)
	if err != nil || days < 1 {
		return common.NewMessage("The longest log time range must be at least 1 day")
	}
	return nil
}
