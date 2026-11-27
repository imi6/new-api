package controller

import (
	"math"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
)

type sub2APIKeyBillingResponse struct {
	Object                  string    `json:"object"`
	SchemaVersion           int       `json:"schema_version"`
	BillingScope            string    `json:"billing_scope"`
	GroupRateMultiplier     float64   `json:"group_rate_multiplier"`
	UserRateMultiplier      *float64  `json:"user_rate_multiplier,omitempty"`
	ResolvedRateMultiplier  float64   `json:"resolved_rate_multiplier"`
	PeakRateEnabled         bool      `json:"peak_rate_enabled"`
	EffectiveRateMultiplier float64   `json:"effective_rate_multiplier"`
	ObservedAt              time.Time `json:"observed_at"`
}

func GetSub2APIKeyBilling(c *gin.Context) {
	usingGroup := common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
	if usingGroup == "auto" {
		common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("Billing multiplier is unavailable for Auto groups"))
		return
	}

	groupRate, exists := ratio_setting.LookupGroupRatio(usingGroup)
	if !exists {
		common.ApiErrorStatus(c, http.StatusForbidden, common.NewMessage("The API key's billing group is unavailable"))
		return
	}
	userGroup := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
	resolvedRate := groupRate
	var userRateOverride *float64
	if userRate, hasOverride := ratio_setting.GetGroupGroupRatio(userGroup, usingGroup); hasOverride {
		resolvedRate = userRate
		userRateOverride = &userRate
	}
	for _, rate := range []float64{groupRate, resolvedRate} {
		if rate < 0 || math.IsNaN(rate) || math.IsInf(rate, 0) {
			common.ApiErrorStatus(c, http.StatusInternalServerError, common.NewMessage("Billing multiplier is unavailable"))
			return
		}
	}

	// sub2api 直接解析顶层字段，关闭高峰时基准和当前倍率一致。
	c.JSON(http.StatusOK, sub2APIKeyBillingResponse{
		Object:                  "sub2api.key_billing",
		SchemaVersion:           1,
		BillingScope:            "token",
		GroupRateMultiplier:     groupRate,
		UserRateMultiplier:      userRateOverride,
		ResolvedRateMultiplier:  resolvedRate,
		PeakRateEnabled:         false,
		EffectiveRateMultiplier: resolvedRate,
		ObservedAt:              time.Now().UTC(),
	})
}
