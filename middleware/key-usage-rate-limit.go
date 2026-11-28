package middleware

import (
	"context"
	"net/http"
	"net/netip"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

const (
	keyUsageFailureLimit   = 5
	keyUsageFailureWindow  = 600
	keyUsageLimitNamespace = redisRateLimitNamespace + ":key-usage:"
)

// 同一来源的失败和正在鉴权的请求共用额度。预占与过期清理在 Redis 中原子执行。
const keyUsageAttemptScript = `
local now = tonumber(redis.call('TIME')[1])
local window = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[1]) then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return tonumber(oldest[2]) + window - now
end
redis.call('ZADD', KEYS[1], now, ARGV[3])
redis.call('EXPIRE', KEYS[1], window)
return 0
`

var keyUsageLimits common.InMemoryRateLimiter
var publicKeyUsageSlots = make(chan struct{}, 24)

func keyUsageClient(c *gin.Context) string {
	ip, err := netip.ParseAddr(c.ClientIP())
	if err != nil {
		return "unknown"
	}
	ip = ip.Unmap()
	if ip.Is6() {
		return netip.PrefixFrom(ip.WithZone(""), 64).Masked().String()
	}
	return ip.String()
}

func keyUsageRateLimited(c *gin.Context, seconds int64) {
	c.Header("Retry-After", strconv.FormatInt(max(seconds, 1), 10))
	common.ApiErrorStatus(c, http.StatusTooManyRequests, common.NewMessage("Too many requests"))
}

func keyUsageLimiterUnavailable(c *gin.Context) {
	common.ApiErrorStatus(c, http.StatusServiceUnavailable, common.NewMessage("Please try again later."))
}

func takeKeyUsageLimit(c *gin.Context, subject string, limit int, window int64) bool {
	key := keyUsageLimitNamespace + subject
	if common.RedisEnabled {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		ok, _, retryAfter, err := redisFixedWindowTake(ctx, key, limit, window)
		if err != nil {
			keyUsageLimiterUnavailable(c)
			return false
		}
		if !ok {
			keyUsageRateLimited(c, retryAfter)
		}
		return ok
	}
	keyUsageLimits.Init(common.RateLimitKeyExpirationDuration)
	if keyUsageLimits.Request(key, limit, window) {
		return true
	}
	keyUsageRateLimited(c, window)
	return false
}

func PublicKeyUsageSettingsRateLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !takeKeyUsageLimit(c, "settings:"+keyUsageClient(c), 60, 60) {
			c.Abort()
		}
	}
}

// AdmitPublicKeyUsage 限制进入查库的请求。调用方在鉴权结束后归还预占，并在请求结束后释放并发名额。
func AdmitPublicKeyUsage(c *gin.Context) (completeAttempt func(bool), release func(), ok bool) {
	client := keyUsageClient(c)
	if !takeKeyUsageLimit(c, "ip:minute:"+client, 12, 60) ||
		!takeKeyUsageLimit(c, "ip:ten-minutes:"+client, 60, 600) {
		return nil, nil, false
	}

	select {
	case publicKeyUsageSlots <- struct{}{}:
	default:
		keyUsageRateLimited(c, 1)
		return nil, nil, false
	}
	release = func() { <-publicKeyUsageSlots }
	completeAttempt, ok = reservePublicKeyUsageAttempt(c, client)
	if !ok {
		release()
		return nil, nil, false
	}
	if !takeKeyUsageLimit(c, "global", 600, 60) {
		completeAttempt(false)
		release()
		return nil, nil, false
	}
	return completeAttempt, release, true
}

// reservePublicKeyUsageAttempt 先预占鉴权额度，仅凭据校验失败时保留记录。
func reservePublicKeyUsageAttempt(c *gin.Context, client string) (complete func(failed bool), ok bool) {
	key := keyUsageLimitNamespace + "invalid:" + client
	if !common.RedisEnabled {
		keyUsageLimits.Init(common.RateLimitKeyExpirationDuration)
		reservation := keyUsageLimits.Reserve(key, keyUsageFailureLimit, keyUsageFailureWindow)
		if reservation == nil {
			keyUsageRateLimited(c, keyUsageFailureWindow)
			return nil, false
		}
		return reservation.Complete, true
	}

	redisClient := common.RDB
	if redisClient == nil {
		keyUsageLimiterUnavailable(c)
		return nil, false
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	member := common.NewRequestId()
	retryAfter, err := redisClient.Eval(ctx, keyUsageAttemptScript, []string{key},
		keyUsageFailureLimit, keyUsageFailureWindow, member).Int64()
	if err != nil {
		keyUsageLimiterUnavailable(c)
		return nil, false
	}
	if retryAfter > 0 {
		keyUsageRateLimited(c, retryAfter)
		return nil, false
	}
	return func(failed bool) {
		if failed {
			return
		}
		// 请求结束或断开后仍需归还已占用的额度。
		ctx, cancel := context.WithTimeout(context.WithoutCancel(c.Request.Context()), 2*time.Second)
		defer cancel()
		if err := redisClient.ZRem(ctx, key, member).Err(); err != nil {
			common.SysError(common.LogText("failed to release public API key usage attempt"))
		}
	}, true
}

func AllowKeyUsage(c *gin.Context, id int, public, export bool) bool {
	if id <= 0 {
		common.ApiErrorStatus(c, http.StatusUnauthorized, common.NewMessage("Unauthorized"))
		return false
	}
	if public {
		subject := "token:" + strconv.Itoa(id)
		return takeKeyUsageLimit(c, subject, 20, 60) &&
			(!export || takeKeyUsageLimit(c, "export:"+subject, 3, 60))
	}
	subject := "user:" + strconv.Itoa(id)
	return takeKeyUsageLimit(c, subject, 60, 60) &&
		(!export || takeKeyUsageLimit(c, "export:"+subject, 5, 60))
}
