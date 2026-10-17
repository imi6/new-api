package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
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

const (
	// DisableStreakRequest counts user-request failures separately from health checks.
	DisableStreakRequest = "request"
	// DisableStreakHealth counts scheduled health-check failures separately from user requests.
	DisableStreakHealth = "health"

	disableStreakScopeContextKey = "channel_disable_streak_scope"
)

func channelDisableStreakID(channelID int, usingKey string, scope string) string {
	if scope == "" {
		scope = DisableStreakRequest
	}
	base := strconv.Itoa(channelID) + ":" + scope
	if usingKey == "" {
		return base
	}
	sum := sha256.Sum256([]byte(usingKey))
	return base + ":" + hex.EncodeToString(sum[:8])
}

func channelDisableStreakRedisKey(id string) string {
	return "channel:disable_streak:" + id
}

// MarkHealthCheckDisableStreak makes later failure accounting on this context
// count scheduled health checks, not user requests.
func MarkHealthCheckDisableStreak(c *gin.Context) {
	if c != nil {
		c.Set(disableStreakScopeContextKey, DisableStreakHealth)
	}
}

func disableStreakScope(c *gin.Context) string {
	if c != nil {
		if value, exists := c.Get(disableStreakScopeContextKey); exists {
			if scope, ok := value.(string); ok && scope != "" {
				return scope
			}
		}
	}
	return DisableStreakRequest
}

// channelFailureDisables reports whether this matching failure should disable the channel.
// User requests and scheduled health checks keep separate streaks. Matching status codes and
// failure keywords must occur AutomaticDisableFailureCount times in a row on the same path.
// A success clears only that path. Channel-local errors, including a health check past the
// time limit, still match on the first failure.
func channelFailureDisables(channelID int, usingKey string, autoBan bool, err *types.NewAPIError, scope string) bool {
	if !matchingFailureUsesStreak(autoBan, err) {
		return ShouldDisableChannel(err) && autoBan
	}
	if advanceChannelDisableStreak(channelID, usingKey, scope) < common.AutomaticDisableFailureCount {
		return false
	}
	ClearChannelDisableStreak(channelID, usingKey, scope)
	return true
}

// channelFailureWouldDisable predicts the decision without recording another failure.
func channelFailureWouldDisable(channelID int, usingKey string, autoBan bool, err *types.NewAPIError, scope string) bool {
	if !matchingFailureUsesStreak(autoBan, err) {
		return ShouldDisableChannel(err) && autoBan
	}
	return currentChannelDisableStreak(channelID, usingKey, scope)+1 >= common.AutomaticDisableFailureCount
}

func matchingFailureUsesStreak(autoBan bool, err *types.NewAPIError) bool {
	if !ShouldDisableChannel(err) || !autoBan || types.IsChannelError(err) {
		return false
	}
	return common.AutomaticDisableFailureCount > 1
}

// ClearChannelDisableStreak forgets consecutive matching failures for one path after a success on that path.
func ClearChannelDisableStreak(channelID int, usingKey string, scope string) {
	id := channelDisableStreakID(channelID, usingKey, scope)
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

func currentChannelDisableStreak(channelID int, usingKey string, scope string) int {
	id := channelDisableStreakID(channelID, usingKey, scope)
	if common.RedisEnabled && common.RDB != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		value, err := common.RDB.Get(ctx, channelDisableStreakRedisKey(id)).Result()
		if err == nil {
			count, convErr := strconv.Atoi(value)
			if convErr == nil && count > 0 {
				return count
			}
			return 0
		}
		if errors.Is(err, redis.Nil) {
			return 0
		}
	}
	channelDisableStreakMu.Lock()
	defer channelDisableStreakMu.Unlock()
	entry, ok := channelDisableStreaks[id]
	if !ok || !entry.expires.After(time.Now()) {
		return 0
	}
	return entry.count
}

func advanceChannelDisableStreak(channelID int, usingKey string, scope string) int {
	id := channelDisableStreakID(channelID, usingKey, scope)
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
