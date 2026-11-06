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
		if _, err := model.DeleteGroupCacheStatsBefore(cacheStatKeepFrom(time.Now())); err != nil {
			common.SysError(common.LogText("failed to delete old cache stats: %s", err.Error()))
		}
	}
}

// cacheStatKeepFrom is the oldest minute kept: the card's window, and at
// least the current hour, whose detail bar is also summed from these minutes.
func cacheStatKeepFrom(now time.Time) int64 {
	ts := now.Unix()
	return min(cacheStatCutoff(now), ts-ts%3600)
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
	cutoff := cacheStatKeepFrom(time.Now())
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

// GroupCacheTokens is a group's summed input and cache read tokens.
type GroupCacheTokens struct {
	Input     int64
	CacheRead int64
}

// GroupCacheTotalsSince sums each group's minutes from sinceTs on: those every
// node has written, and this node's unsaved ones.
func GroupCacheTotalsSince(groups []string, sinceTs int64) (map[string]GroupCacheTokens, error) {
	rows, err := model.GetGroupCacheTotals(groups, sinceTs)
	if err != nil {
		return nil, err
	}
	totals := map[string]GroupCacheTokens{}
	for _, row := range rows {
		total := totals[row.GroupName]
		total.Input += row.InputTokens
		total.CacheRead += row.CacheReadTokens
		totals[row.GroupName] = total
	}
	allowed := allowedGroupSet(groups)
	cacheMinutes.Range(func(rawKey, value any) bool {
		key := rawKey.(cacheMinuteKey)
		if _, ok := allowed[key.group]; !ok || key.minuteTs < sinceTs {
			return true
		}
		counters := value.(*cacheMinuteCounters)
		total := totals[key.group]
		total.Input += counters.inputTokens.Load()
		total.CacheRead += counters.cacheReadTokens.Load()
		totals[key.group] = total
		return true
	})
	return totals, nil
}

// GroupCacheHitRates returns each group's cache hit rate in percent over the
// configured window, with the window in minutes. A group whose requests
// reported no input tokens has no rate.
func GroupCacheHitRates(groups []string, now time.Time) (map[string]float64, int, error) {
	minutes := operation_setting.CacheHitRateMinutes()
	totals, err := GroupCacheTotalsSince(groups, cacheStatCutoff(now))
	if err != nil {
		return nil, minutes, err
	}
	rates := map[string]float64{}
	for group, total := range totals {
		if total.Input <= 0 {
			continue
		}
		rates[group] = float64(min(total.CacheRead, total.Input)) / float64(total.Input) * 100
	}
	return rates, minutes, nil
}
