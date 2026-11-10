package model

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// TelegramLowBalanceState 持久保存余额提醒轮次，重启和多实例共享同一去重依据。
type TelegramLowBalanceState struct {
	UserID            int   `gorm:"primaryKey"`
	ConnectionVersion int64 `gorm:"not null"`
	PreferenceVersion int64 `gorm:"not null"`
	Threshold         int64 `gorm:"not null"`
	Below             bool
	Round             int64 `gorm:"not null"`
	UpdatedAt         int64 `gorm:"not null"`
}

func creditTopUpAndNotifyTx(tx *gorm.DB, topUp *TopUp, quota int, paidQuota int, updates map[string]any, source string) error {
	if err := creditTopUpQuota(tx, topUp.UserId, quota, paidQuota, updates); err != nil {
		return err
	}
	return enqueueTelegramWalletCreditTx(tx, topUp.UserId, quota, fmt.Sprintf("topup:%d", topUp.Id), source, topUp.CompleteTime)
}

func enqueueTelegramWalletCreditTx(tx *gorm.DB, userID int, quota int, eventKey string, source string, occurredAt int64) error {
	if !system_setting.TelegramBotEnabled() {
		return nil
	}
	var user User
	if err := lockForUpdate(tx).Unscoped().Select("id", "quota").First(&user, userID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if err := EnqueueTelegramBusinessEventTx(tx, &TelegramBusinessEvent{
		Key: eventKey, Kind: "topup", UserID: userID,
		AmountQuota: int64(quota), BalanceQuota: int64(user.Quota), OccurredAt: occurredAt,
		Source: source,
	}); err != nil {
		return err
	}
	return ResetTelegramLowBalanceAfterCreditTx(tx, userID)
}

// ResetTelegramLowBalanceAfterCreditTx 所有钱包增加入口共用恢复判断，不把非充值记为充值通知。
func ResetTelegramLowBalanceAfterCreditTx(tx *gorm.DB, userID int) error {
	if !system_setting.TelegramBotEnabled() {
		return nil
	}
	var user User
	if err := lockForUpdate(tx).Unscoped().Select("id", "quota").First(&user, userID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	return tx.Model(&TelegramLowBalanceState{}).
		Where("user_id = ? AND below = ? AND threshold <= ?", userID, true, user.Quota).
		Updates(map[string]any{"below": false, "updated_at": common.GetTimestamp()}).Error
}

func enqueueTelegramSubscriptionEventTx(tx *gorm.DB, order *SubscriptionOrder, subscription *UserSubscription, title string) error {
	return EnqueueTelegramBusinessEventTx(tx, &TelegramBusinessEvent{
		Key: fmt.Sprintf("subscription:%d", order.Id), Kind: "subscription", UserID: order.UserId,
		OccurredAt: order.CompleteTime, SubscriptionID: subscription.Id, ExpiresAt: subscription.EndTime,
		Title: title, Source: order.PaymentProvider,
	})
}

func telegramLowBalanceThreshold(user *User) (int64, error) {
	threshold := user.GetSetting().QuotaWarningThreshold
	if threshold == 0 {
		threshold = float64(common.QuotaRemindThreshold)
	}
	if math.IsNaN(threshold) || math.IsInf(threshold, 0) || threshold < 0 || threshold > common.MaxWalletQuota {
		return 0, errors.New("invalid low balance threshold")
	}
	if threshold == 0 {
		return 0, nil
	}
	// 钱包额度为整数，向上取整与原有浮点阈值比较保持等价。
	quota, err := common.WalletQuotaFromDecimalStrict(decimal.NewFromFloat(threshold).Ceil())
	return int64(quota), err
}

// InitializeTelegramLowBalanceStateTx 新连接或重新启用提醒时只建立基线，不追发历史低余额。
func InitializeTelegramLowBalanceStateTx(tx *gorm.DB, connection *TelegramBotConnection) error {
	if !common.QuotaRemindEnabled {
		return nil
	}
	var user User
	if err := lockForUpdate(tx).First(&user, connection.UserID).Error; err != nil {
		return err
	}
	threshold, err := telegramLowBalanceThreshold(&user)
	if err != nil {
		return err
	}
	state := TelegramLowBalanceState{
		UserID: connection.UserID, ConnectionVersion: connection.Version,
		PreferenceVersion: connection.LowBalanceVersion, Threshold: threshold,
		Below: int64(user.Quota) < threshold, Round: 1, UpdatedAt: common.GetTimestamp(),
	}
	return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}}, DoUpdates: clause.Assignments(map[string]any{
		"connection_version": state.ConnectionVersion, "preference_version": state.PreferenceVersion,
		"threshold": state.Threshold, "below": state.Below,
		"round": gorm.Expr("? + 1", clause.Column{Table: "telegram_low_balance_states", Name: "round"}), "updated_at": state.UpdatedAt,
	})}).Create(&state).Error
}

func telegramLowBalanceEventKey(state *TelegramLowBalanceState) string {
	return fmt.Sprintf("low_balance:%d:%d:%d:%d", state.UserID, state.ConnectionVersion, state.PreferenceVersion, state.Round)
}

