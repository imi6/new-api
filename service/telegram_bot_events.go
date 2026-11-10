package service

import (
	"context"

	"github.com/QuantumNous/new-api/model"
)

// ScanTelegramBusinessReminders 由 Bot 后台工作进程按分钟调用，不依赖单实例内存去重。
func ScanTelegramBusinessReminders(ctx context.Context) error {
	return model.ScanTelegramReminderEvents(ctx)
}
