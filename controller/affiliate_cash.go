package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetAffiliateCashSummary(c *gin.Context) {
	result, err := model.GetAffiliateCashSummary(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func PreviewAffiliateCashExchange(c *gin.Context) {
	var req model.AffiliateExchangeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	result, err := model.PreviewAffiliateCashExchange(c.GetInt("id"), req)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func ExchangeAffiliateCash(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	var req model.AffiliateExchangeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	result, err := model.ExchangeAffiliateCash(c.GetInt("id"), req)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func affiliateCashPage(c *gin.Context) *common.PageInfo {
	page := common.GetPageQuery(c)
	page.Page = min(max(page.Page, 1), 1000000)
	page.PageSize = min(max(page.PageSize, 1), 100)
	return page
}

func GetAffiliateCashLedger(c *gin.Context) {
	page := affiliateCashPage(c)
	if err := model.GetAffiliateCashLedger(c.GetInt("id"), page); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, page)
}

func PreviewAffiliateWithdrawal(c *gin.Context) {
	var req model.AffiliateWithdrawalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	result, err := model.PreviewAffiliateWithdrawal(c.GetInt("id"), req)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func CreateAffiliateWithdrawal(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	var req model.AffiliateWithdrawalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	result, err := model.CreateAffiliateWithdrawal(c.GetInt("id"), req)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func GetMyAffiliateWithdrawals(c *gin.Context) {
	page := affiliateCashPage(c)
	if err := model.ListAffiliateWithdrawals(c.GetInt("id"), "", page); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, page)
}

func CancelAffiliateWithdrawal(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	var req model.AffiliateWithdrawalAction
	if err != nil || id <= 0 || c.ShouldBindJSON(&req) != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	req.Action = "cancel"
	result, err := model.ActOnAffiliateWithdrawal(id, c.GetInt("id"), false, req)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func AdminGetAffiliateCashSettings(c *gin.Context) {
	result, err := model.GetAffiliateCashSettings()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func AdminSaveAffiliateCashSettings(c *gin.Context) {
	var req model.AffiliateCashSettings
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if (req.ExchangeEnabled || req.WithdrawalEnabled) && !requirePaymentCompliance(c) {
		return
	}
	result, err := model.SaveAffiliateCashSettings(req)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func AdminGetAffiliateCashTotals(c *gin.Context) {
	result, err := model.GetAffiliateCashTotals()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func AdminGetAffiliateWithdrawals(c *gin.Context) {
	page := affiliateCashPage(c)
	if err := model.ListAffiliateWithdrawals(0, c.Query("status"), page); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, page)
}

func AdminGetAffiliateWithdrawal(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	result, err := model.GetAffiliateWithdrawalDetail(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func AdminActOnAffiliateWithdrawal(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	var req model.AffiliateWithdrawalAction
	if err != nil || id <= 0 || c.ShouldBindJSON(&req) != nil || req.Action == "cancel" {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	result, err := model.ActOnAffiliateWithdrawal(id, c.GetInt("id"), true, req)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}
