package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setAffiliateRebateSettings(t *testing.T, percent float64, downstream int, upstream int) {
	t.Helper()
	originalPercent := common.AffiliateRebatePercent
	originalDownstream := common.AffiliateRebateDownstreamQuota
	originalUpstream := common.AffiliateRebateUpstreamQuota
	originalPerUnit := common.QuotaPerUnit
	t.Cleanup(func() {
		common.AffiliateRebatePercent = originalPercent
		common.AffiliateRebateDownstreamQuota = originalDownstream
		common.AffiliateRebateUpstreamQuota = originalUpstream
		common.QuotaPerUnit = originalPerUnit
	})
	common.AffiliateRebatePercent = percent
	common.AffiliateRebateDownstreamQuota = downstream
	common.AffiliateRebateUpstreamQuota = upstream
	common.QuotaPerUnit = 1
}

func createRebateTestUser(t *testing.T, name string, user User) User {
	t.Helper()
	user.Username = name
	user.AffCode = name
	user.Password = "hash"
	user.Role = common.RoleCommonUser
	user.Status = common.UserStatusEnabled
	user.Group = "default"
	user.AuthVersion = 1
	require.NoError(t, DB.Create(&user).Error)
	return user
}

func paidConsumptionToday(t *testing.T, userID int) int {
	t.Helper()
	total, err := recentPaidConsumption(DB, userID)
	require.NoError(t, err)
	return total
}

func TestPaidConsumptionConsumesGiftsFirst(t *testing.T) {
	setupUserUpdateTestState(t)
	user := createRebateTestUser(t, "rebate-user", User{Quota: 150, UnpaidQuotaBalance: 100})

	require.NoError(t, applyUserQuotaUsage(DB, user.Id, 40, 40, 0, 0))
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, 60, user.UnpaidQuotaBalance)
	assert.Equal(t, 0, user.PaidQuotaConsumed)

	require.NoError(t, applyUserQuotaUsage(DB, user.Id, 80, 80, 0, 0))
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, 0, user.UnpaidQuotaBalance)
	assert.Equal(t, 20, user.PaidQuotaConsumed)

	require.NoError(t, applyUserQuotaUsage(DB, user.Id, -10, -10, 0, 0))
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, 0, user.UnpaidQuotaBalance)
	assert.Equal(t, 10, user.PaidQuotaConsumed)
	assert.Equal(t, 110, user.UsedQuota)
}

func TestRebateIsEarnedAtThePercentInForce(t *testing.T) {
	setupUserUpdateTestState(t)
	setAffiliateRebateSettings(t, 10, 100, 0)
	inviter := createRebateTestUser(t, "ledger-inviter", User{})
	invitee := createRebateTestUser(t, "ledger-invitee", User{InviterId: inviter.Id, Quota: 1000})

	steps := []struct {
		percent     float64
		used        int
		wantPaid    int
		wantCovered int
		wantEarned  int
	}{
		{percent: 10, used: 50, wantPaid: 50, wantCovered: 0, wantEarned: 0},
		{percent: 10, used: 60, wantPaid: 110, wantCovered: 110, wantEarned: 11},
		{percent: 20, used: 10, wantPaid: 120, wantCovered: 120, wantEarned: 13},
		{percent: 20, used: -20, wantPaid: 100, wantCovered: 100, wantEarned: 10},
		{percent: 0, used: 30, wantPaid: 130, wantCovered: 130, wantEarned: 10},
		{percent: 10, used: 10, wantPaid: 140, wantCovered: 140, wantEarned: 11},
	}
	for _, step := range steps {
		common.AffiliateRebatePercent = step.percent
		UpdateUserUsedQuota(invitee.Id, step.used)
		require.NoError(t, DB.First(&invitee, invitee.Id).Error)
		assert.Equal(t, step.wantPaid, invitee.PaidQuotaConsumed)
		assert.Equal(t, step.wantCovered, invitee.AffiliateRebateCovered)
		assert.Equal(t, step.wantEarned, invitee.AffiliateRebateEarned)
	}
	assert.Equal(t, 140, paidConsumptionToday(t, invitee.Id))
}

func TestBatchUpdateAttributesWalletUsageOnFlush(t *testing.T) {
	setupUserUpdateTestState(t)
	resetBatchUpdateTestState(t)
	user := createRebateTestUser(t, "batch-rebate-user", User{Quota: 1000, UnpaidQuotaBalance: 100})

	common.BatchUpdateEnabled = true
	RecordUserUsedQuota(user.Id, 80, true)
	RecordUserUsedQuota(user.Id, 50, false)
	RecordUserUsedQuota(user.Id, 40, true)
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, 0, user.UsedQuota)
	assert.Equal(t, 100, user.UnpaidQuotaBalance)

	batchUpdate()
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, 170, user.UsedQuota)
	assert.Equal(t, 0, user.UnpaidQuotaBalance)
	assert.Equal(t, 20, user.PaidQuotaConsumed)
	assert.Equal(t, 20, paidConsumptionToday(t, user.Id))
}

