package system_setting

import (
	"github.com/QuantumNous/new-api/setting/config"
	"sync/atomic"
)

// TelegramBotSettings 独立于网站 Telegram 登录设置，默认不启用机器人。
type TelegramBotSettings struct {
	Enabled bool `json:"enabled"`
}

var telegramBotSettings TelegramBotSettings
var telegramBotEnabled atomic.Bool

func init() {
	config.GlobalConfig.Register("telegram_bot", &telegramBotSettings)
}

func GetTelegramBotSettings() *TelegramBotSettings { return &telegramBotSettings }

func TelegramBotEnabled() bool           { return telegramBotEnabled.Load() }
func SetTelegramBotEnabled(enabled bool) { telegramBotEnabled.Store(enabled) }
