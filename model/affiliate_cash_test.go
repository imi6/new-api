package model

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func setupAffiliateCashTest(t *testing.T) (User, AffiliateCashSettings) {
	t.Helper()
	setupUserUpdateTestState(t)
	setAffiliateRebateSettings(t, 10, 0, 0)
	require.NoError(t, DB.Where(&Option{Key: affiliateCashSettingKey}).Delete(&Option{}).Error)
	t.Cleanup(func() { require.NoError(t, DB.Where(&Option{Key: affiliateCashSettingKey}).Delete(&Option{}).Error) })
	user := createRebateTestUser(t, "cash-owner", User{Quota: 25, PaidQuotaConsumed: 10000})
	require.NoError(t, DB.Create(&AffiliateAccount{UserID: user.Id, Accrued: 1000}).Error)
	require.NoError(t, addPaidConsumptionDay(DB, user.Id, localDayStart(common.GetTimestamp()), 10000))
	settings, err := GetAffiliateCashSettings()
	require.NoError(t, err)
	settings.ExchangeEnabled, settings.WithdrawalEnabled = true, true
	settings.ExchangeRate, settings.MinimumWithdrawal = "0.1", "2"
	settings.FeeMode, settings.FeeFixed = "fixed", "1"
	settings.MinimumBasis, settings.CancelFeePolicy, settings.FailedFeePolicy = "requested", "refund", "refund"
	settings.Networks = []AffiliateCashNetwork{{ID: "ethereum", Name: "Ethereum", AddressKind: "evm", Enabled: true}}
	settings, err = SaveAffiliateCashSettings(settings)
	require.NoError(t, err)
	return user, settings
}

func fundAffiliateCashTest(t *testing.T, user User, settings AffiliateCashSettings) {
	t.Helper()
	_, err := ExchangeAffiliateCash(user.Id, AffiliateExchangeRequest{Quota: 100, Destination: "u", RequestID: "fund", ConfigVersion: settings.Version, Confirmed: true})
	require.NoError(t, err)
}

func TestAffiliateCashExchangeHasOneDestinationAndIdempotentReceipt(t *testing.T) {
	user, settings := setupAffiliateCashTest(t)
	req := AffiliateExchangeRequest{Quota: 100, Destination: "u", RequestID: "exchange-1", ConfigVersion: settings.Version, Confirmed: true}
	first, err := ExchangeAffiliateCash(user.Id, req)
	require.NoError(t, err)
	assert.Equal(t, "10", first.UAmount)
	settings.ExchangeEnabled = false
	_, err = SaveAffiliateCashSettings(settings)
	require.NoError(t, err)
	replay, err := ExchangeAffiliateCash(user.Id, req)
	require.NoError(t, err)
	assert.Equal(t, first.ID, replay.ID)
	req.Destination = "platform"
	_, err = ExchangeAffiliateCash(user.Id, req)
	assert.Error(t, err)
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, 25, user.Quota)
	assert.Zero(t, user.UnpaidQuotaBalance)
	assert.Equal(t, 100, user.AffiliateRebateClaimed)
	claimed, err := recentClaimedRebate(DB, user.Id)
	require.NoError(t, err)
	assert.Equal(t, 100, claimed)
	var wallet AffiliateCashWallet
	require.NoError(t, DB.First(&wallet, user.Id).Error)
	assert.Equal(t, int64(10000000), wallet.Available)
	assert.Zero(t, wallet.Frozen)
	page := &common.PageInfo{Page: 1, PageSize: 10}
	require.NoError(t, GetAffiliateCashLedger(user.Id, page))
	entries, ok := page.Items.([]AffiliateCashLedgerView)
	require.True(t, ok)
	require.Len(t, entries, 1)
	assert.Equal(t, "claim_u", entries[0].Kind)
	assert.Equal(t, "10", entries[0].UAmount)
	assert.Equal(t, "0.1", entries[0].ExchangeRate)
}

func TestAffiliateCashRejectsStalePreviewAndRollsBackWalletOverflow(t *testing.T) {
	user, settings := setupAffiliateCashTest(t)
	req := AffiliateExchangeRequest{Quota: 100, Destination: "u", RequestID: "stale", ConfigVersion: settings.Version, Confirmed: true}
	settings.ExchangeRate = "0.2"
	settings, err := SaveAffiliateCashSettings(settings)
	require.NoError(t, err)
	_, err = ExchangeAffiliateCash(user.Id, req)
	assert.Error(t, err)
	req.ConfigVersion, req.RequestID = settings.Version, "overflow"
	require.NoError(t, DB.Create(&AffiliateCashWallet{UserID: user.Id, Available: affiliateCashMaximum}).Error)
	_, err = ExchangeAffiliateCash(user.Id, req)
	assert.Error(t, err)
	var account AffiliateAccount
	require.NoError(t, DB.First(&account, user.Id).Error)
	assert.Zero(t, account.Claimed)
	var claims int64
	require.NoError(t, DB.Model(&AffiliateRebateClaim{}).Where("user_id = ?", user.Id).Count(&claims).Error)
	assert.Zero(t, claims)
}

