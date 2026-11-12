package controller

import (
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func upstreamRateAPIError(c *gin.Context, err error) {
	status, message := http.StatusInternalServerError, "Unable to load or save upstream rate data"
	switch {
	case errors.Is(err, service.ErrUpstreamRateConfig), errors.Is(err, service.ErrUpstreamRateEncryption):
		status, message = http.StatusBadRequest, err.Error()
	case errors.Is(err, service.ErrUpstreamRateBusy), errors.Is(err, service.ErrUpstreamRateCooldown):
		status, message = http.StatusConflict, err.Error()
	}
	common.ApiErrorStatus(c, status, errors.New(message))
}

func GetUpstreamRateConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	view, err := service.GetUpstreamRateConfig(c.Request.Context())
	if err != nil {
		upstreamRateAPIError(c, err)
		return
	}
	common.ApiSuccess(c, view)
}

func SaveUpstreamRateSource(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
	var input service.UpstreamRateSourceInput
	if err := c.ShouldBindJSON(&input); err != nil {
		upstreamRateAPIError(c, service.ErrUpstreamRateConfig)
		return
	}
	if err := service.SaveUpstreamRateSource(c.Request.Context(), input); err != nil {
		upstreamRateAPIError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func DeleteUpstreamRateSource(c *gin.Context) {
	if err := service.DeleteUpstreamRateSource(c.Request.Context(), c.Param("source_id")); err != nil {
		upstreamRateAPIError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func GetUpstreamRates(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	values := strings.Split(c.Query("ids"), ",")
	if len(values) > 200 {
		upstreamRateAPIError(c, service.ErrUpstreamRateConfig)
		return
	}
	ids := make([]int, 0, len(values))
	for _, value := range values {
		id, err := strconv.Atoi(value)
		if err != nil || id <= 0 {
			upstreamRateAPIError(c, service.ErrUpstreamRateConfig)
			return
		}
		if !slices.Contains(ids, id) {
			ids = append(ids, id)
		}
	}
	views, err := service.GetUpstreamRates(c.Request.Context(), ids)
	if err != nil {
		upstreamRateAPIError(c, err)
		return
	}
	common.ApiSuccess(c, views)
}

func RefreshUpstreamRates(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var input struct {
		SourceID  string `json:"source_id"`
		ChannelID int    `json:"channel_id"`
		Force     bool   `json:"force"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		upstreamRateAPIError(c, service.ErrUpstreamRateConfig)
		return
	}
	task, err := service.EnqueueUpstreamRateRefresh(c.Request.Context(), input.SourceID, input.ChannelID, input.Force)
	if err != nil {
		upstreamRateAPIError(c, err)
		return
	}
	// 只返回已知任务的脱敏状态，不公开系统任务内部 payload 和执行节点。
	common.ApiSuccess(c, gin.H{"task_id": task.TaskID, "status": task.Status})
}

func GetUpstreamRateTask(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	task, err := service.GetUpstreamRateTask(c.Param("task_id"))
	if err != nil {
		upstreamRateAPIError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"task_id": task.TaskID, "status": task.Status, "error": task.Error, "result": task.Result})
}

// GetUpstreamRateGuard 返回「上游倍率高于分组倍率时自动禁用渠道」是否开启。
func GetUpstreamRateGuard(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	enabled, err := service.GetUpstreamRateGuardEnabled(c.Request.Context())
	if err != nil {
		upstreamRateAPIError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"enabled": enabled})
}

// SaveUpstreamRateGuard 开关自动禁用。开启后立即检查一次，关闭时恢复由它禁用的渠道。
func SaveUpstreamRateGuard(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
	var input struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		upstreamRateAPIError(c, service.ErrUpstreamRateConfig)
		return
	}
	if err := service.SetUpstreamRateGuardEnabled(c.Request.Context(), input.Enabled); err != nil {
		upstreamRateAPIError(c, err)
		return
	}
	action := "channel.upstream_rate_guard_disable"
	if input.Enabled {
		action = "channel.upstream_rate_guard_enable"
	}
	recordManageAudit(c, action, nil)
	common.ApiSuccess(c, gin.H{"enabled": input.Enabled})
}
