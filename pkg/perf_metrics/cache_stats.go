package perfmetrics

import (
	"math"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

// The channel status card shows each group's cache hit rate over the last N
// minutes. The hourly performance buckets are too coarse for that, so the
// input and cache read tokens of real requests are also summed per group and
// minute: in memory first, then flushed to group_cache_stats once the minute
// is over. Minutes older than the window are deleted.

type cacheMinuteKey struct {
	group    string
	minuteTs int64
}

type cacheMinuteCounters struct {
	inputTokens     atomic.Int64
	cacheReadTokens atomic.Int64
}

var cacheMinutes sync.Map

// recordCacheStat adds one request's tokens to its group's current minute.
func recordCacheStat(group string, inputTokens int64, cacheReadTokens int64) {
	if inputTokens <= 0 || !operation_setting.GetChannelStatusSetting().CacheHitRateEnabled {
		return
	}
	if group == "" {
		group = "default"
	}
	now := time.Now().Unix()
	key := cacheMinuteKey{group: group, minuteTs: now - now%60}
	actual, _ := cacheMinutes.LoadOrStore(key, &cacheMinuteCounters{})
	counters := actual.(*cacheMinuteCounters)
	counters.inputTokens.Add(inputTokens)
	counters.cacheReadTokens.Add(min(max(cacheReadTokens, 0), inputTokens))
}

func cacheStatLoop() {
	for {
		time.Sleep(time.Minute)
		flushCacheMinutes()
		cutoff := cacheStatCutoff(time.Now())
		if _, err := model.DeleteGroupCacheStatsBefore(cutoff); err != nil {
			common.SysError(common.LogText("failed to delete old cache stats: %s", err.Error()))
		}
	}
}

// ClearCacheStats deletes the cache counts of every group from before the
// time, or all of them when before is zero, with this node's unsaved minutes.
// Other nodes write their unsaved minutes within a minute.
func ClearCacheStats(before int64) (int64, error) {
	if before <= 0 {
		before = math.MaxInt64
	}
	cacheMinutes.Range(func(rawKey, _ any) bool {
		if rawKey.(cacheMinuteKey).minuteTs < before {
			cacheMinutes.Delete(rawKey)
		}
		return true
	})
	return model.DeleteGroupCacheStatsBefore(before)
}

// cacheStatCutoff is the first minute inside the window: the current minute
// and the N-1 before it.
func cacheStatCutoff(now time.Time) int64 {
	ts := now.Unix()
	return ts - ts%60 - int64(operation_setting.CacheHitRateMinutes()-1)*60
}

// flushCacheMinutes writes every finished minute and forgets the empty ones.
// A failed write keeps its counts in memory for the next try.
func flushCacheMinutes() {
	now := time.Now().Unix()
	currentMinute := now - now%60
	cutoff := cacheStatCutoff(time.Now())
	cacheMinutes.Range(func(rawKey, value any) bool {
		key := rawKey.(cacheMinuteKey)
		if key.minuteTs >= currentMinute {
			return true
		}
		counters := value.(*cacheMinuteCounters)
		input := counters.inputTokens.Swap(0)
		cacheRead := counters.cacheReadTokens.Swap(0)
		if input == 0 || key.minuteTs < cutoff {
			cacheMinutes.Delete(rawKey)
			return true
		}
		err := model.AddGroupCacheStat(&model.GroupCacheStat{
			GroupName:       key.group,
			MinuteTs:        key.minuteTs,
			InputTokens:     input,
			CacheReadTokens: cacheRead,
		})
		if err != nil {
			counters.inputTokens.Add(input)
			counters.cacheReadTokens.Add(cacheRead)
			common.SysError(common.LogText("failed to flush cache stats group=%s: %s", key.group, err.Error()))
			return true
		}
		cacheMinutes.Delete(rawKey)
		return true
	})
}

// GroupCacheHitRates returns each group's cache hit rate in percent over the
// configured window, with the window in minutes. A group whose requests
// reported no input tokens has no rate.
func GroupCacheHitRates(groups []string, now time.Time) (map[string]float64, int, error) {
	minutes := operation_setting.CacheHitRateMinutes()
	cutoff := cacheStatCutoff(now)
	rows, err := model.GetGroupCacheTotals(groups, cutoff)
	if err != nil {
		return nil, minutes, err
	}
	input := map[string]int64{}
	cacheRead := map[string]int64{}
	for _, row := range rows {
		input[row.GroupName] += row.InputTokens
		cacheRead[row.GroupName] += row.CacheReadTokens
	}
	// Minutes not yet flushed by this node.
	allowed := allowedGroupSet(groups)
	cacheMinutes.Range(func(rawKey, value any) bool {
		key := rawKey.(cacheMinuteKey)
		if _, ok := allowed[key.group]; !ok || key.minuteTs < cutoff {
			return true
		}
		counters := value.(*cacheMinuteCounters)
		input[key.group] += counters.inputTokens.Load()
		cacheRead[key.group] += counters.cacheReadTokens.Load()
		return true
	})
	rates := map[string]float64{}
	for group, tokens := range input {
		if tokens <= 0 {
			continue
		}
		rates[group] = float64(min(cacheRead[group], tokens)) / float64(tokens) * 100
	}
	return rates, minutes, nil
}
