package model

import (
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	affiliatePaidQuotaBackfillOption    = "internal.affiliate_paid_quota_backfilled"
	affiliateRebateLedgerBackfillOption = "internal.affiliate_rebate_ledger_backfilled"
	affiliateRebateWindowDays           = 7
)

// UserPaidConsumptionDay is one user's paid consumption on one local day.
// Claims compare the last 7 days of these rows; older rows are pruned.
type UserPaidConsumptionDay struct {
	UserID   int   `gorm:"primaryKey;autoIncrement:false;column:user_id"`
	DayStart int64 `gorm:"primaryKey;autoIncrement:false;column:day_start"`
	Delta    int   `gorm:"not null;default:0;column:delta"`
}

func (UserPaidConsumptionDay) TableName() string {
	return "user_paid_consumption_days"
}

// AffiliateRebateClaim records each claim so claims inside the same 7-day
// window share one consumption requirement.
type AffiliateRebateClaim struct {
	ID        int   `gorm:"primaryKey"`
	UserID    int   `gorm:"not null;index:idx_affiliate_rebate_claim_user_time,priority:1"`
	Quota     int   `gorm:"not null"`
	CreatedAt int64 `gorm:"not null;autoCreateTime:false;index:idx_affiliate_rebate_claim_user_time,priority:2"`
}

// legacyUserPaidConsumptionLog is the per-request table written by the first
// release. It is only read once to seed the daily rows.
type legacyUserPaidConsumptionLog struct {
	UserID    int
	Delta     int
	CreatedAt int64
}

func (legacyUserPaidConsumptionLog) TableName() string {
	return "user_paid_consumption_logs"
}

func localDayStart(ts int64) int64 {
	t := time.Unix(ts, 0)
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, t.Location()).Unix()
}

// affiliateRebateWindowStart is the first local day of the claim window:
// today and the six days before it.
func affiliateRebateWindowStart() int64 {
	now := time.Now()
	y, m, d := now.Date()
	return time.Date(y, m, d-(affiliateRebateWindowDays-1), 0, 0, 0, 0, now.Location()).Unix()
}

var paidConsumptionPrunedDay sync.Map

func addPaidConsumptionDay(tx *gorm.DB, userID int, dayStart int64, delta int) error {
	if delta == 0 {
		return nil
	}
	row := UserPaidConsumptionDay{UserID: userID, DayStart: dayStart, Delta: delta}
	err := tx.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}, {Name: "day_start"}},
		DoUpdates: clause.Assignments(map[string]any{
			"delta": gorm.Expr("user_paid_consumption_days.delta + ?", delta),
		}),
	}).Create(&row).Error
	if err != nil {
		return err
	}
	if last, ok := paidConsumptionPrunedDay.Load(userID); ok && last.(int64) == dayStart {
		return nil
	}
	if err := tx.Where("user_id = ? AND day_start < ?", userID, affiliateRebateWindowStart()).
		Delete(&UserPaidConsumptionDay{}).Error; err != nil {
		return err
	}
	paidConsumptionPrunedDay.Store(userID, dayStart)
	return nil
}

func recentPaidConsumption(db *gorm.DB, userID int) (int, error) {
	var total int64
	err := db.Model(&UserPaidConsumptionDay{}).
		Where("user_id = ? AND day_start >= ?", userID, affiliateRebateWindowStart()).
		Select("COALESCE(SUM(delta), 0)").
		Scan(&total).Error
	return int(total), err
}

func recentClaimedRebate(db *gorm.DB, userID int) (int, error) {
	var total int64
	err := db.Model(&AffiliateRebateClaim{}).
		Where("user_id = ? AND created_at >= ?", userID, affiliateRebateWindowStart()).
		Select("COALESCE(SUM(quota), 0)").
		Scan(&total).Error
	return int(total), err
}

