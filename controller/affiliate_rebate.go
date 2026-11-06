package controller

import (
	"strconv"

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

// AdminGetAffiliateSummary serves the referral totals of the whole site.
func AdminGetAffiliateSummary(c *gin.Context) {
	summary, err := model.GetAffiliateAdminSummary()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, summary)
}

// AdminGetAffiliateInviters serves one page of the referral ranking.
func AdminGetAffiliateInviters(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	rows, total, err := model.GetAffiliateInviters(c.Query("keyword"), c.Query("sort_by"), c.Query("sort_order"), pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(rows)
	common.ApiSuccess(c, pageInfo)
}

// AdminGetAffiliateInviter serves one inviter's invitees and claims.
func AdminGetAffiliateInviter(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	detail, err := model.GetAffiliateAdminDetail(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, detail)
}

// AdminGetAffiliateClaims serves the rebate claims, newest first.
func AdminGetAffiliateClaims(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	startTs, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTs, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	claims, total, sum, err := model.GetAffiliateClaims(c.Query("keyword"), startTs, endTs, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(claims)
	common.ApiSuccess(c, gin.H{"page": pageInfo, "sum": sum})
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
