package controller

import (
	"math"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

// The group health page shows, for every group a user can pick, how real
// requests and scheduled channel checks went. Real traffic comes from the
// model square metrics; checks come from the scheduled channel test, so no
// request is sent only for this page. Only group totals leave the server:
// no channel name, id, upstream address, or error text.

const groupHealthCacheTTL = 60 * time.Second

const (
	groupHealthStatusOK      = "ok"
	groupHealthStatusDown    = "down"
	groupHealthStatusUnknown = "unknown"

	groupHealthLatencyTTFT  = "ttft"
	groupHealthLatencyProbe = "probe"
)

// groupHealthBar is one period as the page draws it. It carries rates and
// latencies only: the page is public, so request and check counts stay on
// the server.
type groupHealthBar struct {
	Start         int64   `json:"start"`
	SuccessRate   float64 `json:"success_rate"`
	HasData       bool    `json:"has_data"`
	AvgLatencyMs  int64   `json:"avg_latency_ms"`
	LatencySource string  `json:"latency_source"`
	// CacheHitRate is the share of input tokens read from the upstream cache,
	// in percent, over real requests; -1 when none reported input tokens.
	CacheHitRate float64 `json:"cache_hit_rate"`
}

type groupHealthGroup struct {
	Name     string `json:"name"`
	Desc     string `json:"desc"`
	Platform string `json:"platform"`
	Status   string `json:"status"`
	TopModel string `json:"top_model"`
	// GroupRatio is the configured price ratio of the group, the one the
	// pricing page also shows; a user's special ratio is not applied.
	GroupRatio float64 `json:"group_ratio"`
	// RatioChange is the group ratio's recent change, or that the group is
	// new; absent when there is none or the notice is off.
	RatioChange *model.GroupRatioChangeInfo `json:"ratio_change,omitempty"`
	// CacheHitRate is the share of input tokens read from the upstream cache
	// over the last CacheHitRateMinutes, in percent; -1 when there is none.
	CacheHitRate float64 `json:"cache_hit_rate"`
	// LastSampleAt is the time of the latest check, or the start of the
	// latest hour with real traffic, whichever is later.
	LastSampleAt int64            `json:"last_sample_at"`
	Total        groupHealthBar   `json:"total"`
	Bars         []groupHealthBar `json:"bars"`
	// IntelligenceCheck is set when the group is listed for intelligence
	// checks, which shows the check button on its card.
	IntelligenceCheck bool `json:"intelligence_check"`
}

type groupHealthResponse struct {
	UpdatedAt          int64              `json:"updated_at"`
	Range              string             `json:"range"`
	RealTrafficEnabled bool               `json:"real_traffic_enabled"`
	ProbeEnabled       bool               `json:"probe_enabled"`
	Total              groupHealthBar     `json:"total"`
	Groups             []groupHealthGroup `json:"groups"`
	// CacheHitRateEnabled shows the cache hit rates; CacheHitRateMinutes is
	// the window of each group's card rate.
	CacheHitRateEnabled bool `json:"cache_hit_rate_enabled"`
	CacheHitRateMinutes int  `json:"cache_hit_rate_minutes"`
}

// healthCounters sums real requests and checks over any span of hours.
type healthCounters struct {
	realRequests    int64
	realSuccesses   int64
	ttftSumMs       int64
	ttftCount       int64
	probeSamples    int64
	probeSuccesses  int64
	probeLatencyMs  int64
	inputTokens     int64
	cacheReadTokens int64
}

func (h *healthCounters) add(other healthCounters) {
	h.realRequests += other.realRequests
	h.realSuccesses += other.realSuccesses
	h.ttftSumMs += other.ttftSumMs
	h.ttftCount += other.ttftCount
	h.probeSamples += other.probeSamples
	h.probeSuccesses += other.probeSuccesses
	h.probeLatencyMs += other.probeLatencyMs
	h.inputTokens += other.inputTokens
	h.cacheReadTokens += other.cacheReadTokens
}

// bar turns counters into the shape the page draws. The success rate counts
// real requests and checks together. The latency is the time to first token
// of real streaming requests, or the check round trip when there is none.
// The cache hit rate counts real requests only.
func (h healthCounters) bar(start int64) groupHealthBar {
	bar := groupHealthBar{Start: start, CacheHitRate: -1}
	total := h.realRequests + h.probeSamples
	if total > 0 {
		bar.HasData = true
		rate := float64(h.realSuccesses+h.probeSuccesses) / float64(total) * 100
		bar.SuccessRate = math.Round(rate*100) / 100
	}
	if h.inputTokens > 0 {
		rate := float64(min(h.cacheReadTokens, h.inputTokens)) / float64(h.inputTokens) * 100
		bar.CacheHitRate = math.Round(rate*100) / 100
	}
	switch {
	case h.ttftCount > 0:
		bar.AvgLatencyMs = h.ttftSumMs / h.ttftCount
		bar.LatencySource = groupHealthLatencyTTFT
	case h.probeSuccesses > 0:
		bar.AvgLatencyMs = h.probeLatencyMs / h.probeSuccesses
		bar.LatencySource = groupHealthLatencyProbe
	}
	return bar
}

type groupHealthCacheEntry struct {
	data    *groupHealthResponse
	expires time.Time
}

var (
	groupHealthCache   = map[string]groupHealthCacheEntry{}
	groupHealthCacheMu sync.Mutex
)

// GetGroupHealth serves the group health page. Access follows the
// "groupHealth" top navigation switch.
func GetGroupHealth(c *gin.Context) {
	rangeName := c.DefaultQuery("range", "hour")
	switch rangeName {
	case "hour", "day", "week":
	default:
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	groupHealthCacheMu.Lock()
	entry, ok := groupHealthCache[rangeName]
	groupHealthCacheMu.Unlock()
	if ok && time.Now().Before(entry.expires) {
		common.ApiSuccess(c, entry.data)
		return
	}
	data, err := buildGroupHealth(rangeName, time.Now())
	if err != nil {
		common.SysError(common.LogText("failed to build group health: %s", err.Error()))
		common.ApiErrorT(c, "Failed to load channel status")
		return
	}
	groupHealthCacheMu.Lock()
	groupHealthCache[rangeName] = groupHealthCacheEntry{data: data, expires: time.Now().Add(groupHealthCacheTTL)}
	groupHealthCacheMu.Unlock()
	common.ApiSuccess(c, data)
}

type channelStatusCacheClearRequest struct {
	// Before deletes the cache counts from before this time; zero deletes all.
	Before int64 `json:"before"`
}

// ClearChannelStatusCache deletes the stored cache hit rate counts of every
// group, all of them or those older than a time.
func ClearChannelStatusCache(c *gin.Context) {
	var req channelStatusCacheClearRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || req.Before < 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	deleted, err := perfmetrics.ClearCacheStats(req.Before)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// The page shows the cleared rates at once instead of after a minute.
	groupHealthCacheMu.Lock()
	groupHealthCache = map[string]groupHealthCacheEntry{}
	groupHealthCacheMu.Unlock()
	common.ApiSuccess(c, gin.H{"deleted": deleted})
}

// groupHealthBarStarts returns the start of every bar of the range, oldest
// first, in the server's time zone.
func groupHealthBarStarts(rangeName string, now time.Time) []int64 {
	local := now.Local()
	starts := make([]int64, 0, 30)
	switch rangeName {
	case "day":
		today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, local.Location())
		for i := 29; i >= 0; i-- {
			starts = append(starts, today.AddDate(0, 0, -i).Unix())
		}
	case "week":
		today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, local.Location())
		monday := today.AddDate(0, 0, -((int(today.Weekday()) + 6) % 7))
		for i := 11; i >= 0; i-- {
			starts = append(starts, monday.AddDate(0, 0, -7*i).Unix())
		}
	default:
		hour := now.Unix() - now.Unix()%3600
		for i := int64(23); i >= 0; i-- {
			starts = append(starts, hour-i*3600)
		}
	}
	return starts
}

