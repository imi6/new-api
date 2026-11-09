package model

import (
	"errors"
	"fmt"
	"math"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const affiliateAccountBackfillOption = "internal.affiliate_account_backfilled_v1"

// AffiliateAccount 独立保存邀请人返利，累计扣减可以超过累计产生以保留历史差额。
type AffiliateAccount struct {
	UserID    int   `json:"user_id" gorm:"primaryKey;autoIncrement:false"`
	Accrued   int   `json:"accrued" gorm:"type:bigint;not null;default:0"`
	Claimed   int   `json:"claimed" gorm:"type:bigint;not null;default:0"`
	CreatedAt int64 `json:"created_at" gorm:"not null;autoCreateTime:false"`
	UpdatedAt int64 `json:"updated_at" gorm:"not null;autoUpdateTime:false"`
}

// AffiliateLedgerEntry 不依赖用户资料的存续；扣减用负数，产生用正数。
type AffiliateLedgerEntry struct {
	ID           int64  `json:"id" gorm:"primaryKey"`
	UserID       int    `json:"user_id" gorm:"not null;uniqueIndex:idx_affiliate_ledger_business,priority:1;index:idx_affiliate_ledger_user_time,priority:1"`
	BusinessID   string `json:"business_id" gorm:"size:128;not null;uniqueIndex:idx_affiliate_ledger_business,priority:2"`
	Kind         string `json:"kind" gorm:"size:32;not null;index"`
	Quota        int    `json:"quota" gorm:"type:bigint;not null"`
	SourceUserID int    `json:"source_user_id" gorm:"index"`
	ActorID      int    `json:"actor_id"`
	AccruedAfter int    `json:"accrued_after" gorm:"type:bigint;not null"`
	ClaimedAfter int    `json:"claimed_after" gorm:"type:bigint;not null"`
	CreatedAt    int64  `json:"created_at" gorm:"not null;autoCreateTime:false;index:idx_affiliate_ledger_user_time,priority:2"`
}

// AffiliateSettlementSource 在硬删除后保留迟到结算必需的账务状态，不保留身份资料或凭据。
// 只允许原消费结算入口更新，不能用于恢复登录、平台余额或领取资格。
type AffiliateSettlementSource struct {
	UserID                 int   `gorm:"primaryKey;autoIncrement:false"`
	InviterID              int   `gorm:"not null;index"`
	UnpaidQuotaBalance     int   `gorm:"type:bigint;not null"`
	PaidQuotaConsumed      int   `gorm:"type:bigint;not null"`
	AffiliateRebateCovered int   `gorm:"type:bigint;not null"`
	AffiliateRebateEarned  int   `gorm:"type:bigint;not null"`
	CreatedAt              int64 `gorm:"not null;autoCreateTime:false"`
	UpdatedAt              int64 `gorm:"not null;autoUpdateTime:false"`
}

// 调用者已锁定原用户，存根与硬删除须在同一事务内提交。
func preserveAffiliateSettlementSource(tx *gorm.DB, user *User) error {
	now := common.GetTimestamp()
	return tx.Create(&AffiliateSettlementSource{
		UserID: user.Id, InviterID: user.InviterId,
		UnpaidQuotaBalance: user.UnpaidQuotaBalance, PaidQuotaConsumed: user.PaidQuotaConsumed,
		AffiliateRebateCovered: user.AffiliateRebateCovered, AffiliateRebateEarned: user.AffiliateRebateEarned,
		CreatedAt: now, UpdatedAt: now,
	}).Error
}

// lockAffiliateAccount 的调用者按用户行、返利账户的顺序加锁。
// 新注册用户首次使用时建立零账户，存量用户必须在启动迁移时建立期初。
func lockAffiliateAccount(tx *gorm.DB, userID int) (*AffiliateAccount, error) {
	var existing AffiliateAccount
	if err := lockForUpdate(tx).First(&existing, "user_id = ?", userID).Error; err == nil {
		return &existing, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	done, err := affiliateMigrationDone(tx, affiliateAccountBackfillOption)
	if err != nil {
		return nil, err
	}
	if !done {
		return nil, common.NewMessage("Referral account migration is not complete")
	}
	var previousEntries int64
	if err := tx.Model(&AffiliateLedgerEntry{}).Where("user_id = ?", userID).Count(&previousEntries).Error; err != nil {
		return nil, err
	}
	if previousEntries > 0 {
		return nil, common.NewMessage("Referral account requires reconciliation")
	}
	now := common.GetTimestamp()
	account := AffiliateAccount{UserID: userID, CreatedAt: now, UpdatedAt: now}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&account).Error; err != nil {
		return nil, err
	}
	if err := lockForUpdate(tx).First(&account, "user_id = ?", userID).Error; err != nil {
		return nil, err
	}
	return &account, nil
}

// backfillAffiliateAccounts 只在维护窗口中的启动迁移执行，旧实例应先停止写入。
func backfillAffiliateAccounts() error {
	return DB.Transaction(func(tx *gorm.DB) error {
		done, err := affiliateMigrationDone(tx, affiliateAccountBackfillOption)
		if err != nil || done {
			return err
		}
		var users []User
		if err := tx.Unscoped().Select("id", "affiliate_rebate_claimed").Find(&users).Error; err != nil {
			return err
		}
		var sources []User
		// 沿用迁移前的有效记录口径，不在升级时自动补回已软删来源。
		if err := tx.Select("id", "inviter_id", "affiliate_rebate_earned").Where("inviter_id > 0 AND affiliate_rebate_earned <> 0").Find(&sources).Error; err != nil {
			return err
		}
		byInviter := make(map[int][]User)
		for _, source := range sources {
			byInviter[source.InviterId] = append(byInviter[source.InviterId], source)
		}
		now := common.GetTimestamp()
		for _, user := range users {
			account := AffiliateAccount{UserID: user.Id, Claimed: user.AffiliateRebateClaimed, CreatedAt: now, UpdatedAt: now}
			if account.Claimed < 0 || account.Claimed > common.MaxWalletQuota {
				return ErrWalletQuotaLimitExceeded
			}
			for _, source := range byInviter[user.Id] {
				if source.AffiliateRebateEarned < 0 || source.AffiliateRebateEarned > common.MaxWalletQuota-account.Accrued {
					return ErrWalletQuotaLimitExceeded
				}
				account.Accrued += source.AffiliateRebateEarned
			}
			created := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&account)
			if created.Error != nil {
				return created.Error
			}
			if created.RowsAffected == 0 {
				continue
			}
			for _, source := range byInviter[user.Id] {
				entry := AffiliateLedgerEntry{UserID: user.Id, BusinessID: fmt.Sprintf("opening:source:%d", source.Id), Kind: "opening_accrued", Quota: source.AffiliateRebateEarned, SourceUserID: source.Id, AccruedAfter: account.Accrued, ClaimedAfter: account.Claimed, CreatedAt: now}
				if err := tx.Create(&entry).Error; err != nil {
					return err
				}
			}
			if account.Claimed != 0 {
				// 旧明细保持原时间，只归档期初扣减，不重复进入近七天领取表。
				entry := AffiliateLedgerEntry{UserID: user.Id, BusinessID: "opening:deducted", Kind: "opening_deducted", Quota: -account.Claimed, AccruedAfter: account.Accrued, ClaimedAfter: account.Claimed, CreatedAt: now}
				if err := tx.Create(&entry).Error; err != nil {
					return err
				}
			}
		}
		return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&Option{Key: affiliateAccountBackfillOption, Value: "true"}).Error
	})
}