// rebateClaimConsumptionRequired is the paid consumption behind claimed
// rebate. Claiming 10 in total at 10% requires 100.
func rebateClaimConsumptionRequired(quota int) (int, error) {
	if common.AffiliateRebatePercent <= 0 {
		return 0, common.NewMessage("Referral rebate is disabled")
	}
	required := decimal.NewFromInt(int64(quota)).
		Mul(decimal.NewFromInt(100)).
		Div(decimal.NewFromFloat(common.AffiliateRebatePercent)).
		Ceil()
	amount, err := common.WalletQuotaFromDecimalStrict(required)
	if err != nil || amount < 0 {
		return 0, common.NewMessage("The rebate amount exceeds the claimable balance")
	}
	return amount, nil
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

func affiliateRebateFloor(paidConsumed int, percent float64) int {
	if paidConsumed <= 0 || percent <= 0 {
		return 0
	}
	rebate := decimal.NewFromInt(int64(paidConsumed)).
		Mul(decimal.NewFromFloat(percent)).
		Div(decimal.NewFromInt(100)).
		Floor()
	quota, err := common.WalletQuotaFromDecimalStrict(rebate)
	if err != nil || quota < 0 {
		return 0
	}
	return quota
}

// affiliateLedgerChange settles an invitee's paid consumption into rebate.
// Consumption is rebated once at the percent in force when it is covered, so
// later setting changes do not rewrite rebate that was already earned.
func affiliateLedgerChange(covered int, earned int, paidAfter int, positive bool) (int, int) {
	percent := common.AffiliateRebatePercent
	threshold := common.AffiliateRebateDownstreamQuota
	if positive {
		if paidAfter <= covered {
			return covered, earned
		}
		if percent <= 0 {
			return paidAfter, earned
		}
		if threshold > 0 && paidAfter < threshold {
			return covered, earned
		}
		grant := affiliateRebateFloor(paidAfter, percent) - affiliateRebateFloor(covered, percent)
		if grant < 0 {
			grant = 0
		}
		return paidAfter, earned + grant
	}
	if paidAfter >= covered {
		return covered, earned
	}
	if covered <= 0 || paidAfter <= 0 {
		return max(paidAfter, 0), 0
	}
	kept := decimal.NewFromInt(int64(earned)).
		Mul(decimal.NewFromInt(int64(paidAfter))).
		Div(decimal.NewFromInt(int64(covered))).
		Floor()
	keptQuota, err := common.WalletQuotaFromDecimalStrict(kept)
	if err != nil || keptQuota < 0 {
		keptQuota = 0
	}
	return paidAfter, min(keptQuota, earned)
}

// applyAttributedUsage writes settled usage. walletDelta is the part funded by
// the wallet: it consumes gift quota first, and only the remainder counts as
// paid consumption, accrues rebate for the inviter, and is logged per day.
// The daily row is written after the usage commits, so a failure there only
// under-counts the claim window and never loses usage statistics.
func applyAttributedUsage(db *gorm.DB, id int, usedDelta int, walletDelta int, quotaDelta int, requestDelta int) error {
	if walletDelta == 0 {
		return applyUserQuotaUsage(db, id, usedDelta, 0, quotaDelta, requestDelta)
	}
	paidDelta := 0
	err := db.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).
			Select("id", "inviter_id", "unpaid_quota_balance", "paid_quota_consumed", "affiliate_rebate_covered", "affiliate_rebate_earned").
			First(&user, id).Error; err != nil {
			return err
		}
		paidDelta = paidConsumptionDelta(user.UnpaidQuotaBalance, user.PaidQuotaConsumed, walletDelta)
		if err := applyUserQuotaUsage(tx, id, usedDelta, walletDelta, quotaDelta, requestDelta); err != nil {
			return err
		}
		if paidDelta == 0 || user.InviterId <= 0 {
			return nil
		}
		covered, earned := affiliateLedgerChange(user.AffiliateRebateCovered, user.AffiliateRebateEarned, user.PaidQuotaConsumed+paidDelta, paidDelta > 0)
		if covered == user.AffiliateRebateCovered && earned == user.AffiliateRebateEarned {
			return nil
		}
		return tx.Exec(
			"UPDATE users SET affiliate_rebate_covered = affiliate_rebate_covered + ?, affiliate_rebate_earned = affiliate_rebate_earned + ? WHERE id = ?",
			covered-user.AffiliateRebateCovered, earned-user.AffiliateRebateEarned, id,
		).Error
	})
	if err != nil || paidDelta == 0 {
		return err
	}
	if err := addPaidConsumptionDay(db, id, localDayStart(common.GetTimestamp()), paidDelta); err != nil {
		common.SysError(common.LogText("failed to record daily paid consumption for user %d: %s", id, err.Error()))
	}
	return nil
}

