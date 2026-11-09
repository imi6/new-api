package model

import (
	"errors"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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

func migrateRebateTestAccounts(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.Where(commonKeyCol+" = ?", affiliateAccountBackfillOption).Delete(&Option{}).Error)
	require.NoError(t, backfillAffiliateAccounts())
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
	RecordUserUsedQuota(user.Id, 80, true, true)
	RecordUserUsedQuota(user.Id, 50, false, true)
	RecordUserUsedQuota(user.Id, 40, true, true)
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

func TestBatchUpdateSeparatesCompleteUsageFromTheNextFlush(t *testing.T) {
	setupUserUpdateTestState(t)
	resetBatchUpdateTestState(t)
	setAffiliateRebateSettings(t, 10, 0, 0)
	inviter := createRebateTestUser(t, "batch-boundary-inviter", User{})
	user := createRebateTestUser(t, "batch-boundary-source", User{InviterId: inviter.Id, Quota: 1000, UnpaidQuotaBalance: 20})
	migrateRebateTestAccounts(t)
	common.BatchUpdateEnabled = true
	RecordUserUsedQuotaAndRequestCount(user.Id, 100, true, true)

	flushing := make(chan struct{})
	resume := make(chan struct{})
	done := make(chan struct{})
	var once sync.Once
	callback := "test:pause_usage_flush"
	require.NoError(t, DB.Callback().Query().Before("gorm:query").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "User" {
			once.Do(func() {
				close(flushing)
				<-resume
			})
		}
	}))
	t.Cleanup(func() { require.NoError(t, DB.Callback().Query().Remove(callback)) })
	go func() {
		batchUpdate()
		close(done)
	}()
	<-flushing
	// 第一批已经进入数据库结算；新消费必须整体留到下一批。
	RecordUserUsedQuotaAndRequestCount(user.Id, 50, true, true)
	RecordUserUsedQuotaAndRequestCount(user.Id, 50, true, false)
	RecordUserUsedQuotaAndRequestCount(user.Id, 40, false, true)
	close(resume)
	<-done
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, 100, user.UsedQuota)
	assert.Equal(t, 80, user.PaidQuotaConsumed)
	assert.Equal(t, 8, user.AffiliateRebateEarned)
	assert.Equal(t, 1, user.RequestCount)

	batchUpdate()
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, 240, user.UsedQuota)
	assert.Equal(t, 180, user.PaidQuotaConsumed)
	assert.Equal(t, 13, user.AffiliateRebateEarned)
	assert.Equal(t, 4, user.RequestCount)
	assert.Zero(t, user.UnpaidQuotaBalance)
	assert.Equal(t, 180, paidConsumptionToday(t, user.Id))
	var account AffiliateAccount
	require.NoError(t, DB.First(&account, inviter.Id).Error)
	assert.Equal(t, 13, account.Accrued)
}