// recordAffiliateAccrualTx 使用现有结算计算出的实际差额，不能再次计算一遍返利。
func recordAffiliateAccrualTx(tx *gorm.DB, inviterID, sourceUserID, delta int) error {
	if delta == 0 {
		return nil
	}
	account, err := lockAffiliateAccount(tx, inviterID)
	if err != nil {
		return err
	}
	if (delta > 0 && delta > common.MaxWalletQuota-account.Accrued) || (delta < 0 && delta < -account.Accrued) {
		return ErrWalletQuotaLimitExceeded
	}
	account.Accrued += delta
	account.UpdatedAt = common.GetTimestamp()
	if err := tx.Model(account).Updates(map[string]any{"accrued": account.Accrued, "updated_at": account.UpdatedAt}).Error; err != nil {
		return err
	}
	kind := "earned"
	if delta < 0 {
		kind = "reversal"
	}
	return tx.Create(&AffiliateLedgerEntry{UserID: inviterID, BusinessID: uuid.NewString(), Kind: kind, Quota: delta, SourceUserID: sourceUserID, AccruedAfter: account.Accrued, ClaimedAfter: account.Claimed, CreatedAt: account.UpdatedAt}).Error
}

func affiliateClaimLimit(accrued, claimed, ownWeek, weekClaimed, paidConsumed int) (int, string) {
	if common.AffiliateRebatePercent <= 0 || math.IsNaN(common.AffiliateRebatePercent) || math.IsInf(common.AffiliateRebatePercent, 0) {
		return 0, "Referral rebate is disabled"
	}
	if paidConsumed < common.AffiliateRebateUpstreamQuota {
		return 0, "Your paid consumption is below the minimum required to claim referral rebate"
	}
	remaining := max(accrued-claimed, 0)
	if remaining == 0 {
		return 0, "The rebate amount exceeds the claimable balance"
	}
	allowed := decimal.NewFromInt(int64(max(ownWeek, 0))).Mul(decimal.NewFromFloat(common.AffiliateRebatePercent)).Div(decimal.NewFromInt(100)).Floor().Sub(decimal.NewFromInt(int64(weekClaimed)))
	allowed = decimal.Min(allowed, decimal.NewFromInt(int64(remaining)))
	if allowed.LessThan(decimal.NewFromFloat(common.QuotaPerUnit)) || allowed.IsNegative() {
		return 0, "Your remaining referral claim allowance is below the minimum amount"
	}
	quota, err := common.WalletQuotaFromDecimalStrict(allowed)
	if err != nil {
		return 0, "The rebate amount exceeds the claimable balance"
	}
	return quota, ""
}