// applyUserQuotaUsage records settled usage. walletDelta consumes gifts in
// unpaid_quota_balance before paid_quota_consumed increases.
// MySQL evaluates SET clauses left to right and later assignments see earlier
// ones, so the paid and unpaid columns are written in an order where each
// expression still reads the original value of the other column.
func applyUserQuotaUsage(db *gorm.DB, id int, usedDelta int, walletDelta int, quotaDelta int, requestDelta int) error {
	if usedDelta == 0 && walletDelta == 0 && quotaDelta == 0 && requestDelta == 0 {
		return nil
	}
	sets := make([]string, 0, 5)
	args := make([]any, 0, 8)
	if usedDelta != 0 {
		sets = append(sets, "used_quota = used_quota + ?")
		args = append(args, usedDelta)
	}
	if walletDelta != 0 {
		paidSets, paidArgs := paidConsumptionSet(walletDelta)
		sets = append(sets, paidSets...)
		args = append(args, paidArgs...)
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

func affiliateMigrationDone(tx *gorm.DB, key string) (bool, error) {
	var existing Option
	err := tx.Where(commonKeyCol+" = ?", key).First(&existing).Error
	if err == nil {
		return true, nil
	}
	if err != gorm.ErrRecordNotFound {
		return false, err
	}
	return false, nil
}

func backfillUnpaidQuotaFromCurrentBalance() error {
	return DB.Transaction(func(tx *gorm.DB) error {
		done, err := affiliateMigrationDone(tx, affiliatePaidQuotaBackfillOption)
		if err != nil || done {
			return err
		}
		if err := tx.Exec("UPDATE users SET unpaid_quota_balance = CASE WHEN quota > 0 THEN quota ELSE 0 END").Error; err != nil {
			return err
		}
		return tx.Create(&Option{Key: affiliatePaidQuotaBackfillOption, Value: "true"}).Error
	})
}

func storedOptionValue(tx *gorm.DB, key string) (string, error) {
	var option Option
	err := tx.Where(commonKeyCol+" = ?", key).First(&option).Error
	if err == gorm.ErrRecordNotFound {
		return "", nil
	}
	return option.Value, err
}

// backfillAffiliateRebateLedger fixes the rebate already shown by the first
// release, which recomputed it from total paid consumption, and seeds the daily
// consumption rows from its per-request table. Options are read from the table
// because migrations run before the option map is loaded.
func backfillAffiliateRebateLedger() error {
	return DB.Transaction(func(tx *gorm.DB) error {
		done, err := affiliateMigrationDone(tx, affiliateRebateLedgerBackfillOption)
		if err != nil || done {
			return err
		}
		percentValue, err := storedOptionValue(tx, "AffiliateRebatePercent")
		if err != nil {
			return err
		}
		thresholdValue, err := storedOptionValue(tx, "AffiliateRebateDownstreamQuota")
		if err != nil {
			return err
		}
		percent, _ := strconv.ParseFloat(strings.TrimSpace(percentValue), 64)
		threshold, _ := strconv.Atoi(strings.TrimSpace(thresholdValue))

		var invitees []User
		if err := tx.Unscoped().Select("id", "paid_quota_consumed").
			Where("inviter_id > 0 AND paid_quota_consumed > 0").
			Find(&invitees).Error; err != nil {
			return err
		}
		for _, invitee := range invitees {
			if percent > 0 && threshold > 0 && invitee.PaidQuotaConsumed < threshold {
				continue
			}
			earned := affiliateRebateFloor(invitee.PaidQuotaConsumed, percent)
			if err := tx.Model(&User{}).Unscoped().Where("id = ?", invitee.Id).Updates(map[string]any{
				"affiliate_rebate_covered": invitee.PaidQuotaConsumed,
				"affiliate_rebate_earned":  earned,
			}).Error; err != nil {
				return err
			}
		}

		if tx.Migrator().HasTable(&legacyUserPaidConsumptionLog{}) {
			var logs []legacyUserPaidConsumptionLog
			if err := tx.Where("created_at >= ?", affiliateRebateWindowStart()).Find(&logs).Error; err != nil {
				return err
			}
			days := make(map[[2]int64]int)
			for _, entry := range logs {
				days[[2]int64{int64(entry.UserID), localDayStart(entry.CreatedAt)}] += entry.Delta
			}
			for key, delta := range days {
				if err := addPaidConsumptionDay(tx, int(key[0]), key[1], delta); err != nil {
					return err
				}
			}
		}
		return tx.Create(&Option{Key: affiliateRebateLedgerBackfillOption, Value: "true"}).Error
	})
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
	WeekClaimed         int                      `json:"week_claimed"`
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
	if len(runes) <= 2 {
		return string(runes[0]) + "*"
	}
	return string(runes[0]) + "***" + string(runes[len(runes)-1])
}

func accruedAffiliateRebate(db *gorm.DB, inviterID int) (int, error) {
	var total int64
	err := db.Model(&User{}).
		Where("inviter_id = ?", inviterID).
		Select("COALESCE(SUM(affiliate_rebate_earned), 0)").
		Scan(&total).Error
	return int(total), err
}

func AttachAffiliateRebateTotals(users []*User) error {
	ids := make([]int, 0, len(users))
	for _, user := range users {
		if user != nil && user.Id > 0 {
			ids = append(ids, user.Id)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	type inviterTotal struct {
		InviterId int
		Total     int64
	}
	var totals []inviterTotal
	if err := DB.Model(&User{}).
		Select("inviter_id, COALESCE(SUM(affiliate_rebate_earned), 0) AS total").
		Where("inviter_id IN ?", ids).
		Group("inviter_id").
		Scan(&totals).Error; err != nil {
		return err
	}
	accrued := make(map[int]int, len(totals))
	for _, total := range totals {
		accrued[total.InviterId] = int(total.Total)
	}
	for _, user := range users {
		if user == nil {
			continue
		}
		total := accrued[user.Id]
		user.AffiliateRebateTotal = total
		user.AffiliateRebateUnused = max(total-user.AffiliateRebateClaimed, 0)
	}
	return nil
}

func GetAffiliateRebateSummary(userID int) (*AffiliateRebateSummary, error) {
	var user User
	if err := DB.Select("id", "paid_quota_consumed", "affiliate_rebate_claimed").First(&user, userID).Error; err != nil {
		return nil, err
	}
	var invitees []User
	if err := DB.Select("id", "username", "paid_quota_consumed", "affiliate_rebate_earned").
		Where("inviter_id = ?", userID).Order("id desc").Find(&invitees).Error; err != nil {
		return nil, err
	}
	ownWeek, err := recentPaidConsumption(DB, userID)
	if err != nil {
		return nil, err
	}
	weekClaimed, err := recentClaimedRebate(DB, userID)
	if err != nil {
		return nil, err
	}
	summary := &AffiliateRebateSummary{
		Percent:             common.AffiliateRebatePercent,
		DownstreamThreshold: common.AffiliateRebateDownstreamQuota,
		UpstreamMinimum:     common.AffiliateRebateUpstreamQuota,
		PaidConsumed:        user.PaidQuotaConsumed,
		WeekPaidConsumed:    ownWeek,
		WeekClaimed:         weekClaimed,
		CanClaim:            common.AffiliateRebatePercent > 0 && user.PaidQuotaConsumed >= common.AffiliateRebateUpstreamQuota,
		Claimed:             user.AffiliateRebateClaimed,
		Invitees:            make([]AffiliateInviteeRebate, 0, len(invitees)),
	}
	for _, invitee := range invitees {
		summary.Accrued += invitee.AffiliateRebateEarned
		summary.Invitees = append(summary.Invitees, AffiliateInviteeRebate{
			UserID:       invitee.Id,
			Username:     maskAffiliateUsername(invitee.Username),
			PaidConsumed: invitee.PaidQuotaConsumed,
			Rebate:       invitee.AffiliateRebateEarned,
			ThresholdMet: invitee.AffiliateRebateEarned > 0 || common.AffiliateRebateDownstreamQuota <= 0 || invitee.PaidQuotaConsumed >= common.AffiliateRebateDownstreamQuota,
		})
	}
	summary.Claimable = max(summary.Accrued-summary.Claimed, 0)
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
		weekClaimed, err := recentClaimedRebate(tx, userID)
		if err != nil {
			return err
		}
		required, err := rebateClaimConsumptionRequired(weekClaimed + quota)
		if err != nil {
			return err
		}
		ownWeek, err := recentPaidConsumption(tx, userID)
		if err != nil {
			return err
		}
		if ownWeek < required {
			return common.NewMessage("To claim {{amount}}, your paid consumption in the last 7 days must be at least {{required}}.", map[string]any{
				"amount":   logger.FormatQuota(quota),
				"required": logger.FormatQuota(required),
			})
		}
		accrued, err := accruedAffiliateRebate(tx, userID)
		if err != nil {
			return err
		}
		if quota > max(accrued-user.AffiliateRebateClaimed, 0) {
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
		return tx.Create(&AffiliateRebateClaim{UserID: userID, Quota: quota, CreatedAt: common.GetTimestamp()}).Error
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