func TestClaimAffiliateRebateRequiresUpstreamConsumption(t *testing.T) {
	setupUserUpdateTestState(t)
	setAffiliateRebateSettings(t, 10, 100, 50)
	inviter := createRebateTestUser(t, "inviter", User{PaidQuotaConsumed: 49, Quota: 10})
	createRebateTestUser(t, "invitee", User{InviterId: inviter.Id, PaidQuotaConsumed: 100, AffiliateRebateCovered: 100, AffiliateRebateEarned: 10})
	migrateRebateTestAccounts(t)
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
	migrateRebateTestAccounts(t)

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
	migrateRebateTestAccounts(t)

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

func TestAffiliateAccountMigrationPreservesDebtAndDeletedSource(t *testing.T) {
	setupUserUpdateTestState(t)
	setAffiliateRebateSettings(t, 10, 0, 0)
	inviter := createRebateTestUser(t, "account-inviter", User{AffiliateRebateClaimed: 120})
	source := createRebateTestUser(t, "account-source", User{InviterId: inviter.Id, PaidQuotaConsumed: 1000, AffiliateRebateCovered: 1000, AffiliateRebateEarned: 100, Quota: 1000})
	deleted := createRebateTestUser(t, "old-deleted-source", User{InviterId: inviter.Id, AffiliateRebateEarned: 50})
	require.NoError(t, DB.Delete(&deleted).Error)
	migrateRebateTestAccounts(t)
	require.NoError(t, backfillAffiliateAccounts())
	var account AffiliateAccount
	require.NoError(t, DB.First(&account, "user_id = ?", inviter.Id).Error)
	assert.Equal(t, 100, account.Accrued)
	assert.Equal(t, 120, account.Claimed)
	claimed, err := recentClaimedRebate(DB, inviter.Id)
	require.NoError(t, err)
	assert.Zero(t, claimed)
	require.NoError(t, applyAttributedUsage(DB, source.Id, 100, 100, 100, 0, 0))
	require.NoError(t, DB.Delete(&source).Error)
	require.NoError(t, DB.Unscoped().Delete(&source).Error)
	summary, err := GetAffiliateRebateSummary(inviter.Id)
	require.NoError(t, err)
	assert.Equal(t, 110, summary.Accrued)
	assert.Equal(t, 120, summary.Claimed)
	assert.Zero(t, summary.Claimable)
	var entries int64
	require.NoError(t, DB.Model(&AffiliateLedgerEntry{}).Where("user_id = ?", inviter.Id).Count(&entries).Error)
	assert.EqualValues(t, 3, entries)
	admin, err := GetAffiliateAdminSummary()
	require.NoError(t, err)
	assert.EqualValues(t, 110, admin.Accrued)
}

func TestAffiliateClaimReplayDoesNotCreditTwiceAfterRulesChange(t *testing.T) {
	setupUserUpdateTestState(t)
	setAffiliateRebateSettings(t, 10, 0, 0)
	inviter := createRebateTestUser(t, "replay-inviter", User{Quota: 7})
	createRebateTestUser(t, "replay-source", User{InviterId: inviter.Id, AffiliateRebateEarned: 20})
	migrateRebateTestAccounts(t)
	require.NoError(t, addPaidConsumptionDay(DB, inviter.Id, localDayStart(common.GetTimestamp()), 200))
	require.NoError(t, ClaimAffiliateRebateWithRequest(inviter.Id, 10, "platform-request-1"))
	common.AffiliateRebatePercent = 0
	require.NoError(t, ClaimAffiliateRebateWithRequest(inviter.Id, 10, "platform-request-1"))
	require.Error(t, ClaimAffiliateRebateWithRequest(inviter.Id, 11, "platform-request-1"))
	require.NoError(t, DB.First(&inviter, inviter.Id).Error)
	assert.Equal(t, 17, inviter.Quota)
	assert.Equal(t, 10, inviter.AffiliateRebateClaimed)
	var count int64
	require.NoError(t, DB.Model(&AffiliateRebateClaim{}).Where("user_id = ?", inviter.Id).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

func TestAffiliateDestinationsShareAllowanceAndAdminCannotOverdraw(t *testing.T) {
	setupUserUpdateTestState(t)
	setAffiliateRebateSettings(t, 10, 0, 0)
	inviter := createRebateTestUser(t, "dest-inviter", User{Quota: 5})
	createRebateTestUser(t, "dest-source", User{InviterId: inviter.Id, AffiliateRebateEarned: 100})
	migrateRebateTestAccounts(t)
	require.NoError(t, addPaidConsumptionDay(DB, inviter.Id, localDayStart(common.GetTimestamp()), 500))
	require.NoError(t, ClaimAffiliateRebateWithRequest(inviter.Id, 20, "platform-1"))
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).First(&user, inviter.Id).Error; err != nil {
			return err
		}
		replayed, err := claimAffiliateRebateTx(tx, &user, 20, "u", "exchange-1")
		assert.False(t, replayed)
		return err
	}))
	summary, err := GetAffiliateRebateSummary(inviter.Id)
	require.NoError(t, err)
	assert.Equal(t, 40, summary.WeekClaimed)
	assert.Equal(t, 10, summary.MaxClaimQuota)
	require.Error(t, ClaimAffiliateRebateWithRequest(inviter.Id, 11, "platform-2"))
	require.NoError(t, DB.First(&inviter, inviter.Id).Error)
	assert.Equal(t, 25, inviter.Quota)
	_, err = AdjustAffiliateRebate(inviter.Id, common.RoleRootUser, "grant", 60, 1)
	require.NoError(t, err)
	_, err = AdjustAffiliateRebate(inviter.Id, common.RoleRootUser, "grant", 1, 1)
	require.Error(t, err)
	claimed, err := recentClaimedRebate(DB, inviter.Id)
	require.NoError(t, err)
	assert.Equal(t, 40, claimed)
}