// claimAffiliateRebateTx 先辨认已成功请求，再执行新的资格和额度校验。
// 调用者须先锁定有效用户，U 入账须与此函数处于同一事务内。
func claimAffiliateRebateTx(tx *gorm.DB, user *User, quota int, destination string, requestID string) (bool, error) {
	if user == nil || user.Id <= 0 || user.DeletedAt.Valid || user.Status != common.UserStatusEnabled {
		return false, common.NewMessage("User does not exist or is disabled")
	}
	if destination != "platform" && destination != "u" {
		return false, common.NewMessage("Invalid parameters")
	}
	if len(requestID) > 64 || strings.IndexFunc(requestID, func(r rune) bool { return r < 33 || r > 126 }) >= 0 {
		return false, common.NewMessage("Invalid parameters")
	}
	businessID := "claim:" + requestID
	if requestID != "" {
		var previous AffiliateLedgerEntry
		err := tx.Where("user_id = ? AND business_id = ?", user.Id, businessID).First(&previous).Error
		if err == nil {
			if previous.Kind != "claim_"+destination || previous.Quota != -quota {
				return false, common.NewMessage("This request ID has already been used for a different operation")
			}
			return true, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return false, err
		}
	} else {
		businessID += uuid.NewString()
	}
	if quota <= 0 || quota > common.MaxWalletQuota {
		return false, common.NewMessage("The rebate amount exceeds the claimable balance")
	}
	if float64(quota) < common.QuotaPerUnit {
		return false, common.NewMessage("Minimum transfer quota is {{min}}!", map[string]any{"min": logger.FormatQuota(common.QuotaFromFloat(common.QuotaPerUnit))})
	}
	if common.AffiliateRebatePercent <= 0 {
		return false, common.NewMessage("Referral rebate is disabled")
	}
	if user.PaidQuotaConsumed < common.AffiliateRebateUpstreamQuota {
		return false, common.NewMessage("Your paid consumption is below the minimum required to claim referral rebate")
	}
	account, err := lockAffiliateAccount(tx, user.Id)
	if err != nil {
		return false, err
	}
	if quota > max(account.Accrued-account.Claimed, 0) || account.Claimed > common.MaxWalletQuota-quota {
		return false, common.NewMessage("The rebate amount exceeds the claimable balance")
	}
	weekClaimed, err := recentClaimedRebate(tx, user.Id)
	if err != nil {
		return false, err
	}
	if weekClaimed < 0 || weekClaimed > common.MaxWalletQuota-quota {
		return false, ErrWalletQuotaLimitExceeded
	}
	required, err := rebateClaimConsumptionRequired(weekClaimed + quota)
	if err != nil {
		return false, err
	}
	ownWeek, err := recentPaidConsumption(tx, user.Id)
	if err != nil {
		return false, err
	}
	if ownWeek < required {
		return false, common.NewMessage("To claim {{amount}}, your paid consumption in the last 7 days must be at least {{required}}.", map[string]any{"amount": logger.FormatQuota(quota), "required": logger.FormatQuota(required)})
	}
	account.Claimed += quota
	account.UpdatedAt = common.GetTimestamp()
	updates := map[string]any{"affiliate_rebate_claimed": account.Claimed}
	if destination == "platform" {
		if user.Quota > common.MaxWalletQuota-quota || user.UnpaidQuotaBalance > common.MaxWalletQuota-quota {
			return false, ErrWalletQuotaLimitExceeded
		}
		updates["quota"] = gorm.Expr("quota + ?", quota)
		updates["unpaid_quota_balance"] = gorm.Expr("unpaid_quota_balance + ?", quota)
	}
	if err := tx.Model(&User{}).Where("id = ?", user.Id).Updates(updates).Error; err != nil {
		return false, err
	}
	if err := tx.Model(account).Updates(map[string]any{"claimed": account.Claimed, "updated_at": account.UpdatedAt}).Error; err != nil {
		return false, err
	}
	if err := tx.Create(&AffiliateRebateClaim{UserID: user.Id, Quota: quota, Destination: destination, CreatedAt: account.UpdatedAt}).Error; err != nil {
		return false, err
	}
	err = tx.Create(&AffiliateLedgerEntry{UserID: user.Id, BusinessID: businessID, Kind: "claim_" + destination, Quota: -quota, ActorID: user.Id, AccruedAfter: account.Accrued, ClaimedAfter: account.Claimed, CreatedAt: account.UpdatedAt}).Error
	return false, err
}
