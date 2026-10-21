package model

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

const affiliatePaidQuotaBackfillOption = "internal.affiliate_paid_quota_backfilled"

const affiliateRebateClaimWindow int64 = 7 * 24 * 60 * 60

// UserPaidConsumptionLog is one settled wallet charge or refund after gifts are
// consumed. Claim checks the last 7 days of these rows.
type UserPaidConsumptionLog struct {
	ID        int   `gorm:"primaryKey"`
	UserID    int   `gorm:"not null;index:idx_user_paid_consumption_user_time,priority:1"`
	Delta     int   `gorm:"not null"`
	CreatedAt int64 `gorm:"not null;autoCreateTime:false;index:idx_user_paid_consumption_user_time,priority:2"`
}

func paidConsumptionDelta(unpaidBalance int, paidConsumed int, usedDelta int) int {
	if usedDelta > 0 {
		if unpaidBalance >= usedDelta {
			return 0
		}
		return usedDelta - unpaidBalance
	}
	if usedDelta < 0 {
		refund := -usedDelta
		if paidConsumed >= refund {
			return -refund
		}
		return -paidConsumed
	}
	return 0
}

func applyAttributedUsage(db *gorm.DB, id int, usedDelta int, quotaDelta int, requestDelta int, attributePaid bool) error {
	if !attributePaid || usedDelta == 0 {
		return applyUserQuotaUsage(db, id, usedDelta, quotaDelta, requestDelta, attributePaid)
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id", "unpaid_quota_balance", "paid_quota_consumed").First(&user, id).Error; err != nil {
			return err
		}
		delta := paidConsumptionDelta(user.UnpaidQuotaBalance, user.PaidQuotaConsumed, usedDelta)
		if err := applyUserQuotaUsage(tx, id, usedDelta, quotaDelta, requestDelta, true); err != nil {
			return err
		}
		return insertPaidConsumptionLog(tx, id, delta)
	})
}

func applyAttributedPaidConsumption(db *gorm.DB, id int, usedDelta int) error {
	if usedDelta == 0 {
		return nil
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id", "unpaid_quota_balance", "paid_quota_consumed").First(&user, id).Error; err != nil {
			return err
		}
		delta := paidConsumptionDelta(user.UnpaidQuotaBalance, user.PaidQuotaConsumed, usedDelta)
		if err := applyPaidConsumption(tx, id, usedDelta); err != nil {
			return err
		}
		return insertPaidConsumptionLog(tx, id, delta)
	})
}

func insertPaidConsumptionLog(tx *gorm.DB, userID int, delta int) error {
	if delta == 0 {
		return nil
	}
	return tx.Create(&UserPaidConsumptionLog{
		UserID:    userID,
		Delta:     delta,
		CreatedAt: common.GetTimestamp(),
	}).Error
}

func recentPaidConsumption(db *gorm.DB, userID int, since int64) (int, error) {
	var total int64
	err := db.Model(&UserPaidConsumptionLog{}).
		Where("user_id = ? AND created_at >= ?", userID, since).
		Select("COALESCE(SUM(delta), 0)").
		Scan(&total).Error
	return int(total), err
}

func recentInviterPaidConsumption(db *gorm.DB, userID int) (int, error) {
	since := common.GetTimestamp() - affiliateRebateClaimWindow
	return recentPaidConsumption(db, userID, since)
}

// rebateClaimConsumptionRequired is the inviter consumption behind a claim.
// Claiming 10 at 10% requires 100.
func rebateClaimConsumptionRequired(quota int) (int, error) {
	if common.AffiliateRebatePercent <= 0 {
		return 0, common.NewMessage("Referral rebate is disabled")
	}
	required := decimal.NewFromInt(int64(quota)).
		Mul(decimal.NewFromInt(100)).
		Div(decimal.NewFromFloat(common.AffiliateRebatePercent)).
		Ceil()
	if required.GreaterThan(decimal.NewFromInt(int64(common.MaxWalletQuota))) || required.IsNegative() {
		return 0, common.NewMessage("The rebate amount exceeds the claimable balance")
	}
	return int(required.IntPart()), nil
}

