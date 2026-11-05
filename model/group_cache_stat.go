package model

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// GroupCacheStat sums the input and cache read tokens of one group's real
// requests in one minute, for the cache hit rate of the channel status page.
// Rows older than the configured window are deleted.
type GroupCacheStat struct {
	Id              int    `json:"id"`
	GroupName       string `json:"group_name" gorm:"type:varchar(64);uniqueIndex:idx_group_cache_stat_minute,priority:1"`
	MinuteTs        int64  `json:"minute_ts" gorm:"uniqueIndex:idx_group_cache_stat_minute,priority:2;index:idx_group_cache_stat_ts"`
	InputTokens     int64  `json:"input_tokens"`
	CacheReadTokens int64  `json:"cache_read_tokens"`
}

// AddGroupCacheStat adds counts to a group's minute; several nodes may add to
// the same minute.
func AddGroupCacheStat(row *GroupCacheStat) error {
	return DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "group_name"}, {Name: "minute_ts"}},
		DoUpdates: clause.Assignments(map[string]any{
			"input_tokens":      gorm.Expr("group_cache_stats.input_tokens + ?", row.InputTokens),
			"cache_read_tokens": gorm.Expr("group_cache_stats.cache_read_tokens + ?", row.CacheReadTokens),
		}),
	}).Create(row).Error
}

// GroupCacheTotal is the summed counts of one group.
type GroupCacheTotal struct {
	GroupName       string `gorm:"column:group_name"`
	InputTokens     int64  `gorm:"column:input_tokens"`
	CacheReadTokens int64  `gorm:"column:cache_read_tokens"`
}

// GetGroupCacheTotals sums each group's counts from sinceTs on.
func GetGroupCacheTotals(groups []string, sinceTs int64) ([]GroupCacheTotal, error) {
	var rows []GroupCacheTotal
	if len(groups) == 0 {
		return rows, nil
	}
	err := DB.Model(&GroupCacheStat{}).
		Select("group_name, SUM(input_tokens) AS input_tokens, SUM(cache_read_tokens) AS cache_read_tokens").
		Where("group_name IN ? AND minute_ts >= ?", groups, sinceTs).
		Group("group_name").
		Find(&rows).Error
	return rows, err
}

// DeleteGroupCacheStatsBefore drops the minutes before the cutoff.
func DeleteGroupCacheStatsBefore(cutoffTs int64) error {
	return DB.Where("minute_ts < ?", cutoffTs).Delete(&GroupCacheStat{}).Error
}