func buildGroupHealth(rangeName string, now time.Time) (*groupHealthResponse, error) {
	usable := service.GetUserUsableGroups("")
	channels, err := model.GetGroupHealthChannels()
	if err != nil {
		return nil, err
	}
	enabledChannels := map[string]int{}
	// Without user traffic the card names the model the checks use: that of
	// the first enabled channel, or of the first channel when none is enabled.
	testModels := map[string]string{}
	fallbackModels := map[string]string{}
	present := map[string]bool{}
	for _, channel := range channels {
		for group := range strings.SplitSeq(strings.Trim(channel.Group, ","), ",") {
			group = strings.TrimSpace(group)
			if _, ok := usable[group]; !ok || group == "auto" {
				continue
			}
			present[group] = true
			name := channel.CheckModel()
			if channel.Status == common.ChannelStatusEnabled {
				enabledChannels[group]++
				if testModels[group] == "" {
					testModels[group] = name
				}
			} else if fallbackModels[group] == "" {
				fallbackModels[group] = name
			}
		}
	}
	groups := make([]string, 0, len(present))
	for group := range present {
		groups = append(groups, group)
	}
	slices.Sort(groups)

	starts := groupHealthBarStarts(rangeName, now)
	windowStart, windowEnd := starts[0], now.Unix()
	cacheHitRateEnabled := operation_setting.GetChannelStatusSetting().CacheHitRateEnabled
	cacheHitRates := map[string]float64{}
	cacheHitRateMinutes := operation_setting.CacheHitRateMinutes()
	if cacheHitRateEnabled {
		// A failed lookup only blanks the cache hit rates.
		rates, minutes, rateErr := perfmetrics.GroupCacheHitRates(groups, now)
		if rateErr != nil {
			common.SysError(common.LogText("failed to load cache hit rates: %s", rateErr.Error()))
		} else {
			cacheHitRates, cacheHitRateMinutes = rates, minutes
		}
	}
	traffic, err := perfmetrics.QueryGroupTraffic(groups, windowStart, windowEnd)
	if err != nil {
		return nil, err
	}
	probes, err := model.GetGroupHealthProbes(groups, windowStart, windowEnd)
	if err != nil {
		return nil, err
	}

	hours := map[string]map[int64]*healthCounters{}
	lastSample := map[string]int64{}
	hourOf := func(group string, ts int64) *healthCounters {
		byHour := hours[group]
		if byHour == nil {
			byHour = map[int64]*healthCounters{}
			hours[group] = byHour
		}
		counters := byHour[ts]
		if counters == nil {
			counters = &healthCounters{}
			byHour[ts] = counters
		}
		return counters
	}
	for group, byHour := range traffic.Hours {
		for ts, value := range byHour {
			counters := hourOf(group, ts)
			counters.realRequests += value.RequestCount
			counters.realSuccesses += value.SuccessCount
			counters.ttftSumMs += value.TtftSumMs
			counters.ttftCount += value.TtftCount
			// Without the switch every cache hit rate stays empty (-1).
			if cacheHitRateEnabled {
				counters.inputTokens += value.InputTokens
				counters.cacheReadTokens += value.CacheReadTokens
			}
			lastSample[group] = max(lastSample[group], ts)
		}
	}
	for _, row := range probes {
		counters := hourOf(row.GroupName, row.BucketTs)
		counters.probeSamples += row.Samples
		counters.probeSuccesses += row.Successes
		counters.probeLatencyMs += row.LatencySumMs
		lastSample[row.GroupName] = max(lastSample[row.GroupName], row.LastTs)
	}

	platforms := map[string]string{}
	if common.GroupPlatformMap != "" {
		// Admin-validated JSON; a parse failure only drops the platform hint.
		_ = common.UnmarshalJsonStr(common.GroupPlatformMap, &platforms)
	}
	currentHour := now.Unix() - now.Unix()%3600
	groupRatios := ratio_setting.GetGroupRatioCopy()
	ratioChanges := model.RecentGroupRatioChanges()
	response := &groupHealthResponse{
		UpdatedAt:           now.Unix(),
		Range:               rangeName,
		RealTrafficEnabled:  traffic.Enabled,
		ProbeEnabled:        operation_setting.GetMonitorSetting().AutoTestChannelEnabled,
		CacheHitRateEnabled: cacheHitRateEnabled,
		CacheHitRateMinutes: cacheHitRateMinutes,
		Groups:              make([]groupHealthGroup, 0, len(groups)),
	}
	var overall healthCounters
	for _, group := range groups {
		barCounters := make([]healthCounters, len(starts))
		var total, recent healthCounters
		for ts, counters := range hours[group] {
			// The bar is the last one starting at or before this hour.
			index, found := slices.BinarySearch(starts, ts)
			if !found {
				index--
			}
			if index >= 0 {
				barCounters[index].add(*counters)
				total.add(*counters)
			}
			if ts >= currentHour-3600 {
				recent.add(*counters)
			}
		}
		bars := make([]groupHealthBar, len(starts))
		for i, counters := range barCounters {
			bars[i] = counters.bar(starts[i])
		}
		overall.add(total)

		status := groupHealthStatusUnknown
		switch {
		case enabledChannels[group] == 0:
			status = groupHealthStatusDown
		case recent.realRequests+recent.probeSamples == 0:
		case recent.realSuccesses+recent.probeSuccesses > 0:
			status = groupHealthStatusOK
		default:
			status = groupHealthStatusDown
		}

		topModel := testModels[group]
		if topModel == "" {
			topModel = fallbackModels[group]
		}
		var topRequests int64
		for name, requests := range traffic.Models[group] {
			if requests > topRequests || (requests == topRequests && name < topModel) {
				topModel, topRequests = name, requests
			}
		}

		ratio, ok := groupRatios[group]
		if !ok {
			ratio = 1
		}
		cacheHitRate, ok := cacheHitRates[group]
		if ok {
			cacheHitRate = math.Round(cacheHitRate*100) / 100
		} else {
			cacheHitRate = -1
		}
		var ratioChange *model.GroupRatioChangeInfo
		if change, ok := ratioChanges[group]; ok {
			ratioChange = &change
		}
		response.Groups = append(response.Groups, groupHealthGroup{
			Name:              group,
			Desc:              usable[group],
			Platform:          platforms[group],
			Status:            status,
			TopModel:          topModel,
			GroupRatio:        ratio,
			RatioChange:       ratioChange,
			CacheHitRate:      cacheHitRate,
			LastSampleAt:      lastSample[group],
			Total:             total.bar(windowStart),
			Bars:              bars,
			IntelligenceCheck: operation_setting.IntelligenceCheckTargetModel(group) != "",
		})
	}
	response.Total = overall.bar(windowStart)
	return response, nil
}
