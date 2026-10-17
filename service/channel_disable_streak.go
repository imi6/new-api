package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/types"
)

const channelDisableStreakWindow = 30 * time.Minute

type channelDisableStreak struct {
	count   int
	expires time.Time
}

var (
	channelDisableStreaks  = map[string]channelDisableStreak{}
	channelDisableStreakMu sync.Mutex
)

func channelDisableStreakID(channelID int, usingKey string) string {
	if usingKey == "" {
		return strconv.Itoa(channelID)
	}
	sum := sha256.Sum256([]byte(usingKey))
	return strconv.Itoa(channelID) + ":" + hex.EncodeToString(sum[:8])
}

func channelDisableStreakRedisKey(id string) string {
	return "channel:disable_streak:" + id
}

// HealthCheckFailureDisables reports whether a scheduled health check should disable the channel.
// User-request failures do not use this counter. Matching status codes and failure keywords must
// occur AutomaticDisableFailureCount times in a row. A successful request or health check clears it.
// Channel-local errors, including a health check that exceeds the time limit, still match on the first failure.
func HealthCheckFailureDisables(channelID int, usingKey string, autoBan bool, err *types.NewAPIError) bool {
	return channelFailureDisables(channelID, usingKey, autoBan, err)
}

func channelFailureDisables(channelID int, usingKey string, autoBan bool, err *types.NewAPIError) bool {
	if !ShouldDisableChannel(err) || !autoBan {
		return false
	}
	needed := common.AutomaticDisableFailureCount
	if needed < 1 {
		needed = 1
	}
	if types.IsChannelError(err) || needed <= 1 {
		return true
	}
	if advanceChannelDisableStreak(channelID, usingKey) < needed {
		return false
	}
	ClearChannelDisableStreak(channelID, usingKey)
	return true
}

// ClearChannelDisableStreak forgets consecutive matching failures after a successful request or health check.
func ClearChannelDisableStreak(channelID int, usingKey string) {
	id := channelDisableStreakID(channelID, usingKey)
	if common.RedisEnabled && common.RDB != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := common.RDB.Del(ctx, channelDisableStreakRedisKey(id)).Err(); err != nil {
			common.SysLog(common.LogText("failed to clear channel disable streak: %s", err.Error()))
		}
	}
	channelDisableStreakMu.Lock()
	delete(channelDisableStreaks, id)
	channelDisableStreakMu.Unlock()
}

func advanceChannelDisableStreak(channelID int, usingKey string) int {
	id := channelDisableStreakID(channelID, usingKey)
	if common.RedisEnabled && common.RDB != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		count, err := common.RDB.Incr(ctx, channelDisableStreakRedisKey(id)).Result()
		if err == nil {
			if expErr := common.RDB.Expire(ctx, channelDisableStreakRedisKey(id), channelDisableStreakWindow).Err(); expErr != nil {
				common.SysLog(common.LogText("failed to expire channel disable streak: %s", expErr.Error()))
			}
			return int(count)
		}
		common.SysLog(common.LogText("failed to record channel disable streak: %s", err.Error()))
	}
	channelDisableStreakMu.Lock()
	defer channelDisableStreakMu.Unlock()
	entry := channelDisableStreaks[id]
	if !entry.expires.After(time.Now()) {
		entry.count = 0
	}
	entry.count++
	entry.expires = time.Now().Add(channelDisableStreakWindow)
	channelDisableStreaks[id] = entry
	return entry.count
}