func TestAffiliateCashRequestIDsCannotCrossClaimDestinations(t *testing.T) {
	user, settings := setupAffiliateCashTest(t)
	require.NoError(t, ClaimAffiliateRebateWithRequest(user.Id, 20, "legacy-platform"))
	_, err := ExchangeAffiliateCash(user.Id, AffiliateExchangeRequest{Quota: 20, Destination: "u", RequestID: "legacy-platform", ConfigVersion: settings.Version, Confirmed: true})
	assert.Error(t, err)
	fundAffiliateCashTest(t, user, settings)
	assert.Error(t, ClaimAffiliateRebateWithRequest(user.Id, 100, "fund"))
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, 45, user.Quota)
	assert.Equal(t, 120, user.AffiliateRebateClaimed)
}

func TestAffiliateCashMaximumIncludesTargetWalletCapacity(t *testing.T) {
	user, _ := setupAffiliateCashTest(t)
	require.NoError(t, DB.Model(&user).Update("quota", common.MaxWalletQuota-5).Error)
	require.NoError(t, DB.Create(&AffiliateCashWallet{UserID: user.Id, Available: affiliateCashMaximum - 300000}).Error)
	summary, err := GetAffiliateCashSummary(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 5, summary.MaxPlatformClaimQuota)
	assert.Equal(t, 3, summary.MaxUExchangeQuota)
}

func TestAffiliateWithdrawalLocksFeesAndRefundsOnlyOnce(t *testing.T) {
	user, settings := setupAffiliateCashTest(t)
	fundAffiliateCashTest(t, user, settings)
	req := AffiliateWithdrawalRequest{Amount: "10", Network: "ethereum", Address: "0x1111111111111111111111111111111111111111", RequestID: "withdraw-1", ConfigVersion: settings.Version}
	order, err := CreateAffiliateWithdrawal(user.Id, req)
	require.NoError(t, err)
	assert.Equal(t, "1", order.Fee)
	assert.Equal(t, "9", order.NetAmount)
	settings.FeeFixed, settings.CancelFeePolicy = "3", "retain"
	_, err = SaveAffiliateCashSettings(settings)
	require.NoError(t, err)
	replay, err := CreateAffiliateWithdrawal(user.Id, req)
	require.NoError(t, err)
	assert.Equal(t, order.ID, replay.ID)
	_, err = ActOnAffiliateWithdrawal(order.ID, user.Id+1, false, AffiliateWithdrawalAction{Action: "cancel", RequestID: "other", ExpectedVersion: order.Version})
	assert.Error(t, err)
	cancel := AffiliateWithdrawalAction{Action: "cancel", RequestID: "cancel-1", ExpectedVersion: order.Version}
	order, err = ActOnAffiliateWithdrawal(order.ID, user.Id, false, cancel)
	require.NoError(t, err)
	_, err = ActOnAffiliateWithdrawal(order.ID, user.Id, false, cancel)
	require.NoError(t, err)
	cancel.RequestID = "cancel-2"
	cancel.ExpectedVersion = order.Version
	_, err = ActOnAffiliateWithdrawal(order.ID, user.Id, false, cancel)
	assert.Error(t, err)
	var wallet AffiliateCashWallet
	require.NoError(t, DB.First(&wallet, user.Id).Error)
	assert.Equal(t, int64(10000000), wallet.Available)
	assert.Zero(t, wallet.Frozen)
	claimed, err := recentClaimedRebate(DB, user.Id)
	require.NoError(t, err)
	assert.Equal(t, 100, claimed)
}