func TestClaimAffiliateRebateRequiresUpstreamConsumption(t *testing.T) {
	setupUserUpdateTestState(t)
	setAffiliateRebateSettings(t, 10, 100, 50)
	inviter := createRebateTestUser(t, "inviter", User{PaidQuotaConsumed: 49, Quota: 10})
	createRebateTestUser(t, "invitee", User{InviterId: inviter.Id, PaidQuotaConsumed: 100, AffiliateRebateCovered: 100, AffiliateRebateEarned: 10})
	require.NoError(t, addPaidConsumptionDay(DB, inviter.Id, localDayStart(common.GetTimestamp()), 100))

	summary, err := GetAffiliateRebateSummary(inviter.Id)
	require.NoError(t, err)
	assert.Equal(t, 10, summary.Accrued)
	assert.Equal(t, 10, summary.Claimable)
	assert.False(t, summary.CanClaim)
	require.Error(t, ClaimAffiliateRebate(inviter.Id, 10))

	require.NoError(t, DB.Model(&User{}).Where("id = ?", inviter.Id).Update("paid_quota_consumed", 50).Error)
	require.NoError(t, ClaimAffiliateRebate(inviter.Id, 10))
	require.NoError(t, DB.First(&inviter, inviter.Id).Error)
	assert.Equal(t, 20, inviter.Quota)
	assert.Equal(t, 10, inviter.UnpaidQuotaBalance)
	assert.Equal(t, 10, inviter.AffiliateRebateClaimed)
}

func TestClaimsInOneWeekShareTheConsumptionRequirement(t *testing.T) {
	setupUserUpdateTestState(t)
	setAffiliateRebateSettings(t, 10, 0, 0)
	inviter := createRebateTestUser(t, "week-inviter", User{Quota: 10})
	createRebateTestUser(t, "week-invitee", User{InviterId: inviter.Id, PaidQuotaConsumed: 200, AffiliateRebateCovered: 200, AffiliateRebateEarned: 20})

	windowStart := affiliateRebateWindowStart()
	require.NoError(t, DB.Create(&UserPaidConsumptionDay{UserID: inviter.Id, DayStart: windowStart - 24*60*60, Delta: 1000}).Error)
	require.NoError(t, DB.Create(&AffiliateRebateClaim{UserID: inviter.Id, Quota: 100, CreatedAt: windowStart - 1}).Error)
	require.NoError(t, addPaidConsumptionDay(DB, inviter.Id, localDayStart(common.GetTimestamp()), 100))

	require.NoError(t, ClaimAffiliateRebate(inviter.Id, 5))
	require.NoError(t, ClaimAffiliateRebate(inviter.Id, 5))
	require.Error(t, ClaimAffiliateRebate(inviter.Id, 1))

	summary, err := GetAffiliateRebateSummary(inviter.Id)
	require.NoError(t, err)
	assert.Equal(t, 100, summary.WeekPaidConsumed)
	assert.Equal(t, 10, summary.WeekClaimed)
	assert.Equal(t, 10, summary.Claimable)
	require.NoError(t, DB.First(&inviter, inviter.Id).Error)
	assert.Equal(t, 20, inviter.Quota)
}

func TestAttachAffiliateRebateTotals(t *testing.T) {
	setupUserUpdateTestState(t)
	inviter := createRebateTestUser(t, "totals-inviter", User{AffiliateRebateClaimed: 4})
	createRebateTestUser(t, "totals-met", User{InviterId: inviter.Id, PaidQuotaConsumed: 100, AffiliateRebateEarned: 10})
	createRebateTestUser(t, "totals-below", User{InviterId: inviter.Id, PaidQuotaConsumed: 50})

	users := []*User{&inviter}
	require.NoError(t, AttachAffiliateRebateTotals(users))
	assert.Equal(t, 10, users[0].AffiliateRebateTotal)
	assert.Equal(t, 6, users[0].AffiliateRebateUnused)
}

func TestBackfillAffiliateRebateLedger(t *testing.T) {
	setupUserUpdateTestState(t)
	require.NoError(t, DB.AutoMigrate(&Option{}))
	optionKeys := []string{"AffiliateRebatePercent", "AffiliateRebateDownstreamQuota", affiliateRebateLedgerBackfillOption}
	cleanup := func() {
		DB.Where(commonKeyCol+" IN ?", optionKeys).Delete(&Option{})
		_ = DB.Migrator().DropTable(&legacyUserPaidConsumptionLog{})
	}
	cleanup()
	t.Cleanup(cleanup)
	require.NoError(t, DB.Create(&Option{Key: "AffiliateRebatePercent", Value: "10"}).Error)
	require.NoError(t, DB.Create(&Option{Key: "AffiliateRebateDownstreamQuota", Value: "100"}).Error)

	inviter := createRebateTestUser(t, "backfill-inviter", User{})
	met := createRebateTestUser(t, "backfill-met", User{InviterId: inviter.Id, PaidQuotaConsumed: 155})
	below := createRebateTestUser(t, "backfill-below", User{InviterId: inviter.Id, PaidQuotaConsumed: 50})

	require.NoError(t, DB.Migrator().CreateTable(&legacyUserPaidConsumptionLog{}))
	now := common.GetTimestamp()
	require.NoError(t, DB.Create(&[]legacyUserPaidConsumptionLog{
		{UserID: inviter.Id, Delta: 30, CreatedAt: now},
		{UserID: inviter.Id, Delta: 20, CreatedAt: now},
		{UserID: inviter.Id, Delta: 500, CreatedAt: affiliateRebateWindowStart() - 1},
	}).Error)

	for range 2 {
		require.NoError(t, backfillAffiliateRebateLedger())
	}
	require.NoError(t, DB.First(&met, met.Id).Error)
	assert.Equal(t, 155, met.AffiliateRebateCovered)
	assert.Equal(t, 15, met.AffiliateRebateEarned)
	require.NoError(t, DB.First(&below, below.Id).Error)
	assert.Equal(t, 0, below.AffiliateRebateCovered)
	assert.Equal(t, 0, below.AffiliateRebateEarned)
	assert.Equal(t, 50, paidConsumptionToday(t, inviter.Id))
}
