package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPaidConsumptionConsumesGiftsFirst(t *testing.T) {
	setupUserUpdateTestState(t)
	user := User{
		Username:           "rebate-user",
		Password:           "hash",
		Role:               common.RoleCommonUser,
		Status:             common.UserStatusEnabled,
		Group:              "default",
		AffCode:            "rebate-user",
		AuthVersion:        1,
		Quota:              150,
		UnpaidQuotaBalance: 100,
	}
	require.NoError(t, DB.Create(&user).Error)

	require.NoError(t, applyUserQuotaUsage(DB, user.Id, 40, 0, 0, true))
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, 60, user.UnpaidQuotaBalance)
	assert.Equal(t, 0, user.PaidQuotaConsumed)

	require.NoError(t, applyUserQuotaUsage(DB, user.Id, 80, 0, 0, true))
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, 0, user.UnpaidQuotaBalance)
	assert.Equal(t, 20, user.PaidQuotaConsumed)

	require.NoError(t, applyUserQuotaUsage(DB, user.Id, -10, 0, 0, true))
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, 0, user.UnpaidQuotaBalance)
	assert.Equal(t, 10, user.PaidQuotaConsumed)
}

func TestClaimAffiliateRebateRequiresUpstreamConsumption(t *testing.T) {
	setupUserUpdateTestState(t)
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
	common.AffiliateRebatePercent = 10
	common.AffiliateRebateDownstreamQuota = 100
	common.AffiliateRebateUpstreamQuota = 50
	common.QuotaPerUnit = 1

	inviter := User{
		Username:          "inviter",
		Password:          "hash",
		Role:              common.RoleCommonUser,
		Status:            common.UserStatusEnabled,
		Group:             "default",
		AffCode:           "inviter",
		AuthVersion:       1,
		PaidQuotaConsumed: 49,
		Quota:             10,
	}
	require.NoError(t, DB.Create(&inviter).Error)
	invitee := User{
		Username:          "invitee",
		Password:          "hash",
		Role:              common.RoleCommonUser,
		Status:            common.UserStatusEnabled,
		Group:             "default",
		AffCode:           "invitee",
		AuthVersion:       1,
		InviterId:         inviter.Id,
		PaidQuotaConsumed: 100,
	}
	require.NoError(t, DB.Create(&invitee).Error)
	require.NoError(t, DB.Create(&UserPaidConsumptionLog{
		UserID: inviter.Id, Delta: 100, CreatedAt: common.GetTimestamp(),
	}).Error)

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

func TestPaidConsumptionLogSkipsGifts(t *testing.T) {
	setupUserUpdateTestState(t)
	user := User{
		Username:           "paid-log-user",
		Password:           "hash",
		Role:               common.RoleCommonUser,
		Status:             common.UserStatusEnabled,
		Group:              "default",
		AffCode:            "paid-log-user",
		AuthVersion:        1,
		Quota:              150,
		UnpaidQuotaBalance: 100,
	}
	require.NoError(t, DB.Create(&user).Error)

	UpdateUserUsedQuota(user.Id, 40)
	var count int64
	require.NoError(t, DB.Model(&UserPaidConsumptionLog{}).Where("user_id = ?", user.Id).Count(&count).Error)
	assert.Equal(t, int64(0), count)

	UpdateUserUsedQuota(user.Id, 80)
	var entry UserPaidConsumptionLog
	require.NoError(t, DB.Where("user_id = ?", user.Id).First(&entry).Error)
	assert.Equal(t, 20, entry.Delta)
}

func TestClaimAffiliateRebateRequiresRecentConsumptionToCoverInvitees(t *testing.T) {
	setupUserUpdateTestState(t)
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
	common.AffiliateRebatePercent = 10
	common.AffiliateRebateDownstreamQuota = 0
	common.AffiliateRebateUpstreamQuota = 0
	common.QuotaPerUnit = 1

	inviter := User{
		Username:    "week-inviter",
		Password:    "hash",
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		AffCode:     "week-inviter",
		AuthVersion: 1,
		Quota:       10,
	}
	require.NoError(t, DB.Create(&inviter).Error)
	invitee := User{
		Username:          "week-invitee",
		Password:          "hash",
		Role:              common.RoleCommonUser,
		Status:            common.UserStatusEnabled,
		Group:             "default",
		AffCode:           "week-invitee",
		AuthVersion:       1,
		InviterId:         inviter.Id,
		PaidQuotaConsumed: 100,
	}
	require.NoError(t, DB.Create(&invitee).Error)
	now := common.GetTimestamp()
	require.NoError(t, DB.Create(&UserPaidConsumptionLog{
		UserID: invitee.Id, Delta: 1000, CreatedAt: now - 8*24*60*60,
	}).Error)
	require.NoError(t, DB.Create(&UserPaidConsumptionLog{
		UserID: invitee.Id, Delta: 100, CreatedAt: now,
	}).Error)
	require.NoError(t, DB.Create(&UserPaidConsumptionLog{
		UserID: inviter.Id, Delta: 99, CreatedAt: now,
	}).Error)

	summary, err := GetAffiliateRebateSummary(inviter.Id)
	require.NoError(t, err)
	assert.Equal(t, 99, summary.WeekPaidConsumed)
	assert.True(t, summary.CanClaim)
	require.Error(t, ClaimAffiliateRebate(inviter.Id, 10))
	require.NoError(t, ClaimAffiliateRebate(inviter.Id, 5))
	require.NoError(t, DB.First(&inviter, inviter.Id).Error)
	assert.Equal(t, 15, inviter.Quota)
	assert.Equal(t, 5, inviter.AffiliateRebateClaimed)
}

func TestAttachAffiliateRebateTotals(t *testing.T) {
	setupUserUpdateTestState(t)
	originalPercent := common.AffiliateRebatePercent
	originalDownstream := common.AffiliateRebateDownstreamQuota
	t.Cleanup(func() {
		common.AffiliateRebatePercent = originalPercent
		common.AffiliateRebateDownstreamQuota = originalDownstream
	})
	common.AffiliateRebatePercent = 10
	common.AffiliateRebateDownstreamQuota = 100

	inviter := User{
		Username:               "totals-inviter",
		Password:               "hash",
		Role:                   common.RoleCommonUser,
		Status:                 common.UserStatusEnabled,
		Group:                  "default",
		AffCode:                "totals-inviter",
		AuthVersion:            1,
		AffiliateRebateClaimed: 4,
	}
	require.NoError(t, DB.Create(&inviter).Error)
	require.NoError(t, DB.Create(&User{
		Username:          "totals-met",
		Password:          "hash",
		Role:              common.RoleCommonUser,
		Status:            common.UserStatusEnabled,
		Group:             "default",
		AffCode:           "totals-met",
		AuthVersion:       1,
		InviterId:         inviter.Id,
		PaidQuotaConsumed: 100,
	}).Error)
	require.NoError(t, DB.Create(&User{
		Username:          "totals-below",
		Password:          "hash",
		Role:              common.RoleCommonUser,
		Status:            common.UserStatusEnabled,
		Group:             "default",
		AffCode:           "totals-below",
		AuthVersion:       1,
		InviterId:         inviter.Id,
		PaidQuotaConsumed: 50,
	}).Error)

	users := []*User{&inviter}
	require.NoError(t, AttachAffiliateRebateTotals(users))
	assert.Equal(t, 10, users[0].AffiliateRebateTotal)
	assert.Equal(t, 6, users[0].AffiliateRebateUnused)
}