func TestAffiliateWithdrawalPaymentStateAndEvidenceAreFinal(t *testing.T) {
	user, settings := setupAffiliateCashTest(t)
	fundAffiliateCashTest(t, user, settings)
	req := AffiliateWithdrawalRequest{Amount: "10", Network: "ethereum", Address: "0x1111111111111111111111111111111111111111", RequestID: "pay-1", ConfigVersion: settings.Version}
	order, err := CreateAffiliateWithdrawal(user.Id, req)
	require.NoError(t, err)
	order, err = ActOnAffiliateWithdrawal(order.ID, 42, true, AffiliateWithdrawalAction{Action: "approve", RequestID: "approve", ExpectedVersion: order.Version})
	require.NoError(t, err)
	order, err = ActOnAffiliateWithdrawal(order.ID, 42, true, AffiliateWithdrawalAction{Action: "start", RequestID: "start", ExpectedVersion: order.Version})
	require.NoError(t, err)
	for _, action := range []string{"cancel", "reject", "start"} {
		_, err = ActOnAffiliateWithdrawal(order.ID, 42, true, AffiliateWithdrawalAction{Action: action, RequestID: "forbidden-" + action, Reason: "unknown outcome", ExpectedVersion: order.Version})
		assert.Error(t, err)
	}
	complete := AffiliateWithdrawalAction{Action: "complete", RequestID: "complete", TransactionID: strings.Repeat("a", 64), ActualAmount: "10", Network: req.Network, Address: req.Address, ExpectedVersion: order.Version}
	_, err = ActOnAffiliateWithdrawal(order.ID, 42, true, complete)
	assert.Error(t, err)
	complete.ActualAmount = "9"
	order, err = ActOnAffiliateWithdrawal(order.ID, 42, true, complete)
	require.NoError(t, err)
	assert.Equal(t, "completed", order.Status)
	_, err = ActOnAffiliateWithdrawal(order.ID, 42, true, complete)
	require.NoError(t, err)
	for _, action := range []string{"reject", "fail_release", "fail_retry"} {
		_, err = ActOnAffiliateWithdrawal(order.ID, 42, true, AffiliateWithdrawalAction{Action: action, RequestID: "after-" + action, Reason: "cannot reopen paid order", ExpectedVersion: order.Version})
		assert.Error(t, err)
	}
	_, err = ActOnAffiliateWithdrawal(order.ID, 42, true, AffiliateWithdrawalAction{Action: "correct", RequestID: "correction", Reason: "补充核对说明，不改变付款结果", ExpectedVersion: order.Version})
	require.NoError(t, err)
	detail, err := GetAffiliateWithdrawalDetail(order.ID)
	require.NoError(t, err)
	assert.Len(t, detail.Corrections, 1)
	assert.Equal(t, "completed", detail.Withdrawal.Status)
	var wallet AffiliateCashWallet
	require.NoError(t, DB.First(&wallet, user.Id).Error)
	assert.Zero(t, wallet.Available)
	assert.Zero(t, wallet.Frozen)
}

func TestAffiliateWithdrawalCompletionFailureRollsBackPaymentAndFreeze(t *testing.T) {
	user, settings := setupAffiliateCashTest(t)
	fundAffiliateCashTest(t, user, settings)
	order, err := CreateAffiliateWithdrawal(user.Id, AffiliateWithdrawalRequest{Amount: "10", Network: "ethereum", Address: "0x1111111111111111111111111111111111111111", RequestID: "rollback-order", ConfigVersion: settings.Version})
	require.NoError(t, err)
	for _, action := range []string{"approve", "start"} {
		order, err = ActOnAffiliateWithdrawal(order.ID, 42, true, AffiliateWithdrawalAction{Action: action, RequestID: action, ExpectedVersion: order.Version})
		require.NoError(t, err)
	}
	// 模拟最终审计写入失败，验证此前余额、状态和凭据均随事务回滚。
	callback := "test:fail_withdrawal_event"
	require.NoError(t, DB.Callback().Create().Before("gorm:create").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "AffiliateWithdrawalEvent" {
			tx.AddError(errors.New("event storage unavailable"))
		}
	}))
	t.Cleanup(func() { require.NoError(t, DB.Callback().Create().Remove(callback)) })
	_, err = ActOnAffiliateWithdrawal(order.ID, 42, true, AffiliateWithdrawalAction{Action: "complete", RequestID: "completion", TransactionID: strings.Repeat("b", 64), ActualAmount: "9", Network: order.Network, Address: order.Address, ExpectedVersion: order.Version})
	assert.Error(t, err)
	require.NoError(t, DB.First(order, order.ID).Error)
	assert.Equal(t, "paying", order.Status)
	var wallet AffiliateCashWallet
	require.NoError(t, DB.First(&wallet, user.Id).Error)
	assert.Equal(t, int64(10000000), wallet.Frozen)
	var proofs int64
	require.NoError(t, DB.Model(&AffiliateWithdrawalProof{}).Where("withdrawal_id = ?", order.ID).Count(&proofs).Error)
	assert.Zero(t, proofs)
}

