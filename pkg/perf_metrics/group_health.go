package perfmetrics

import (
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/perf_metrics_setting"
)

// GroupHourCounters is real relay traffic of one group in one hour, summed
// over models.
type GroupHourCounters struct {
	RequestCount int64
	SuccessCount int64
	TtftSumMs    int64
	TtftCount    int64
}

// GroupTraffic is real relay traffic per group: hourly counters, and request
// counts per model over the whole window.
type GroupTraffic struct {
	Enabled bool
	Hours   map[string]map[int64]GroupHourCounters
	Models  map[string]map[string]int64
}

func hourOf(ts int64) int64 {
	return ts - ts%3600
}

// QueryGroupTraffic sums real relay traffic of the given groups in
// [startTs, endTs] by hour. Stored buckets of any size are folded into whole
// hours; the current, unflushed buckets of this node are added from memory,
// as the model square does.
func QueryGroupTraffic(groups []string, startTs int64, endTs int64) (GroupTraffic, error) {
	result := GroupTraffic{
		Enabled: perf_metrics_setting.GetSetting().Enabled,
		Hours:   map[string]map[int64]GroupHourCounters{},
		Models:  map[string]map[string]int64{},
	}
	add := func(group string, ts int64, value GroupHourCounters) {
		hours := result.Hours[group]
		if hours == nil {
			hours = map[int64]GroupHourCounters{}
			result.Hours[group] = hours
		}
		current := hours[hourOf(ts)]
		current.RequestCount += value.RequestCount
		current.SuccessCount += value.SuccessCount
		current.TtftSumMs += value.TtftSumMs
		current.TtftCount += value.TtftCount
		hours[hourOf(ts)] = current
	}
	addModel := func(group string, modelName string, requests int64) {
		if requests <= 0 || modelName == "" {
			return
		}
		models := result.Models[group]
		if models == nil {
			models = map[string]int64{}
			result.Models[group] = models
		}
		models[modelName] += requests
	}

	buckets, err := model.GetPerfMetricGroupBuckets(groups, startTs, endTs)
	if err != nil {
		return result, err
	}
	for _, row := range buckets {
		add(row.GroupName, row.BucketTs, GroupHourCounters{
			RequestCount: row.RequestCount,
			SuccessCount: row.SuccessCount,
			TtftSumMs:    row.TtftSumMs,
			TtftCount:    row.TtftCount,
		})
	}
	models, err := model.GetPerfMetricGroupModels(groups, startTs, endTs)
	if err != nil {
		return result, err
	}
	for _, row := range models {
		addModel(row.GroupName, row.ModelName, row.RequestCount)
	}

	allowed := allowedGroupSet(groups)
	hotBuckets.Range(func(key, value any) bool {
		k := key.(bucketKey)
		if k.bucketTs < startTs || k.bucketTs > endTs {
			return true
		}
		if _, ok := allowed[k.group]; !ok {
			return true
		}
		snap := value.(*atomicBucket).snapshot()
		if snap.requestCount == 0 {
			return true
		}
		add(k.group, k.bucketTs, GroupHourCounters{
			RequestCount: snap.requestCount,
			SuccessCount: snap.successCount,
			TtftSumMs:    snap.ttftSumMs,
			TtftCount:    snap.ttftCount,
		})
		addModel(k.group, k.model, snap.requestCount)
		return true
	})
	return result, nil
}