func TestAffiliateClaimTransactionRollbackRestoresRebateAndRequestID(t *testing.T) {
	setupUserUpdateTestState(t)
	setAffiliateRebateSettings(t, 10, 0, 0)
	inviter := createRebateTestUser(t, "rollback-inviter", User{})
	createRebateTestUser(t, "rollback-source", User{InviterId: inviter.Id, AffiliateRebateEarned: 20})
	migrateRebateTestAccounts(t)
	require.NoError(t, addPaidConsumptionDay(DB, inviter.Id, localDayStart(common.GetTimestamp()), 200))
	failure := errors.New("target wallet failed")
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).First(&user, inviter.Id).Error; err != nil {
			return err
		}
		if _, err := claimAffiliateRebateTx(tx, &user, 10, "u", "rolled-back"); err != nil {
			return err
		}
		return failure
	})
	require.ErrorIs(t, err, failure)
	summary, err := GetAffiliateRebateSummary(inviter.Id)
	require.NoError(t, err)
	assert.Equal(t, 20, summary.Claimable)
	assert.Zero(t, summary.WeekClaimed)
	require.NoError(t, ClaimAffiliateRebateWithRequest(inviter.Id, 10, "rolled-back"))
}

func TestAffiliateMissingMigrationDoesNotCreateZeroOpeningAccount(t *testing.T) {
	setupUserUpdateTestState(t)
	inviter := createRebateTestUser(t, "unmigrated-inviter", User{})
	createRebateTestUser(t, "unmigrated-source", User{InviterId: inviter.Id, AffiliateRebateEarned: 20})
	require.NoError(t, DB.Where(commonKeyCol+" = ?", affiliateAccountBackfillOption).Delete(&Option{}).Error)
	t.Cleanup(func() {
		DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&Option{Key: affiliateAccountBackfillOption, Value: "true"})
	})
	require.Error(t, DB.Transaction(func(tx *gorm.DB) error { _, err := lockAffiliateAccount(tx, inviter.Id); return err }))
	var count int64
	require.NoError(t, DB.Model(&AffiliateAccount{}).Where("user_id = ?", inviter.Id).Count(&count).Error)
	assert.Zero(t, count)
	require.NoError(t, backfillAffiliateAccounts())
	amount, err := accruedAffiliateRebate(DB, inviter.Id)
	require.NoError(t, err)
	assert.Equal(t, 20, amount)
}