func TestAffiliateWithdrawalFailureKeepsFreezeUntilExplicitDisposition(t *testing.T) {
	user, settings := setupAffiliateCashTest(t)
	settings.FailedFeePolicy = "retain"
	settings, err := SaveAffiliateCashSettings(settings)
	require.NoError(t, err)
	fundAffiliateCashTest(t, user, settings)
	order, err := CreateAffiliateWithdrawal(user.Id, AffiliateWithdrawalRequest{Amount: "10", Network: "ethereum", Address: "0x1111111111111111111111111111111111111111", RequestID: "failure-order", ConfigVersion: settings.Version})
	require.NoError(t, err)
	for i, action := range []string{"approve", "start", "fail_retry", "start"} {
		order, err = ActOnAffiliateWithdrawal(order.ID, 42, true, AffiliateWithdrawalAction{Action: action, RequestID: fmt.Sprintf("%s-%d", action, i), Reason: "已核实本次未付款", UnpaidConfirmed: true, ExpectedVersion: order.Version})
		require.NoError(t, err)
		require.NoError(t, DB.First(order, order.ID).Error)
	}
	var wallet AffiliateCashWallet
	require.NoError(t, DB.First(&wallet, user.Id).Error)
	assert.Equal(t, int64(10000000), wallet.Frozen)
	for _, action := range []string{"fail_release", "fail_retry"} {
		_, err = ActOnAffiliateWithdrawal(order.ID, 42, true, AffiliateWithdrawalAction{Action: action, RequestID: "unconfirmed-" + action, Reason: "超时且付款结果不明", ExpectedVersion: order.Version})
		assert.Error(t, err)
	}
	_, err = ActOnAffiliateWithdrawal(order.ID, 42, true, AffiliateWithdrawalAction{Action: "fail_release", RequestID: "end-failure", Reason: "确认未付款并结束", UnpaidConfirmed: true, ExpectedVersion: order.Version})
	require.NoError(t, err)
	require.NoError(t, DB.First(&wallet, user.Id).Error)
	assert.Equal(t, int64(9000000), wallet.Available)
	assert.Zero(t, wallet.Frozen)
}

func TestAffiliateWithdrawalNetworkChangesPreserveExistingOrders(t *testing.T) {
	user, settings := setupAffiliateCashTest(t)
	fundAffiliateCashTest(t, user, settings)
	order, err := CreateAffiliateWithdrawal(user.Id, AffiliateWithdrawalRequest{Amount: "10", Network: "ethereum", Address: "0x1111111111111111111111111111111111111111", RequestID: "network-order", ConfigVersion: settings.Version})
	require.NoError(t, err)
	settings.Networks[0].AddressKind = "tron"
	_, err = SaveAffiliateCashSettings(settings)
	assert.Error(t, err)
	settings.Networks[0].AddressKind, settings.Networks[0].Enabled = "evm", false
	settings.WithdrawalEnabled = false
	_, err = SaveAffiliateCashSettings(settings)
	require.NoError(t, err)
	_, err = ActOnAffiliateWithdrawal(order.ID, 42, true, AffiliateWithdrawalAction{Action: "reject", RequestID: "reject-disabled", Reason: "网络停用", ExpectedVersion: order.Version})
	require.NoError(t, err)
	var wallet AffiliateCashWallet
	require.NoError(t, DB.First(&wallet, user.Id).Error)
	assert.Equal(t, int64(10000000), wallet.Available)
	assert.Zero(t, wallet.Frozen)
}