// applyUserQuotaUsage records settled usage. When attributePaid is set, gifts in
// unpaid_quota_balance are consumed before paid_quota_consumed increases.
// MySQL evaluates SET clauses left to right and later assignments see earlier
// ones, so the paid and unpaid columns are written in an order where each
// expression still reads the original value of the other column.
func applyUserQuotaUsage(db *gorm.DB, id int, usedDelta int, quotaDelta int, requestDelta int, attributePaid bool) error {
	if usedDelta == 0 && quotaDelta == 0 && requestDelta == 0 {
		return nil
	}
	sets := make([]string, 0, 4)
	args := make([]any, 0, 8)
	if usedDelta != 0 {
		sets = append(sets, "used_quota = used_quota + ?")
		args = append(args, usedDelta)
		if attributePaid {
			paidSets, paidArgs := paidConsumptionSet(usedDelta)
			sets = append(sets, paidSets...)
			args = append(args, paidArgs...)
		}
	}
	if quotaDelta != 0 {
		sets = append(sets, "quota = quota + ?")
		args = append(args, quotaDelta)
	}
	if requestDelta != 0 {
		sets = append(sets, "request_count = request_count + ?")
		args = append(args, requestDelta)
	}
	args = append(args, id)
	return db.Exec("UPDATE users SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...).Error
}

func applyPaidConsumption(db *gorm.DB, id int, usedDelta int) error {
	if usedDelta == 0 {
		return nil
	}
	sets, args := paidConsumptionSet(usedDelta)
	args = append(args, id)
	return db.Exec("UPDATE users SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...).Error
}

func paidConsumptionSet(delta int) ([]string, []any) {
	if delta > 0 {
		return []string{
			"paid_quota_consumed = paid_quota_consumed + CASE WHEN unpaid_quota_balance >= ? THEN 0 ELSE ? - unpaid_quota_balance END",
			"unpaid_quota_balance = CASE WHEN unpaid_quota_balance >= ? THEN unpaid_quota_balance - ? ELSE 0 END",
		}, []any{delta, delta, delta, delta}
	}
	refund := -delta
	return []string{
		"unpaid_quota_balance = unpaid_quota_balance + CASE WHEN paid_quota_consumed >= ? THEN 0 ELSE ? - paid_quota_consumed END",
		"paid_quota_consumed = CASE WHEN paid_quota_consumed >= ? THEN paid_quota_consumed - ? ELSE 0 END",
	}, []any{refund, refund, refund, refund}
}

func AddUnpaidQuota(id int, quota int) error {
	if quota <= 0 {
		return nil
	}
	return DB.Model(&User{}).Where("id = ?", id).
		Update("unpaid_quota_balance", gorm.Expr("unpaid_quota_balance + ?", quota)).Error
}

func backfillUnpaidQuotaFromCurrentBalance() error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var existing Option
		err := tx.Where(commonKeyCol+" = ?", affiliatePaidQuotaBackfillOption).First(&existing).Error
		if err == nil {
			return nil
		}
		if err != gorm.ErrRecordNotFound {
			return err
		}
		if err := tx.Exec("UPDATE users SET unpaid_quota_balance = CASE WHEN quota > 0 THEN quota ELSE 0 END").Error; err != nil {
			return err
		}
		return tx.Create(&Option{Key: affiliatePaidQuotaBackfillOption, Value: "true"}).Error
	})
}

func AffiliateRebateForConsumption(paidConsumed int) int {
	if common.AffiliateRebatePercent <= 0 || paidConsumed <= 0 {
		return 0
	}
	if common.AffiliateRebateDownstreamQuota > 0 && paidConsumed < common.AffiliateRebateDownstreamQuota {
		return 0
	}
	rebate := decimal.NewFromInt(int64(paidConsumed)).
		Mul(decimal.NewFromFloat(common.AffiliateRebatePercent)).
		Div(decimal.NewFromInt(100))
	quota, err := common.WalletQuotaFromDecimalStrict(rebate)
	if err != nil || quota < 0 {
		return 0
	}
	return quota
}

type AffiliateInviteeRebate struct {
	UserID       int    `json:"user_id"`
	Username     string `json:"username"`
	PaidConsumed int    `json:"paid_consumed"`
	Rebate       int    `json:"rebate"`
	ThresholdMet bool   `json:"threshold_met"`
}

type AffiliateRebateSummary struct {
	Percent             float64                  `json:"percent"`
	DownstreamThreshold int                      `json:"downstream_threshold"`
	UpstreamMinimum     int                      `json:"upstream_minimum"`
	PaidConsumed        int                      `json:"paid_consumed"`
	WeekPaidConsumed    int                      `json:"week_paid_consumed"`
	CanClaim            bool                     `json:"can_claim"`
	Accrued             int                      `json:"accrued"`
	Claimed             int                      `json:"claimed"`
	Claimable           int                      `json:"claimable"`
	Invitees            []AffiliateInviteeRebate `json:"invitees"`
}

func maskAffiliateUsername(name string) string {
	name = strings.TrimSpace(name)
	runes := []rune(name)
	if len(runes) == 0 {
		return "*"
	}
	if len(runes) == 1 {
		return string(runes[0]) + "*"
	}
	if len(runes) == 2 {
		return string(runes[0]) + "*"
	}
	return string(runes[0]) + "***" + string(runes[len(runes)-1])
}

func AttachAffiliateRebateTotals(users []*User) error {
	if len(users) == 0 {
		return nil
	}
	ids := make([]int, 0, len(users))
	for _, user := range users {
		if user != nil && user.Id > 0 {
			ids = append(ids, user.Id)
		}
	}
	type inviteePaid struct {
		InviterId         int
		PaidQuotaConsumed int
	}
	var invitees []inviteePaid
	if len(ids) > 0 {
		if err := DB.Model(&User{}).
			Select("inviter_id", "paid_quota_consumed").
			Where("inviter_id IN ?", ids).
			Find(&invitees).Error; err != nil {
			return err
		}
	}
	accrued := make(map[int]int, len(ids))
	for _, invitee := range invitees {
		accrued[invitee.InviterId] += AffiliateRebateForConsumption(invitee.PaidQuotaConsumed)
	}
	for _, user := range users {
		if user == nil {
			continue
		}
		total := accrued[user.Id]
		unused := total - user.AffiliateRebateClaimed
		if unused < 0 {
			unused = 0
		}
		user.AffiliateRebateTotal = total
		user.AffiliateRebateUnused = unused
	}
	return nil
}