// ScanTelegramReminderEvents 分批扫描当前连接，所有状态转换和事件写入在短事务中完成。
func ScanTelegramReminderEvents(ctx context.Context) error {
	if !system_setting.TelegramBotEnabled() {
		return nil
	}
	config, err := GetTelegramBotConfig()
	if err != nil || !config.Enabled {
		return err
	}
	lastUserID := 0
	var scanErr error
	for {
		var connections []TelegramBotConnection
		if err := DB.WithContext(ctx).Where("user_id > ? AND bot_id = ? AND status = ? AND notify_enabled = ?", lastUserID, config.BotID, "connected", true).
			Order("user_id").Limit(100).Find(&connections).Error; err != nil {
			return err
		}
		if len(connections) == 0 {
			return scanErr
		}
		for _, connection := range connections {
			lastUserID = connection.UserID
			if err := ctx.Err(); err != nil {
				return err
			}
			if err := scanTelegramUserReminders(ctx, connection.UserID, config.BotID); err != nil && scanErr == nil {
				// 单个用户的旧设置异常不阻塞其他人的提醒，下一轮仍会重试。
				scanErr = fmt.Errorf("telegram reminder user %d: %w", connection.UserID, err)
			}
		}
	}
}

func scanTelegramUserReminders(ctx context.Context, userID int, botID int64) error {
	return DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 与充值、领取及偏好修改保持用户在连接之前的锁序，恢复判断和低余额基于同一余额。
		var user User
		if err := lockForUpdate(tx).Where("id = ? AND status = ?", userID, common.UserStatusEnabled).First(&user).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		var connection TelegramBotConnection
		if err := lockForUpdate(tx).First(&connection, "user_id = ?", userID).Error; err != nil {
			return err
		}
		if connection.BotID != botID || connection.Status != "connected" || !connection.Preferences.Enabled {
			return nil
		}
		if user.TelegramId != connection.TelegramID {
			return nil
		}
		now := common.GetTimestamp()
		if connection.Preferences.LowBalance && common.QuotaRemindEnabled {
			threshold, err := telegramLowBalanceThreshold(&user)
			if err != nil {
				return err
			}
			var state TelegramLowBalanceState
			err = lockForUpdate(tx).First(&state, "user_id = ?", userID).Error
			if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && (state.ConnectionVersion != connection.Version || state.PreferenceVersion != connection.LowBalanceVersion || state.Threshold != threshold)) {
				if err := InitializeTelegramLowBalanceStateTx(tx, &connection); err != nil {
					return err
				}
			} else if err != nil {
				return err
			} else {
				below := int64(user.Quota) < threshold
				if below != state.Below {
					state.Below, state.UpdatedAt = below, now
					if below {
						state.Round++
						if err := EnqueueTelegramBusinessEventTx(tx, &TelegramBusinessEvent{
							Key: telegramLowBalanceEventKey(&state), Kind: "low_balance", UserID: userID,
							AmountQuota: threshold, BalanceQuota: int64(user.Quota), OccurredAt: now, Source: "wallet",
						}); err != nil {
							return err
						}
					}
					if err := tx.Save(&state).Error; err != nil {
						return err
					}
				}
			}
		}
		if !connection.Preferences.Expiry {
			return nil
		}
		var subscriptions []UserSubscription
		if err := tx.Where("user_id = ? AND status = ? AND start_time <= ? AND end_time > ? AND end_time <= ?", userID, "active", now, now, now+24*60*60).
			Order("id").Find(&subscriptions).Error; err != nil {
			return err
		}
		for _, subscription := range subscriptions {
			// 短期套餐的购买消息已带到期时间，避免紧接着重复提醒。
			if subscription.EndTime-subscription.StartTime <= 24*60*60 {
				continue
			}
			var plan SubscriptionPlan
			if err := tx.First(&plan, subscription.PlanId).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if err := EnqueueTelegramBusinessEventTx(tx, &TelegramBusinessEvent{
				Key: fmt.Sprintf("expiry:%d:%d:24h", subscription.Id, subscription.EndTime), Kind: "expiry", UserID: userID,
				SubscriptionID: subscription.Id, ExpiresAt: subscription.EndTime, OccurredAt: now, Title: plan.Title,
			}); err != nil {
				return err
			}
		}
		return nil
	})
}

// TelegramBusinessEventStillValid 在真正发送提醒前校验当前业务状态，不让旧提醒误导用户。
func TelegramBusinessEventStillValid(event *TelegramBusinessEvent) (bool, error) {
	return telegramBusinessEventStillValidTx(DB, event)
}

func telegramBusinessEventStillValidTx(tx *gorm.DB, event *TelegramBusinessEvent) (bool, error) {
	switch event.Kind {
	case "low_balance":
		if !common.QuotaRemindEnabled {
			return false, nil
		}
		var user User
		if err := tx.First(&user, event.UserID).Error; err != nil {
			return false, err
		}
		threshold, err := telegramLowBalanceThreshold(&user)
		if err != nil {
			return false, err
		}
		var state TelegramLowBalanceState
		if err := tx.First(&state, "user_id = ?", event.UserID).Error; err != nil {
			return false, err
		}
		return threshold == event.AmountQuota && int64(user.Quota) < threshold && state.Below && telegramLowBalanceEventKey(&state) == event.Key, nil
	case "expiry":
		var subscription UserSubscription
		if err := tx.First(&subscription, event.SubscriptionID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return false, nil
			}
			return false, err
		}
		now := time.Now().Unix()
		return subscription.UserId == event.UserID && subscription.Status == "active" && subscription.EndTime == event.ExpiresAt && subscription.EndTime > now && subscription.EndTime <= now+24*60*60, nil
	default:
		return true, nil
	}
}