func TestAffiliateWithdrawalRejectsStalePaymentAttemptsAndReplays(t *testing.T) {
	user, settings := setupAffiliateCashTest(t)
	fundAffiliateCashTest(t, user, settings)
	order, err := CreateAffiliateWithdrawal(user.Id, AffiliateWithdrawalRequest{Amount: "10", Network: "ethereum", Address: "0x1111111111111111111111111111111111111111", RequestID: "attempt-order", ConfigVersion: settings.Version})
	require.NoError(t, err)
	assert.Equal(t, int64(1), order.Version)
	_, err = ActOnAffiliateWithdrawal(order.ID, 42, true, AffiliateWithdrawalAction{Action: "approve", RequestID: "without-version"})
	require.Error(t, err)
	order, err = ActOnAffiliateWithdrawal(order.ID, 42, true, AffiliateWithdrawalAction{Action: "approve", RequestID: "approve", ExpectedVersion: order.Version})
	require.NoError(t, err)
	firstStart := AffiliateWithdrawalAction{Action: "start", RequestID: "first-start", ExpectedVersion: order.Version}
	order, err = ActOnAffiliateWithdrawal(order.ID, 42, true, firstStart)
	require.NoError(t, err)
	firstAttemptVersion := order.Version
	// 请求重试仍处于同一付款轮次时只返回原回执，不增加事件或版本。
	replayed, err := ActOnAffiliateWithdrawal(order.ID, 42, true, firstStart)
	require.NoError(t, err)
	assert.Equal(t, firstAttemptVersion, replayed.Version)
	firstRetry := AffiliateWithdrawalAction{Action: "fail_retry", RequestID: "first-retry", Reason: "已确认第一轮未付款", UnpaidConfirmed: true, ExpectedVersion: order.Version}
	order, err = ActOnAffiliateWithdrawal(order.ID, 42, true, firstRetry)
	require.NoError(t, err)
	order, err = ActOnAffiliateWithdrawal(order.ID, 42, true, AffiliateWithdrawalAction{Action: "start", RequestID: "second-start", ExpectedVersion: order.Version})
	require.NoError(t, err)
	assert.Equal(t, int64(5), order.Version)
	for _, stale := range []AffiliateWithdrawalAction{
		firstStart,
		firstRetry,
		{Action: "fail_release", RequestID: "stale-release", ExpectedVersion: firstAttemptVersion, Reason: "旧页面仍认为第一轮未付款", UnpaidConfirmed: true},
		{Action: "fail_retry", RequestID: "stale-retry", ExpectedVersion: firstAttemptVersion, Reason: "旧页面请求重试", UnpaidConfirmed: true},
		{Action: "complete", RequestID: "stale-complete", ExpectedVersion: firstAttemptVersion, TransactionID: strings.Repeat("c", 64), ActualAmount: "9", Network: order.Network, Address: order.Address},
	} {
		_, err = ActOnAffiliateWithdrawal(order.ID, 42, true, stale)
		require.Error(t, err, stale.RequestID)
		assert.Contains(t, err.Error(), "The withdrawal state changed", stale.RequestID)
	}
	detail, err := GetAffiliateWithdrawalDetail(order.ID)
	require.NoError(t, err)
	assert.Equal(t, "paying", detail.Withdrawal.Status)
	assert.Equal(t, int64(5), detail.Withdrawal.Version)
	assert.Len(t, detail.Attempts, 4)
	var wallet AffiliateCashWallet
	require.NoError(t, DB.First(&wallet, user.Id).Error)
	assert.Zero(t, wallet.Available)
	assert.Equal(t, int64(10000000), wallet.Frozen)
	var proofs int64
	require.NoError(t, DB.Model(&AffiliateWithdrawalProof{}).Where("withdrawal_id = ?", order.ID).Count(&proofs).Error)
	assert.Zero(t, proofs)
}

func TestAffiliateWithdrawalCorrectionSurvivesAccountDeletion(t *testing.T) {
	for _, permanently := range []bool{false, true} {
		t.Run(fmt.Sprintf("permanently=%t", permanently), func(t *testing.T) {
			user, settings := setupAffiliateCashTest(t)
			fundAffiliateCashTest(t, user, settings)
			order, err := CreateAffiliateWithdrawal(user.Id, AffiliateWithdrawalRequest{Amount: "10", Network: "ethereum", Address: "0x1111111111111111111111111111111111111111", RequestID: "deleted-owner-order", ConfigVersion: settings.Version})
			require.NoError(t, err)
			for _, action := range []string{"approve", "start", "complete"} {
				order, err = ActOnAffiliateWithdrawal(order.ID, 42, true, AffiliateWithdrawalAction{Action: action, RequestID: action, ExpectedVersion: order.Version, TransactionID: strings.Repeat("d", 64), ActualAmount: "9", Network: order.Network, Address: order.Address})
				require.NoError(t, err)
			}
			// 模拟历史账户已删除，完成单仍须保留独立审计能力。
			query := DB
			if permanently {
				query = query.Unscoped()
			}
			require.NoError(t, query.Delete(&user).Error)
			original := *order
			correction := AffiliateWithdrawalAction{Action: "correct", RequestID: "deleted-owner-correction", ExpectedVersion: order.Version, Reason: "补充对账信息，保持原始付款结果"}
			_, err = ActOnAffiliateWithdrawal(order.ID, user.Id, false, correction)
			require.Error(t, err)
			order, err = ActOnAffiliateWithdrawal(order.ID, 42, true, correction)
			require.NoError(t, err)
			_, err = ActOnAffiliateWithdrawal(order.ID, 42, true, correction)
			require.NoError(t, err)
			assert.Equal(t, original.Version+1, order.Version)
			order.Version = original.Version
			assert.Equal(t, original, *order)
			detail, err := GetAffiliateWithdrawalDetail(order.ID)
			require.NoError(t, err)
			assert.Len(t, detail.Corrections, 1)
			var wallet AffiliateCashWallet
			require.NoError(t, DB.First(&wallet, user.Id).Error)
			assert.Zero(t, wallet.Available)
			assert.Zero(t, wallet.Frozen)
		})
	}
}

