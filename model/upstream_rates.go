package model

import (
	"context"
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const upstreamRatesOptionPrefix = "UpstreamRates."

// IsUpstreamRatesOption 将内部凭据和快照与普通系统设置隔离。
func IsUpstreamRatesOption(key string) bool {
	return strings.HasPrefix(strings.ToLower(key), strings.ToLower(upstreamRatesOptionPrefix))
}

func ReadUpstreamRatesState(ctx context.Context, name string) (string, error) {
	var option Option
	err := DB.WithContext(ctx).Where(&Option{Key: upstreamRatesOptionPrefix + name}).First(&option).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", nil
	}
	return option.Value, err
}

// MutateUpstreamRatesState 复用已有设置表，并在同一事务内锁定和更新单份状态。
func MutateUpstreamRatesState(ctx context.Context, name string, mutate func(string) (string, error)) error {
	return DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		option := Option{Key: upstreamRatesOptionPrefix + name, Value: "{}"}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&option).Error; err != nil {
			return err
		}
		if err := lockForUpdate(tx).Where(&Option{Key: option.Key}).First(&option).Error; err != nil {
			return err
		}
		value, err := mutate(option.Value)
		if err != nil {
			return err
		}
		return tx.Model(&Option{}).Where(&Option{Key: option.Key}).Update("value", value).Error
	})
}

// GetUpstreamRateChannels 仅供后端匹配使用，返回值不得直接作为接口响应。
func GetUpstreamRateChannels(ctx context.Context, ids []int) ([]*Channel, error) {
	channels := make([]*Channel, 0)
	if len(ids) == 0 {
		return channels, nil
	}
	err := DB.WithContext(ctx).Where("id IN ?", ids).Find(&channels).Error
	return channels, err
}

// ErrUpstreamRateGuardStateChanged 表示本轮判断依据已改变，调用方应停止应用旧视图。
var ErrUpstreamRateGuardStateChanged = errors.New("upstream rate guard state changed")

// UpdateUpstreamRateGuardChannelStatus 按配置、开关、渠道的固定顺序加锁，
// 在同一事务内核对判断依据并更新状态和能力，避免其他节点的新配置被旧判断覆盖。
func UpdateUpstreamRateGuardChannelStatus(ctx context.Context, channelID int, enabled bool, guardReason, expectedConfig string, guardEnabled bool) (bool, error) {
	if common.MemoryCacheEnabled {
		channelStatusLock.Lock()
		defer channelStatusLock.Unlock()
	}
	lock := GetChannelPollingLock(channelID)
	lock.Lock()
	defer lock.Unlock()
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		keyLock := sqliteChannelKeyLock(channelID)
		keyLock.Lock()
		defer keyLock.Unlock()
	}
	status, reason := common.ChannelStatusAutoDisabled, guardReason
	if enabled {
		status, reason = common.ChannelStatusEnabled, ""
	}
	written := false
	err := DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var config Option
		if err := lockForUpdate(tx).Where(&Option{Key: upstreamRatesOptionPrefix + "config"}).First(&config).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrUpstreamRateGuardStateChanged
			}
			return err
		}
		if config.Value != expectedConfig {
			return ErrUpstreamRateGuardStateChanged
		}
		var guard Option
		if err := lockForUpdate(tx).Where(&Option{Key: upstreamRatesOptionPrefix + "guard"}).First(&guard).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrUpstreamRateGuardStateChanged
			}
			return err
		}
		var setting struct {
			Enabled bool `json:"enabled"`
		}
		if guard.Value != "" {
			if err := common.UnmarshalJsonStr(guard.Value, &setting); err != nil {
				return err
			}
		}
		if setting.Enabled != guardEnabled {
			return ErrUpstreamRateGuardStateChanged
		}
		var channel Channel
		if err := lockForUpdate(tx).Select("id", "status", "other_info").First(&channel, "id = ?", channelID).Error; err != nil {
			return err
		}
		info := make(map[string]any)
		if channel.OtherInfo != "" {
			if err := common.UnmarshalJsonStr(channel.OtherInfo, &info); err != nil {
				return err
			}
		}
		if info == nil {
			info = make(map[string]any)
		}
		if enabled {
			if channel.Status != common.ChannelStatusAutoDisabled || info["status_reason"] != guardReason {
				return nil
			}
		} else if channel.Status != common.ChannelStatusEnabled {
			return nil
		}
		info["status_reason"], info["status_time"] = reason, common.GetTimestamp()
		encoded, err := common.Marshal(info)
		if err != nil {
			return err
		}
		if err := tx.Model(&Channel{}).Where("id = ?", channelID).
			Updates(map[string]any{"status": status, "other_info": string(encoded)}).Error; err != nil {
			return err
		}
		if err := tx.Model(&Ability{}).Where("channel_id = ?", channelID).
			Select("enabled").Update("enabled", enabled).Error; err != nil {
			return err
		}
		written = true
		return nil
	})
	if err != nil {
		return false, err
	}
	if !written {
		return false, nil
	}
	CacheUpdateChannelStatus(channelID, status)
	return true, nil
}
