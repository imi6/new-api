package model

import (
	"strings"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// GroupHealthProbe sums the scheduled channel health checks of one group in
// one hour. A channel in several groups counts toward each of them. Only
// checks of enabled channels are recorded: a disabled channel gets no user
// traffic, so its recovery checks would understate the group.
type GroupHealthProbe struct {
	Id           int    `json:"id"`
	GroupName    string `json:"group_name" gorm:"type:varchar(64);uniqueIndex:idx_group_health_probe_bucket,priority:1"`
	BucketTs     int64  `json:"bucket_ts" gorm:"uniqueIndex:idx_group_health_probe_bucket,priority:2;index:idx_group_health_probe_ts"`
	Samples      int64  `json:"samples"`
	Successes    int64  `json:"successes"`
	LatencySumMs int64  `json:"latency_sum_ms"` // successful checks only
	LastTs       int64  `json:"last_ts"`
}

// GroupHealthProbeRetentionSeconds keeps the probe history of the week view.
const GroupHealthProbeRetentionSeconds = 90 * 24 * 3600

func hourStart(ts int64) int64 {
	return ts - ts%3600
}

// RecordGroupHealthProbe adds one channel health check to each group of the
// channel. A failure is logged and never fails the check itself.
func RecordGroupHealthProbe(groups []string, success bool, latencyMs int64, now int64) {
	successes, latency := int64(0), int64(0)
	if success {
		successes, latency = 1, max(latencyMs, 0)
	}
	for _, group := range groups {
		if group == "" {
			continue
		}
		row := &GroupHealthProbe{
			GroupName:    group,
			BucketTs:     hourStart(now),
			Samples:      1,
			Successes:    successes,
			LatencySumMs: latency,
			LastTs:       now,
		}
		err := DB.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "group_name"}, {Name: "bucket_ts"}},
			DoUpdates: clause.Assignments(map[string]any{
				"samples":        gorm.Expr("group_health_probes.samples + ?", 1),
				"successes":      gorm.Expr("group_health_probes.successes + ?", successes),
				"latency_sum_ms": gorm.Expr("group_health_probes.latency_sum_ms + ?", latency),
				"last_ts":        now,
			}),
		}).Create(row).Error
		if err != nil {
			common.SysError(common.LogText("failed to record group health probe group=%s: %s", group, err.Error()))
		}
	}
}

// DeleteGroupHealthProbesBefore drops probe hours older than the cutoff.
func DeleteGroupHealthProbesBefore(cutoffTs int64) error {
	return DB.Where("bucket_ts < ?", cutoffTs).Delete(&GroupHealthProbe{}).Error
}

// GetGroupHealthProbes returns the probe hours of the given groups in
// [startTs, endTs].
func GetGroupHealthProbes(groups []string, startTs int64, endTs int64) ([]GroupHealthProbe, error) {
	var rows []GroupHealthProbe
	if len(groups) == 0 {
		return rows, nil
	}
	err := DB.Where("group_name IN ? AND bucket_ts >= ? AND bucket_ts <= ?", groups, startTs, endTs).
		Find(&rows).Error
	return rows, err
}

// PerfMetricGroupBucket is real relay traffic of one group in one stored
// bucket, summed over models.
type PerfMetricGroupBucket struct {
	GroupName    string `gorm:"column:group_name"`
	BucketTs     int64  `gorm:"column:bucket_ts"`
	RequestCount int64  `gorm:"column:request_count"`
	SuccessCount int64  `gorm:"column:success_count"`
	TtftSumMs    int64  `gorm:"column:ttft_sum_ms"`
	TtftCount    int64  `gorm:"column:ttft_count"`
}

// GetPerfMetricGroupBuckets sums stored relay metrics by group and bucket.
func GetPerfMetricGroupBuckets(groups []string, startTs int64, endTs int64) ([]PerfMetricGroupBucket, error) {
	var rows []PerfMetricGroupBucket
	if len(groups) == 0 {
		return rows, nil
	}
	err := DB.Model(&PerfMetric{}).
		Select(commonGroupCol+" AS group_name, bucket_ts, SUM(request_count) AS request_count, SUM(success_count) AS success_count, SUM(ttft_sum_ms) AS ttft_sum_ms, SUM(ttft_count) AS ttft_count").
		Where(commonGroupCol+" IN ? AND bucket_ts >= ? AND bucket_ts <= ?", groups, startTs, endTs).
		Group(commonGroupCol + ", bucket_ts").
		Find(&rows).Error
	return rows, err
}

// PerfMetricGroupModel is the real request count of one model in one group.
type PerfMetricGroupModel struct {
	GroupName    string `gorm:"column:group_name"`
	ModelName    string `gorm:"column:model_name"`
	RequestCount int64  `gorm:"column:request_count"`
}

// GetPerfMetricGroupModels sums stored relay requests by group and model.
func GetPerfMetricGroupModels(groups []string, startTs int64, endTs int64) ([]PerfMetricGroupModel, error) {
	var rows []PerfMetricGroupModel
	if len(groups) == 0 {
		return rows, nil
	}
	err := DB.Model(&PerfMetric{}).
		Select(commonGroupCol+" AS group_name, model_name, SUM(request_count) AS request_count").
		Where(commonGroupCol+" IN ? AND bucket_ts >= ? AND bucket_ts <= ?", groups, startTs, endTs).
		Group(commonGroupCol + ", model_name").
		Find(&rows).Error
	return rows, err
}

// GroupHealthChannel is the part of a channel the health page needs. The key
// and every upstream detail stay out.
type GroupHealthChannel struct {
	Id        int     `gorm:"column:id"`
	Group     string  `gorm:"column:group_name"`
	Status    int     `gorm:"column:status"`
	TestModel *string `gorm:"column:test_model"`
	Models    string  `gorm:"column:models"`
}

// CheckModel is the model a channel test uses: the test model when set,
// otherwise the first model of the channel.
func (c GroupHealthChannel) CheckModel() string {
	if c.TestModel != nil && strings.TrimSpace(*c.TestModel) != "" {
		return strings.TrimSpace(*c.TestModel)
	}
	first, _, _ := strings.Cut(strings.Trim(c.Models, ","), ",")
	return strings.TrimSpace(first)
}

// GetGroupHealthChannels lists every channel that is not manually disabled.
func GetGroupHealthChannels() ([]GroupHealthChannel, error) {
	var rows []GroupHealthChannel
	err := DB.Model(&Channel{}).
		Select("id, "+commonGroupCol+" AS group_name, status, test_model, models").
		Where("status <> ?", common.ChannelStatusManuallyDisabled).
		Find(&rows).Error
	return rows, err
}