func GetAffiliateRebateSummary(userID int) (*AffiliateRebateSummary, error) {
	var user User
	if err := DB.Select("id", "paid_quota_consumed", "affiliate_rebate_claimed").First(&user, userID).Error; err != nil {
		return nil, err
	}
	var invitees []User
	if err := DB.Select("id", "username", "paid_quota_consumed").Where("inviter_id = ?", userID).Order("id desc").Find(&invitees).Error; err != nil {
		return nil, err
	}
	summary := &AffiliateRebateSummary{
		Percent:             common.AffiliateRebatePercent,
		DownstreamThreshold: common.AffiliateRebateDownstreamQuota,
		UpstreamMinimum:     common.AffiliateRebateUpstreamQuota,
		PaidConsumed:        user.PaidQuotaConsumed,
		Claimed:             user.AffiliateRebateClaimed,
		Invitees:            make([]AffiliateInviteeRebate, 0, len(invitees)),
	}
	ownWeek, err := recentInviterPaidConsumption(DB, userID)
	if err != nil {
		return nil, err
	}
	summary.WeekPaidConsumed = ownWeek
	summary.CanClaim = common.AffiliateRebatePercent > 0 && user.PaidQuotaConsumed >= common.AffiliateRebateUpstreamQuota
	for _, invitee := range invitees {
		rebate := AffiliateRebateForConsumption(invitee.PaidQuotaConsumed)
		summary.Accrued += rebate
		summary.Invitees = append(summary.Invitees, AffiliateInviteeRebate{
			UserID:       invitee.Id,
			Username:     maskAffiliateUsername(invitee.Username),
			PaidConsumed: invitee.PaidQuotaConsumed,
			Rebate:       rebate,
			ThresholdMet: common.AffiliateRebateDownstreamQuota <= 0 || invitee.PaidQuotaConsumed >= common.AffiliateRebateDownstreamQuota,
		})
	}
	if summary.Accrued < summary.Claimed {
		summary.Claimable = 0
	} else {
		summary.Claimable = summary.Accrued - summary.Claimed
	}
	return summary, nil
}

func ClaimAffiliateRebate(userID int, quota int) error {
	if quota <= 0 {
		return common.NewMessage("The rebate amount exceeds the claimable balance")
	}
	if float64(quota) < common.QuotaPerUnit {
		return common.NewMessage("Minimum transfer quota is {{min}}!", map[string]any{"min": logger.FormatQuota(common.QuotaFromFloat(common.QuotaPerUnit))})
	}
	if common.AffiliateRebatePercent <= 0 {
		return common.NewMessage("Referral rebate is disabled")
	}

	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).First(&user, userID).Error; err != nil {
			return err
		}
		if user.PaidQuotaConsumed < common.AffiliateRebateUpstreamQuota {
			return common.NewMessage("Your paid consumption is below the minimum required to claim referral rebate")
		}
		required, err := rebateClaimConsumptionRequired(quota)
		if err != nil {
			return err
		}
		ownWeek, err := recentInviterPaidConsumption(tx, userID)
		if err != nil {
			return err
		}
		if ownWeek < required {
			return common.NewMessage("To claim {{amount}}, your paid consumption in the last 7 days must be at least {{required}}.", map[string]any{
				"amount":   logger.FormatQuota(quota),
				"required": logger.FormatQuota(required),
			})
		}
		var invitees []User
		if err := tx.Select("paid_quota_consumed").Where("inviter_id = ?", userID).Find(&invitees).Error; err != nil {
			return err
		}
		accrued := 0
		for _, invitee := range invitees {
			accrued += AffiliateRebateForConsumption(invitee.PaidQuotaConsumed)
		}
		claimable := accrued - user.AffiliateRebateClaimed
		if claimable < 0 {
			claimable = 0
		}
		if quota > claimable {
			return common.NewMessage("The rebate amount exceeds the claimable balance")
		}
		result := tx.Model(&User{}).Where("id = ? AND quota <= ?", userID, common.MaxWalletQuota-quota).Updates(map[string]any{
			"quota":                    gorm.Expr("quota + ?", quota),
			"unpaid_quota_balance":     gorm.Expr("unpaid_quota_balance + ?", quota),
			"affiliate_rebate_claimed": gorm.Expr("affiliate_rebate_claimed + ?", quota),
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrWalletQuotaLimitExceeded
		}
		return nil
	})
	return syncAffiliateClaimQuota(userID, quota, err)
}

func syncAffiliateClaimQuota(userID int, quota int, err error) error {
	if err != nil {
		return err
	}
	if cacheErr := cacheIncrUserQuota(userID, int64(quota)); cacheErr != nil {
		common.SysError(common.LogText("failed to sync claimed referral rebate for user %d: %s", userID, cacheErr))
	}
	return nil
}