func TestAffiliateDeletedSourcesRetainLateUsageAndRefunds(t *testing.T) {
	for _, mode := range []string{"soft", "hard", "batch-soft", "batch-hard"} {
		t.Run(mode, func(t *testing.T) {
			setupUserUpdateTestState(t)
			resetBatchUpdateTestState(t)
			setAffiliateRebateSettings(t, 10, 0, 0)
			inviter := createRebateTestUser(t, "late-inviter", User{})
			source := createRebateTestUser(t, "late-source", User{InviterId: inviter.Id, Quota: 1000, UnpaidQuotaBalance: 20, PaidQuotaConsumed: 100, AffiliateRebateCovered: 100, AffiliateRebateEarned: 10})
			migrateRebateTestAccounts(t)
			require.NoError(t, DB.Create(&AffiliateCashWallet{UserID: inviter.Id, Available: 1000000, Frozen: 2000000}).Error)
			batch := mode == "batch-soft" || mode == "batch-hard"
			if batch {
				common.BatchUpdateEnabled = true
				RecordUserUsedQuota(source.Id, 50, true, true)
			}
			var err error
			if mode == "hard" || mode == "batch-hard" {
				_, err = source.HardDelete()
			} else {
				_, err = source.Delete()
			}
			require.NoError(t, err)
			if batch {
				batchUpdate()
			} else {
				// 请求已受理但上游在删除后才返回，继续记录其实际结算。
				require.NoError(t, applyAttributedUsage(DB, source.Id, 50, 50, 50, 0, 1))
			}
			var account AffiliateAccount
			require.NoError(t, DB.First(&account, inviter.Id).Error)
			assert.Equal(t, 13, account.Accrued)
			assert.Equal(t, 30, paidConsumptionToday(t, source.Id))
			require.NoError(t, applyAttributedUsage(DB, source.Id, -30, -30, -30, 0, 0))
			require.NoError(t, DB.First(&account, inviter.Id).Error)
			assert.Equal(t, 10, account.Accrued)
			var wallet AffiliateCashWallet
			require.NoError(t, DB.First(&wallet, inviter.Id).Error)
			assert.Equal(t, int64(1000000), wallet.Available)
			assert.Equal(t, int64(2000000), wallet.Frozen)
			assert.Error(t, ClaimAffiliateRebate(source.Id, 1))
			var visible User
			assert.ErrorIs(t, DB.First(&visible, source.Id).Error, gorm.ErrRecordNotFound)
			if mode == "hard" || mode == "batch-hard" {
				var archived AffiliateSettlementSource
				require.NoError(t, DB.First(&archived, source.Id).Error)
				assert.Equal(t, 100, archived.PaidQuotaConsumed)
				assert.Zero(t, archived.UnpaidQuotaBalance)
				assert.Equal(t, 10, archived.AffiliateRebateEarned)
				assert.ErrorIs(t, DB.Unscoped().First(&visible, source.Id).Error, gorm.ErrRecordNotFound)
			}
		})
	}
}

func TestAffiliateConcurrentHardDeleteAndSettlementPreserveSource(t *testing.T) {
	setupUserUpdateTestState(t)
	setAffiliateRebateSettings(t, 10, 0, 0)
	inviter := createRebateTestUser(t, "race-inviter", User{})
	source := createRebateTestUser(t, "race-source", User{InviterId: inviter.Id, Quota: 1000, PaidQuotaConsumed: 100, AffiliateRebateCovered: 100, AffiliateRebateEarned: 10})
	migrateRebateTestAccounts(t)
	start := make(chan struct{})
	results := make(chan error, 2)
	var workers sync.WaitGroup
	workers.Go(func() {
		<-start
		_, err := source.HardDelete()
		results <- err
	})
	workers.Go(func() {
		<-start
		results <- applyAttributedUsage(DB, source.Id, 50, 50, 50, 0, 1)
	})
	close(start)
	workers.Wait()
	close(results)
	for err := range results {
		require.NoError(t, err)
	}
	var account AffiliateAccount
	require.NoError(t, DB.First(&account, inviter.Id).Error)
	assert.Equal(t, 15, account.Accrued)
	var archived AffiliateSettlementSource
	require.NoError(t, DB.First(&archived, source.Id).Error)
	assert.Equal(t, 150, archived.PaidQuotaConsumed)
	assert.Equal(t, 15, archived.AffiliateRebateEarned)
	var entries int64
	require.NoError(t, DB.Model(&AffiliateLedgerEntry{}).Where("user_id = ? AND kind = ?", inviter.Id, "earned").Count(&entries).Error)
	assert.EqualValues(t, 1, entries)
}

func TestAffiliateSourceArchiveFailureKeepsUser(t *testing.T) {
	setupUserUpdateTestState(t)
	source := createRebateTestUser(t, "archive-failure", User{})
	callback := "test:fail_affiliate_source_archive"
	require.NoError(t, DB.Callback().Create().Before("gorm:create").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "AffiliateSettlementSource" {
			tx.AddError(errors.New("source archive unavailable"))
		}
	}))
	t.Cleanup(func() { require.NoError(t, DB.Callback().Create().Remove(callback)) })
	_, err := source.HardDelete()
	require.Error(t, err)
	var existing User
	require.NoError(t, DB.First(&existing, source.Id).Error)
	var archived int64
	require.NoError(t, DB.Model(&AffiliateSettlementSource{}).Where("user_id = ?", source.Id).Count(&archived).Error)
	assert.Zero(t, archived)
}
