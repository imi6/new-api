package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

var (
	ErrInvalidUserQuotaAdjustment = errors.New("invalid user quota adjustment")
	ErrUserQuotaPermission        = errors.New("cannot adjust quota for this user role")
)

// UserQuotaAdjustment is the immutable database snapshot of a committed manual
// adjustment. Pending relay deductions in the quota cache are not part of it.
type UserQuotaAdjustment struct {
	UserID   int
	Username string
	Before   int
	After    int
}

func AdjustUserQuota(userID, operatorRole int, mode string, value int) (*UserQuotaAdjustment, error) {
	if userID <= 0 || (mode != "add" && mode != "subtract" && mode != "override") {
		return nil, ErrInvalidUserQuotaAdjustment
	}
	if mode != "override" && value <= 0 {
		return nil, ErrInvalidUserQuotaAdjustment
	}
	if value > common.MaxWalletQuota || value < -common.MaxWalletQuota {
		return nil, ErrWalletQuotaLimitExceeded
	}

	var adjustment UserQuotaAdjustment
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).First(&user, userID).Error; err != nil {
			return err
		}
		if operatorRole != common.RoleRootUser && operatorRole <= user.Role {
			return ErrUserQuotaPermission
		}
		if user.Quota > common.MaxWalletQuota || user.Quota < -common.MaxWalletQuota {
			return ErrWalletQuotaLimitExceeded
		}
		quota := decimal.NewFromInt(int64(value))
		switch mode {
		case "add":
			quota = decimal.NewFromInt(int64(user.Quota)).Add(quota)
		case "subtract":
			quota = decimal.NewFromInt(int64(user.Quota)).Sub(quota)
		}
		after, err := common.WalletQuotaFromDecimalStrict(quota)
		if err != nil {
			return ErrWalletQuotaLimitExceeded
		}
		// An unchanged override is a successful operation, including on MySQL
		// configurations that count only changed rows in RowsAffected.
		if after != user.Quota {
			result := tx.Model(&User{}).Where("id = ?", userID).Update("quota", after)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return gorm.ErrRecordNotFound
			}
			deltaQuota := after - user.Quota
			if deltaQuota > 0 {
				if err := tx.Model(&User{}).Where("id = ?", userID).
					Update("unpaid_quota_balance", gorm.Expr("unpaid_quota_balance + ?", deltaQuota)).Error; err != nil {
					return err
				}
			} else if deltaQuota < 0 {
				reduce := -deltaQuota
				if err := tx.Model(&User{}).Where("id = ?", userID).
					Update("unpaid_quota_balance", gorm.Expr("CASE WHEN unpaid_quota_balance >= ? THEN unpaid_quota_balance - ? ELSE 0 END", reduce, reduce)).Error; err != nil {
					return err
				}
			}
		}
		adjustment = UserQuotaAdjustment{UserID: user.Id, Username: user.Username, Before: user.Quota, After: after}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// Apply only the committed difference, preserving outstanding reservations.
	// Both balances are bounded above, so their difference fits in int64.
	delta := int64(adjustment.After) - int64(adjustment.Before)
	if delta != 0 {
		if err := cacheIncrUserQuota(userID, delta); err != nil {
			common.SysError(common.LogText("failed to sync manual quota adjustment for user %d: %s", userID, err))
		}
	}
	return &adjustment, nil
}

// AdjustAffiliateRebate lets an administrator directly manipulate a user's
// referral rebate balance without the normal eligibility checks.
//
// mode "grant": transfer the given quota from rebate to the wallet, exactly
// like ClaimAffiliateRebate but with no percent/window/threshold guard.
// Both quota and affiliate_rebate_claimed increase by the same amount.
//
// mode "revoke": mark the given quota as already-claimed without crediting
// the wallet, shrinking the claimable balance. Useful to claw back an
// over-credited amount. Only affiliate_rebate_claimed increases.
func AdjustAffiliateRebate(userID, operatorRole int, mode string, value int) (*UserQuotaAdjustment, error) {
	if userID <= 0 || (mode != "grant" && mode != "revoke") {
		return nil, ErrInvalidUserQuotaAdjustment
	}
	if value <= 0 {
		return nil, ErrInvalidUserQuotaAdjustment
	}
	if value > common.MaxWalletQuota {
		return nil, ErrWalletQuotaLimitExceeded
	}

	var adjustment UserQuotaAdjustment
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id", "username", "role", "quota", "unpaid_quota_balance", "affiliate_rebate_claimed").
			First(&user, userID).Error; err != nil {
			return err
		}
		if operatorRole != common.RoleRootUser && operatorRole <= user.Role {
			return ErrUserQuotaPermission
		}
		before := user.AffiliateRebateClaimed
		updates := map[string]any{
			"affiliate_rebate_claimed": gorm.Expr("affiliate_rebate_claimed + ?", value),
		}
		if mode == "grant" {
			if user.Quota > common.MaxWalletQuota-value {
				return ErrWalletQuotaLimitExceeded
			}
			updates["quota"] = gorm.Expr("quota + ?", value)
			updates["unpaid_quota_balance"] = gorm.Expr("unpaid_quota_balance + ?", value)
		}
		result := tx.Model(&User{}).Where("id = ?", userID).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		adjustment = UserQuotaAdjustment{UserID: user.Id, Username: user.Username, Before: before, After: before + value}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if mode == "grant" {
		// sync wallet quota delta to Redis so the change is immediately visible
		if err := cacheIncrUserQuota(userID, int64(value)); err != nil {
			common.SysError(common.LogText("failed to sync affiliate rebate grant for user %d: %s", userID, err))
		}
	}
	return &adjustment, nil
}
// given mode and value. Unlike wallet quota it is not mirrored in Redis, so no
// cache update is needed. Only add and subtract are supported; override is not
// because the field has no separate "used" counter to reconcile against.
func AdjustAffQuota(userID, operatorRole int, mode string, value int) (*UserQuotaAdjustment, error) {
	if userID <= 0 || (mode != "add" && mode != "subtract") {
		return nil, ErrInvalidUserQuotaAdjustment
	}
	if value <= 0 {
		return nil, ErrInvalidUserQuotaAdjustment
	}
	if value > common.MaxWalletQuota {
		return nil, ErrWalletQuotaLimitExceeded
	}

	var adjustment UserQuotaAdjustment
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id", "username", "role", "aff_quota", "aff_history").
			First(&user, userID).Error; err != nil {
			return err
		}
		if operatorRole != common.RoleRootUser && operatorRole <= user.Role {
			return ErrUserQuotaPermission
		}
		before := user.AffQuota
		after := before
		switch mode {
		case "add":
			after = before + value
			if after < before { // overflow guard
				return ErrWalletQuotaLimitExceeded
			}
		case "subtract":
			after = before - value
			if after < 0 {
				after = 0
			}
		}
		if after == before {
			adjustment = UserQuotaAdjustment{UserID: user.Id, Username: user.Username, Before: before, After: after}
			return nil
		}
		result := tx.Model(&User{}).Where("id = ?", userID).Update("aff_quota", after)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		adjustment = UserQuotaAdjustment{UserID: user.Id, Username: user.Username, Before: before, After: after}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &adjustment, nil
}
