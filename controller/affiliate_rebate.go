package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

func GetAffiliateRebate(c *gin.Context) {
	summary, err := model.GetAffiliateRebateSummary(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, summary)
}

type claimAffiliateRebateRequest struct {
	Quota int `json:"quota"`
}

func ClaimAffiliateRebate(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	var req claimAffiliateRebateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := model.ClaimAffiliateRebate(c.GetInt("id"), req.Quota); err != nil {
		common.ApiError(c, err)
		return
	}
	model.RecordLog(c.GetInt("id"), model.LogTypeSystem, common.NewMessage("Claimed referral rebate {{quota}}", map[string]any{"quota": logger.FormatQuota(req.Quota)}))
	common.ApiSuccess(c, nil)
}
