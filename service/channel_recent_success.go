package service

import (
	"context"
	"errors"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
)

// A channel that just served a successful user request is known to work, so
// a scheduled health check can skip it. Each node keeps the time in memory;
// Redis shares it with the master node that runs the checks. A node writes a
// channel at most once per minute, so busy channels cost little.

const (
	channelRecentSuccessWriteGap = 60
	channelTestContextKey        = "channel_test_request"
)

var channelRecentSuccess sync.Map // channel id -> unix seconds

// MarkChannelTestContext tags a channel test request, so its success is not
// taken for a user request that proves the channel works.
func MarkChannelTestContext(c *gin.Context) {
	if c != nil {
		c.Set(channelTestContextKey, true)
	}
}

func channelRecentSuccessRedisKey(channelID int) string {
	return "channel:recent_success:" + strconv.Itoa(channelID)
}

// channelRecentSuccessTTL keeps a mark for two test intervals, long enough for
// the next scheduled run to see it.
func channelRecentSuccessTTL() time.Duration {
	minutes := operation_setting.GetMonitorSetting().AutoTestChannelMinutes
	if minutes <= 0 {
		minutes = 10
	}
	return time.Duration(2 * minutes * float64(time.Minute))
}

// MarkChannelRecentSuccess records that the channel just served a user
// request successfully. Channel test requests are ignored.
func MarkChannelRecentSuccess(c *gin.Context, channelID int) {
	if channelID <= 0 || c.GetBool(channelTestContextKey) || !operation_setting.GetMonitorSetting().SkipRecentlyUsedChannels {
		return
	}
	now := time.Now().Unix()
	if last, ok := channelRecentSuccess.Load(channelID); ok && now-last.(int64) < channelRecentSuccessWriteGap {
		return
	}
	channelRecentSuccess.Store(channelID, now)
	if !common.RedisEnabled || common.RDB == nil {
		return
	}
	ttl := channelRecentSuccessTTL()
	gopool.Go(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := common.RDB.Set(ctx, channelRecentSuccessRedisKey(channelID), now, ttl).Err(); err != nil {
			common.SysLog(common.LogText("failed to record channel recent success: %s", err.Error()))
		}
	})
}

// ChannelRecentlySucceeded reports whether the channel served a successful
// user request since the given time, on any node when Redis is enabled.
func ChannelRecentlySucceeded(channelID int, since int64) bool {
	if last, ok := channelRecentSuccess.Load(channelID); ok && last.(int64) >= since {
		return true
	}
	if !common.RedisEnabled || common.RDB == nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	value, err := common.RDB.Get(ctx, channelRecentSuccessRedisKey(channelID)).Int64()
	if err != nil {
		if !errors.Is(err, redis.Nil) {
			common.SysLog(common.LogText("failed to read channel recent success: %s", err.Error()))
		}
		return false
	}
	return value >= since
}