func TestAffiliateCashSettingsRequireAnAttainableWithdrawal(t *testing.T) {
	_, settings := setupAffiliateCashTest(t)
	for _, test := range []struct {
		name, mode, fixed, percent, minimum, basis string
		wantError                                  bool
	}{
		{"all retained by percent", "percent", "", "100", "2", "requested", true},
		{"all retained by fixed fee", "fixed", formatAffiliateCashAmount(affiliateCashMaximum), "", "2", "requested", true},
		{"combined fee exceeds capacity", "both", formatAffiliateCashAmount(affiliateCashMaximum - 1), "0.000001", "2", "requested", true},
		{"net minimum is unreachable", "fixed", "1", "", formatAffiliateCashAmount(affiliateCashMaximum), "net", true},
		{"requested minimum is reachable", "fixed", "1", "", formatAffiliateCashAmount(affiliateCashMaximum), "requested", false},
		{"positive maximum payout", "percent", "", "99.999999", "2", "net", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			candidate := settings
			candidate.FeeMode, candidate.FeeFixed, candidate.FeePercent = test.mode, test.fixed, test.percent
			candidate.MinimumWithdrawal, candidate.MinimumBasis = test.minimum, test.basis
			err := validateAffiliateCashSettings(candidate)
			if test.wantError {
				require.Error(t, err)
				assert.Contains(t, err.Error(), "must allow a positive payout")
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestAffiliateCashLegacyImpossibleFeesBlockExchangeButCanBeDisabled(t *testing.T) {
	user, settings := setupAffiliateCashTest(t)
	settings.FeeMode, settings.FeePercent = "percent", "100"
	_, err := SaveAffiliateCashSettings(settings)
	require.Error(t, err)
	// 模拟升级前已保存的无效费率，后台和摘要均不能继续放行不可逆兑换。
	encoded, err := common.Marshal(settings)
	require.NoError(t, err)
	require.NoError(t, DB.Model(&Option{}).Where(&Option{Key: affiliateCashSettingKey}).Update("value", string(encoded)).Error)
	settings, err = GetAffiliateCashSettings()
	require.NoError(t, err)
	summary, err := GetAffiliateCashSummary(user.Id)
	require.NoError(t, err)
	assert.False(t, summary.CanExchange)
	assert.False(t, summary.CanWithdraw)
	assert.Zero(t, summary.MaxUExchangeQuota)
	assert.Positive(t, summary.MaxPlatformClaimQuota)
	_, err = ExchangeAffiliateCash(user.Id, AffiliateExchangeRequest{Quota: 100, Destination: "u", RequestID: "impossible", ConfigVersion: settings.Version, Confirmed: true})
	require.Error(t, err)
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Zero(t, user.AffiliateRebateClaimed)
	_, err = ExchangeAffiliateCash(user.Id, AffiliateExchangeRequest{Quota: 100, Destination: "platform", RequestID: "still-platform", ConfigVersion: settings.Version})
	require.NoError(t, err)
	settings.WithdrawalEnabled = false
	settings, err = SaveAffiliateCashSettings(settings)
	require.NoError(t, err)
	settings.WithdrawalEnabled, settings.Networks[0].Enabled = true, false
	_, err = SaveAffiliateCashSettings(settings)
	require.NoError(t, err)
}

func TestAffiliateWithdrawalDisplayUsesSettledAmounts(t *testing.T) {
	for _, test := range []struct {
		status, policy, actual, fee, refund string
	}{
		{"pending", "refund", "0", "0", "0"},
		{"approved", "refund", "0", "0", "0"},
		{"paying", "refund", "0", "0", "0"},
		{"completed", "refund", "9", "1", "0"},
		{"rejected", "retain", "0", "0", "10"},
		{"cancelled", "refund", "0", "0", "10"},
		{"cancelled", "retain", "0", "1", "9"},
		{"failed", "refund", "0", "0", "10"},
		{"failed", "retain", "0", "1", "9"},
	} {
		t.Run(test.status+"_"+test.policy, func(t *testing.T) {
			order := AffiliateWithdrawal{AmountUnits: 10000000, FeeUnits: 1000000, NetUnits: 9000000, Status: test.status, CancelFeePolicy: test.policy, FailedFeePolicy: test.policy}
			order.amountsForDisplay()
			assert.Equal(t, "10", order.Amount)
			assert.Equal(t, "1", order.Fee)
			assert.Equal(t, "9", order.NetAmount)
			assert.Equal(t, test.actual, order.ActualAmount)
			assert.Equal(t, test.fee, order.ActualFee)
			assert.Equal(t, test.refund, order.RefundedAmount)
		})
	}
}

func TestAffiliateWithdrawalFeeRulesAndAddressValidation(t *testing.T) {
	_, settings := setupAffiliateCashTest(t)
	for _, test := range []struct {
		name, amount, address, basis string
		wantFee                      int64
		wantError                    bool
	}{
		{"exact minimum", "2", "0x1111111111111111111111111111111111111111", "requested", 1000000, false},
		{"net below minimum", "2", "0x1111111111111111111111111111111111111111", "net", 0, true},
		{"fee consumes all", "1", "0x1111111111111111111111111111111111111111", "requested", 0, true},
		{"negative", "-1", "0x1111111111111111111111111111111111111111", "requested", 0, true},
		{"too precise", "3.0000001", "0x1111111111111111111111111111111111111111", "requested", 0, true},
		{"wrong network format", "10", "bad-address", "requested", 0, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			settings.MinimumBasis = test.basis
			_, fee, err := calculateAffiliateWithdrawal(settings, AffiliateWithdrawalRequest{Amount: test.amount, Network: "ethereum", Address: test.address})
			if test.wantError {
				assert.Error(t, err)
			} else {
				require.NoError(t, err)
				assert.Equal(t, test.wantFee, fee)
			}
		})
	}
	assert.True(t, validAffiliateCashAddress("tron", "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7"))
	assert.False(t, validAffiliateCashAddress("tron", "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU8"))
}

func TestAffiliateWithdrawalConcurrentApplicationsCannotOverdraw(t *testing.T) {
	user, settings := setupAffiliateCashTest(t)
	fundAffiliateCashTest(t, user, settings)
	errors := make(chan error, 2)
	start := make(chan struct{})
	var workers sync.WaitGroup
	for i := range 2 {
		workers.Go(func() {
			<-start
			_, err := CreateAffiliateWithdrawal(user.Id, AffiliateWithdrawalRequest{Amount: "10", Network: "ethereum", Address: "0x1111111111111111111111111111111111111111", RequestID: fmt.Sprintf("concurrent-%d", i), ConfigVersion: settings.Version})
			errors <- err
		})
	}
	close(start)
	workers.Wait()
	close(errors)
	successes := 0
	for err := range errors {
		if err == nil {
			successes++
		}
	}
	assert.Equal(t, 1, successes)
	var wallet AffiliateCashWallet
	require.NoError(t, DB.First(&wallet, user.Id).Error)
	assert.Zero(t, wallet.Available)
	assert.Equal(t, int64(10000000), wallet.Frozen)
	_, err := user.Delete()
	assert.Error(t, err)
	_, err = user.HardDelete()
	assert.Error(t, err)
}

func TestAffiliateCashDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(":memory:")
			case "mysql":
				if os.Getenv("TEST_MYSQL_DSN") == "" {
					t.Skip("TEST_MYSQL_DSN is not configured")
				}
				driver = mysql.Open(os.Getenv("TEST_MYSQL_DSN"))
			case "postgres":
				if os.Getenv("TEST_POSTGRES_DSN") == "" {
					t.Skip("TEST_POSTGRES_DSN is not configured")
				}
				driver = postgres.Open(os.Getenv("TEST_POSTGRES_DSN"))
			}
			db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "affiliate_cash_v05_test_"}})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			oldDB, oldType := DB, common.MainDatabaseType()
			DB = db
			common.SetMainDatabaseType(common.DatabaseType(dialect))
			initCol()
			models := []any{&User{}, &Option{}, &AffiliateRebateClaim{}, &UserPaidConsumptionDay{}, &AffiliateAccount{}, &AffiliateLedgerEntry{}, &AffiliateSettlementSource{}, &AffiliateCashWallet{}, &AffiliateCashEntry{}, &AffiliateCashExchange{}, &AffiliateWithdrawal{}, &AffiliateWithdrawalEvent{}, &AffiliateWithdrawalProof{}}
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(models...))
				DB = oldDB
				common.SetMainDatabaseType(oldType)
				initCol()
				require.NoError(t, sqlDB.Close())
			})
			var version string
			switch dialect {
			case "sqlite":
				require.NoError(t, db.Raw("SELECT sqlite_version()").Scan(&version).Error)
			case "mysql", "postgres":
				require.NoError(t, db.Raw("SELECT version()").Scan(&version).Error)
			}
			t.Logf("database=%s version=%s", dialect, version)
			// 全新库重复建表不会制造资金；随后以旧表结构和真实存量记录验证升级。
			for range 2 {
				require.NoError(t, db.AutoMigrate(models...))
			}
			require.NoError(t, db.Migrator().DropTable(models...))
			// 用改造前的用户、领取和配置表模拟存量升级，保留超额历史扣减。
			require.NoError(t, db.AutoMigrate(&User{}, &Option{}, &AffiliateRebateClaim{}, &UserPaidConsumptionDay{}))
			require.NoError(t, db.Migrator().DropColumn(&AffiliateRebateClaim{}, "Destination"))
			owner := createRebateTestUser(t, "matrix-owner", User{AffiliateRebateClaimed: 2147483668})
			_ = createRebateTestUser(t, "matrix-source", User{InviterId: owner.Id, AffiliateRebateEarned: 2147483648})
			// 旧表尚无去向字段，升级须保留超过 32 位的金额和原领取时间。
			legacyClaim := AffiliateRebateClaim{UserID: owner.Id, Quota: 2147483648, CreatedAt: common.GetTimestamp() - 3600}
			require.NoError(t, db.Omit("Destination").Create(&legacyClaim).Error)
			require.NoError(t, db.AutoMigrate(&AffiliateWithdrawal{}, &AffiliateWithdrawalEvent{}))
			require.NoError(t, db.Migrator().DropColumn(&AffiliateWithdrawal{}, "Version"))
			require.NoError(t, db.Migrator().DropColumn(&AffiliateWithdrawalEvent{}, "OrderVersion"))
			legacyOrder := AffiliateWithdrawal{UserID: owner.Id, RequestID: "legacy-withdrawal", Status: "completed", AmountUnits: 10000000, FeeUnits: 1000000, NetUnits: 9000000}
			require.NoError(t, db.Omit("Version").Create(&legacyOrder).Error)
			legacyEvent := AffiliateWithdrawalEvent{WithdrawalID: legacyOrder.ID, RequestID: "legacy-completion", Action: "complete", Status: "completed"}
			require.NoError(t, db.Omit("OrderVersion").Create(&legacyEvent).Error)
			for range 2 {
				require.NoError(t, db.AutoMigrate(models...))
				require.NoError(t, backfillAffiliateAccounts())
			}
			var account AffiliateAccount
			require.NoError(t, db.First(&account, owner.Id).Error)
			assert.Equal(t, -20, account.Accrued-account.Claimed)
			var migratedClaim AffiliateRebateClaim
			require.NoError(t, db.First(&migratedClaim, legacyClaim.ID).Error)
			assert.Equal(t, "platform", migratedClaim.Destination)
			assert.Equal(t, legacyClaim.Quota, migratedClaim.Quota)
			assert.Equal(t, legacyClaim.CreatedAt, migratedClaim.CreatedAt)
			var migratedOrder AffiliateWithdrawal
			require.NoError(t, db.First(&migratedOrder, legacyOrder.ID).Error)
			assert.Equal(t, int64(1), migratedOrder.Version)
			assert.Equal(t, legacyOrder.NetUnits, migratedOrder.NetUnits)
			var migratedEvent AffiliateWithdrawalEvent
			require.NoError(t, db.First(&migratedEvent, legacyEvent.ID).Error)
			assert.Zero(t, migratedEvent.OrderVersion)
			require.NoError(t, db.Model(&migratedOrder).Update("version", 3).Error)
			require.NoError(t, db.Create(&AffiliateCashWallet{UserID: owner.Id, Available: 17}).Error)
			archived := AffiliateSettlementSource{UserID: owner.Id + 1000, InviterID: owner.Id, PaidQuotaConsumed: 2147483648, AffiliateRebateCovered: 2147483648, AffiliateRebateEarned: 100}
			require.NoError(t, db.Create(&archived).Error)
			require.NoError(t, db.AutoMigrate(models...))
			require.NoError(t, backfillAffiliateAccounts())
			require.NoError(t, db.First(&migratedOrder, legacyOrder.ID).Error)
			assert.Equal(t, int64(3), migratedOrder.Version)
			var wallet AffiliateCashWallet
			require.NoError(t, db.First(&wallet, owner.Id).Error)
			assert.Equal(t, int64(17), wallet.Available)
			var migratedSource AffiliateSettlementSource
			require.NoError(t, db.First(&migratedSource, archived.UserID).Error)
			assert.Equal(t, archived, migratedSource)
			// 钱包和业务号的唯一性在真实数据库上生效。
			assert.Error(t, db.Create(&AffiliateCashWallet{UserID: owner.Id}).Error)
			entry := AffiliateCashEntry{UserID: owner.Id, BusinessID: "matrix-once", Kind: "exchange"}
			require.NoError(t, db.Create(&entry).Error)
			entry.ID = 0
			assert.Error(t, db.Create(&entry).Error)
		})
	}
}
