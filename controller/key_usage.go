package controller

import (
	"context"
	"errors"
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	keyUsageSecondsPerDay = 24 * 60 * 60
	keyUsageExportLimit   = 1000
	keyUsageQueryTimeout  = 10 * time.Second
)

type keyUsageTokenSummary struct {
	TotalGranted   int   `json:"total_granted"`
	TotalUsed      int   `json:"total_used"`
	TotalAvailable int   `json:"total_available"`
	UnlimitedQuota bool  `json:"unlimited_quota"`
	ExpiresAt      int64 `json:"expires_at"`
	Status         int   `json:"status"`
}

func GetPublicKeyUsageSettings(c *gin.Context) {
	settings := operation_setting.LogSettingsSnapshot()
	common.OptionMapRWMutex.RLock()
	consumeLogEnabled := common.LogConsumeEnabled
	common.OptionMapRWMutex.RUnlock()
	common.ApiSuccess(c, gin.H{
		"enabled":             settings.PublicKeyUsageEnabled,
		"export_enabled":      settings.PublicKeyUsageEnabled && settings.UserExportEnabled,
		"max_range_days":      max(settings.MaxRangeDays, 1),
		"consume_log_enabled": consumeLogEnabled,
	})
}

func OwnKeyUsage(export bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetInt("id")
		if !middleware.AllowKeyUsage(c, userID, false, export) {
			return
		}
		id, err := strconv.Atoi(c.Param("id"))
		if err != nil || id <= 0 {
			common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), keyUsageQueryTimeout)
		defer cancel()
		token, err := model.GetTokenByIdsContext(ctx, id, userID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("API key is invalid or unavailable"))
			return
		}
		if err != nil {
			common.ApiErrorStatus(c, http.StatusInternalServerError, common.NewMessage("Failed to query logs"))
			return
		}
		serveKeyUsage(ctx, c, token, operation_setting.LogSettingsSnapshot(), export)
	}
}

func PublicKeyUsage(export bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		settings := operation_setting.LogSettingsSnapshot()
		if !settings.PublicKeyUsageEnabled {
			common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("Public API key usage lookup is disabled"))
			return
		}
		if !publicKeyUsageSameOrigin(c.Request) {
			common.ApiErrorStatus(c, http.StatusForbidden, common.NewMessage("Access Forbidden"))
			return
		}
		complete, release, ok := middleware.AdmitPublicKeyUsage(c)
		if !ok {
			return
		}
		defer release()

		invalid := false
		defer func() {
			if complete != nil {
				complete(invalid)
			}
		}()
		key := publicKeyUsageBearer(c.Request)
		if key == "" {
			invalid = true
			common.ApiErrorStatus(c, http.StatusUnauthorized, common.NewMessage("API key is invalid or unavailable"))
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), keyUsageQueryTimeout)
		defer cancel()
		token, err := model.GetPublicKeyUsageToken(ctx, key)
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			common.SysError(common.LogText("public API key usage credential lookup failed"))
			common.ApiErrorStatus(c, http.StatusInternalServerError, common.NewMessage("Failed to query logs"))
			return
		}
		if token == nil || (token.Status != common.TokenStatusEnabled && token.Status != common.TokenStatusExpired && token.Status != common.TokenStatusExhausted) {
			invalid = true
			common.ApiErrorStatus(c, http.StatusUnauthorized, common.NewMessage("API key is invalid or unavailable"))
			return
		}
		if allowIPs := token.GetIpLimits(); len(allowIPs) > 0 {
			ip := net.ParseIP(c.ClientIP())
			if ip == nil || !common.IsIpInCIDRList(ip, allowIPs) {
				invalid = true
				common.ApiErrorStatus(c, http.StatusUnauthorized, common.NewMessage("API key is invalid or unavailable"))
				return
			}
		}
		complete(false)
		complete = nil
		if !middleware.AllowKeyUsage(c, token.Id, true, export) {
			return
		}
		serveKeyUsage(ctx, c, token, settings, export)
	}
}

// publicKeyUsageBearer 仅接受完整平台密钥，拒绝兼容旧接口的后缀和其他认证格式。
func publicKeyUsageBearer(r *http.Request) string {
	headers := r.Header.Values("Authorization")
	if len(headers) != 1 || len(headers[0]) > len("Bearer sk-")+128 {
		return ""
	}
	scheme, credential, ok := strings.Cut(headers[0], " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return ""
	}
	key, ok := strings.CutPrefix(credential, "sk-")
	if !ok || key == "" {
		return ""
	}
	for i := range len(key) {
		ch := key[i]
		if !(ch >= '0' && ch <= '9' || ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z') {
			return ""
		}
	}
	return key
}

// publicKeyUsageSameOrigin 禁止显式跨源请求。浏览器必须预检跨源 Authorization，
// 此接口也不注册 CORS，源站经反向代理终止 TLS 时仍可使用。
func publicKeyUsageSameOrigin(r *http.Request) bool {
	switch r.Header.Get("Sec-Fetch-Site") {
	case "", "same-origin", "none":
	default:
		return false
	}
	origins := r.Header.Values("Origin")
	if len(origins) == 0 {
		return true
	}
	if len(origins) != 1 {
		return false
	}
	origin, err := common.NormalizeOrigin(origins[0])
	if err != nil {
		return false
	}
	scheme, _, _ := strings.Cut(origin, "://")
	if r.TLS != nil && scheme != "https" {
		return false
	}
	expected, err := common.NormalizeOrigin(scheme + "://" + r.Host)
	return err == nil && origin == expected
}

