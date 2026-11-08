package model

import (
	"context"
	"errors"
	"strings"

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
