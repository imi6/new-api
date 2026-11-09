package controller

import (
	"errors"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func manageUserQuota(c *gin.Context, req ManageRequest) {
	action := "generic"
	params := model.AuditFields{
		"target_user_id":  req.Id,
		"mode":            req.Mode,
		"requested_quota": req.Value,
	}
	switch req.Mode {
	case "add":
		action = "user.quota_add"
	case "subtract":
		action = "user.quota_subtract"
	case "override":
		action = "user.quota_override"
	default:
		params["action"] = "add_quota"
		params["method"] = c.Request.Method
		params["route"] = c.FullPath()
	}
	success := false
	defer func() {
		content := auditContentEN(action, params)
		if !success {
			// Failed requests have no committed balance changes to render.
			content = "Failed user quota adjustment"
		}
		model.RecordOperationAuditLog(c.GetInt("id"), c.GetInt("role"), content, c.ClientIP(), action, params,
			auditOperatorInfo(c), &model.AuditRequestInfo{
				Method: c.Request.Method, Route: c.FullPath(), Status: c.Writer.Status(), Success: success,
			}, c)
		markAuditLogged(c)
	}()

	adjustment, err := model.AdjustUserQuota(req.Id, c.GetInt("role"), req.Mode, req.Value)
	if err != nil {
		switch {
		case errors.Is(err, model.ErrInvalidUserQuotaAdjustment):
			params["failure_reason"] = "invalid_parameters"
			if (req.Mode == "add" || req.Mode == "subtract") && req.Value <= 0 {
				common.ApiErrorT(c, "Quota change amount cannot be zero")
			} else {
				common.ApiErrorT(c, "Invalid parameters")
			}
		case errors.Is(err, model.ErrUserQuotaPermission):
			params["failure_reason"] = "permission_denied"
			common.ApiErrorT(c, "No permission to update users of same or higher permission level")
		case errors.Is(err, gorm.ErrRecordNotFound):
			params["failure_reason"] = "target_not_found"
			common.ApiErrorT(c, "User does not exist")
		case errors.Is(err, model.ErrWalletQuotaLimitExceeded):
			params["failure_reason"] = "quota_limit_exceeded"
			common.ApiError(c, err)
		default:
			params["failure_reason"] = "database_error"
			common.ApiError(c, err)
		}
		return
	}

	params["target_username"] = adjustment.Username
	params["from"] = adjustment.Before
	params["to"] = adjustment.After
	if req.Mode != "override" {
		params["quota"] = req.Value
	}
	success = true
	operation := model.AuditOperation{Action: action, Params: params}
	model.RecordLogWithAdminInfo(adjustment.UserID, model.LogTypeTopup,
		auditContentEN(action, params), auditOperatorInfo(c), &operation, c)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// manageUserAffQuota adjusts a user's referral program quota (aff_quota).
// Supports add and subtract only; override is not meaningful for this field.
func manageUserAffQuota(c *gin.Context, req ManageRequest) {
	action := "generic"
	params := model.AuditFields{
		"target_user_id":  req.Id,
		"mode":            req.Mode,
		"requested_quota": req.Value,
	}
	switch req.Mode {
	case "add":
		action = "user.aff_quota_add"
	case "subtract":
		action = "user.aff_quota_subtract"
	default:
		params["action"] = "add_aff_quota"
	}
	success := false
	defer func() {
		content := auditContentEN(action, params)
		if !success {
			content = "Failed aff quota adjustment"
		}
		model.RecordOperationAuditLog(c.GetInt("id"), c.GetInt("role"), content, c.ClientIP(), action, params,
			auditOperatorInfo(c), &model.AuditRequestInfo{
				Method: c.Request.Method, Route: c.FullPath(), Status: c.Writer.Status(), Success: success,
			}, c)
		markAuditLogged(c)
	}()

	adjustment, err := model.AdjustAffQuota(req.Id, c.GetInt("role"), req.Mode, req.Value)
	if err != nil {
		switch {
		case errors.Is(err, model.ErrInvalidUserQuotaAdjustment):
			params["failure_reason"] = "invalid_parameters"
			common.ApiErrorT(c, "Quota change amount cannot be zero")
		case errors.Is(err, model.ErrUserQuotaPermission):
			params["failure_reason"] = "permission_denied"
			common.ApiErrorT(c, "No permission to update users of same or higher permission level")
		case errors.Is(err, gorm.ErrRecordNotFound):
			params["failure_reason"] = "target_not_found"
			common.ApiErrorT(c, "User does not exist")
		case errors.Is(err, model.ErrWalletQuotaLimitExceeded):
			params["failure_reason"] = "quota_limit_exceeded"
			common.ApiError(c, err)
		default:
			params["failure_reason"] = "database_error"
			common.ApiError(c, err)
		}
		return
	}

	params["target_username"] = adjustment.Username
	params["from"] = adjustment.Before
	params["to"] = adjustment.After
	params["quota"] = req.Value
	success = true
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// manageUserAffiliateRebate lets an admin grant (transfer rebate → wallet) or
// revoke (mark as claimed without crediting wallet) a user's rebate balance.
func manageUserAffiliateRebate(c *gin.Context, req ManageRequest) {
	mode := "grant"
	if req.Action == "revoke_affiliate_rebate" {
		mode = "revoke"
	}
	action := "user.affiliate_rebate_" + mode
	params := model.AuditFields{
		"target_user_id":  req.Id,
		"mode":            mode,
		"requested_quota": req.Value,
	}
	success := false
	defer func() {
		content := auditContentEN(action, params)
		if !success {
			content = "Failed affiliate rebate adjustment"
		}
		model.RecordOperationAuditLog(c.GetInt("id"), c.GetInt("role"), content, c.ClientIP(), action, params,
			auditOperatorInfo(c), &model.AuditRequestInfo{
				Method: c.Request.Method, Route: c.FullPath(), Status: c.Writer.Status(), Success: success,
			}, c)
		markAuditLogged(c)
	}()

	adjustment, err := model.AdjustAffiliateRebate(req.Id, c.GetInt("role"), mode, req.Value, c.GetInt("id"))
	if err != nil {
		switch {
		case errors.Is(err, model.ErrInvalidUserQuotaAdjustment):
			params["failure_reason"] = "invalid_parameters"
			common.ApiErrorT(c, "Quota change amount cannot be zero")
		case errors.Is(err, model.ErrUserQuotaPermission):
			params["failure_reason"] = "permission_denied"
			common.ApiErrorT(c, "No permission to update users of same or higher permission level")
		case errors.Is(err, gorm.ErrRecordNotFound):
			params["failure_reason"] = "target_not_found"
			common.ApiErrorT(c, "User does not exist")
		case errors.Is(err, model.ErrWalletQuotaLimitExceeded):
			params["failure_reason"] = "quota_limit_exceeded"
			common.ApiError(c, err)
		default:
			params["failure_reason"] = "database_error"
			common.ApiError(c, err)
		}
		return
	}

	params["target_username"] = adjustment.Username
	params["from"] = adjustment.Before
	params["to"] = adjustment.After
	params["quota"] = req.Value
	success = true
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}