func serveKeyUsage(ctx context.Context, c *gin.Context, token *model.Token, settings operation_setting.LogSetting, export bool) {
	if export && !settings.UserExportEnabled {
		common.ApiErrorStatus(c, http.StatusForbidden, common.NewMessage("Log export is disabled"))
		return
	}
	now := common.GetTimestamp()
	maxRangeDays := max(settings.MaxRangeDays, 1)
	maxRange := min(int64(maxRangeDays), math.MaxInt64/keyUsageSecondsPerDay) * keyUsageSecondsPerDay
	filter := model.LogFilter{
		EndTimestamp: now,
		ModelName:    strings.TrimSpace(c.Query("model_name")),
	}
	if len(filter.ModelName) > 255 || !utf8.ValidString(filter.ModelName) || strings.ContainsRune(filter.ModelName, '\x00') {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
		return
	}
	for _, bound := range []struct {
		Name  string
		Value *int64
	}{{"start_timestamp", &filter.StartTimestamp}, {"end_timestamp", &filter.EndTimestamp}} {
		if raw, present := c.GetQuery(bound.Name); present {
			value, err := strconv.ParseInt(raw, 10, 64)
			if err != nil || value <= 0 {
				common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
				return
			}
			*bound.Value = value
		}
	}
	filter.EndTimestamp = min(filter.EndTimestamp, now)
	if filter.StartTimestamp == 0 {
		filter.StartTimestamp = max(1, filter.EndTimestamp-min(maxRange, 7*keyUsageSecondsPerDay))
	}
	if filter.StartTimestamp > filter.EndTimestamp {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
		return
	}
	if filter.EndTimestamp-filter.StartTimestamp > maxRange {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("The time range cannot exceed {{days}} days", map[string]any{"days": maxRangeDays}))
		return
	}
	page, pageSize := 1, 20
	if !export {
		for _, param := range []struct {
			Name  string
			Value *int
			Max   int
		}{{"p", &page, model.KeyUsageLogSearchLimit}, {"page_size", &pageSize, 100}} {
			if raw, present := c.GetQuery(param.Name); present {
				value, err := strconv.Atoi(raw)
				if err != nil || value < 1 || value > param.Max {
					common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
					return
				}
				*param.Value = value
			}
		}
	}
	offset, limit := (page-1)*pageSize, pageSize
	if offset >= model.KeyUsageLogSearchLimit {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
		return
	}
	limit = min(limit, model.KeyUsageLogSearchLimit-offset)
	if export {
		release, acquired, err := service.AcquireLogExportLock(token.UserId)
		if err != nil {
			common.SysError(common.LogText("failed to lock log export: %s", err.Error()))
			common.ApiErrorStatus(c, http.StatusInternalServerError, common.NewMessage("Failed to export logs"))
			return
		}
		if !acquired {
			common.ApiErrorStatus(c, http.StatusTooManyRequests, common.NewMessage("Another log export is running. Try again after it finishes."))
			return
		}
		defer release()
		limit = keyUsageExportLimit + 1
	}
	items, total, capped, err := model.ListKeyUsageLogs(ctx, token, filter, offset, limit, !export)
	if err != nil {
		common.SysError(common.LogText("failed to search key usage logs"))
		common.ApiErrorStatus(c, http.StatusInternalServerError, common.NewMessage("Failed to query logs"))
		return
	}
	if export {
		if len(items) > keyUsageExportLimit {
			common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Too many records to export. Narrow the date range and try again."))
			return
		}
		common.ApiSuccess(c, gin.H{"items": items})
		return
	}
	status := token.Status
	if status == common.TokenStatusEnabled {
		switch {
		case token.ExpiredTime != -1 && token.ExpiredTime < now:
			status = common.TokenStatusExpired
		case !token.UnlimitedQuota && token.RemainQuota <= 0:
			status = common.TokenStatusExhausted
		}
	}
	common.OptionMapRWMutex.RLock()
	consumeLogEnabled := common.LogConsumeEnabled
	common.OptionMapRWMutex.RUnlock()
	common.ApiSuccess(c, gin.H{
		"token": keyUsageTokenSummary{
			TotalGranted:   token.UsedQuota + token.RemainQuota,
			TotalUsed:      token.UsedQuota,
			TotalAvailable: token.RemainQuota,
			UnlimitedQuota: token.UnlimitedQuota,
			ExpiresAt:      max(token.ExpiredTime, 0),
			Status:         status,
		},
		"items":               items,
		"total":               total,
		"total_is_capped":     capped,
		"p":                   page,
		"page_size":           pageSize,
		"export_enabled":      settings.UserExportEnabled,
		"max_range_days":      maxRangeDays,
		"start_timestamp":     filter.StartTimestamp,
		"end_timestamp":       filter.EndTimestamp,
		"consume_log_enabled": consumeLogEnabled,
	})
}
