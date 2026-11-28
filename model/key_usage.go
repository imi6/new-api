package model

import (
	"context"
	"crypto/subtle"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

// GetPublicKeyUsageToken 使用数据库中的密钥和账号状态。公开查询不使用可能滞后的授权缓存。
func GetPublicKeyUsageToken(ctx context.Context, key string) (*Token, error) {
	var token Token
	// 即使开启 SQL 调试，也不要将本次查询的密钥写入日志。
	err := DB.WithContext(ctx).Session(&gorm.Session{Logger: logger.Discard}).
		Where(clause.Eq{Column: clause.Column{Name: "key"}, Value: key}).First(&token).Error
	if err != nil {
		return nil, err
	}
	if subtle.ConstantTimeCompare([]byte(token.Key), []byte(key)) != 1 {
		// 数据库列可能使用不区分大小写的排序规则。
		return nil, gorm.ErrRecordNotFound
	}
	var user User
	if err = DB.WithContext(ctx).Select("status").First(&user, token.UserId).Error; err != nil {
		return nil, err
	}
	if user.Status != common.UserStatusEnabled {
		return nil, gorm.ErrRecordNotFound
	}
	return &token, nil
}

// KeyUsageLog 限制密钥查询可读取和导出的字段。
type KeyUsageLog struct {
	CreatedAt        int64  `json:"created_at"`
	ModelName        string `json:"model_name"`
	PromptTokens     int    `json:"prompt_tokens"`
	CompletionTokens int    `json:"completion_tokens"`
	Quota            int    `json:"quota"`
	Type             int    `json:"type"`
}

const KeyUsageLogSearchLimit = 10_000

// ListKeyUsageLogs 仅列出该密钥的扣费和退款。分页计数有界，导出无需计数。
func ListKeyUsageLogs(ctx context.Context, token *Token, filter LogFilter, offset, limit int, count bool) ([]KeyUsageLog, int, bool, error) {
	query := LOG_DB.WithContext(ctx).Model(&Log{}).
		Where("logs.user_id = ? AND logs.token_id = ?", token.UserId, token.Id).
		Where("logs.type IN ?", []int{LogTypeConsume, LogTypeRefund}).
		Where("logs.created_at >= ? AND logs.created_at <= ?", filter.StartTimestamp, filter.EndTimestamp)
	if filter.ModelName != "" {
		query = query.Where("logs.model_name = ?", filter.ModelName)
	}
	var total int64
	if count {
		// LIMIT 必须位于子查询中才会限制 COUNT 的扫描结果。
		sample := query.Session(&gorm.Session{}).Select("1").Limit(KeyUsageLogSearchLimit + 1)
		if err := LOG_DB.WithContext(ctx).Table("(?) AS usage_rows", sample).Count(&total).Error; err != nil {
			return nil, 0, false, err
		}
	}
	order := "logs.created_at desc, logs.id desc"
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		order = clickHouseLogOrder("logs.")
	}
	items := make([]KeyUsageLog, 0)
	err := query.Select("created_at", "model_name", "prompt_tokens", "completion_tokens", "quota", "type").
		Order(order).Limit(limit).Offset(offset).Find(&items).Error
	return items, int(min(total, KeyUsageLogSearchLimit)), total > KeyUsageLogSearchLimit, err
}
