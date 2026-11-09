package model

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// U 使用百万分之一整数独立记账，不能参与平台 quota 的消费或缓存。
type AffiliateCashWallet struct {
	UserID    int   `gorm:"primaryKey;autoIncrement:false"`
	Available int64 `gorm:"type:bigint;not null;default:0"`
	Frozen    int64 `gorm:"type:bigint;not null;default:0"`
}

type AffiliateCashEntry struct {
	ID             int64  `gorm:"primaryKey"`
	UserID         int    `gorm:"not null;index;uniqueIndex:idx_cash_entry_business,priority:1"`
	BusinessID     string `gorm:"size:100;not null;uniqueIndex:idx_cash_entry_business,priority:2"`
	Kind           string `gorm:"size:32;not null"`
	AvailableDelta int64  `gorm:"type:bigint;not null"`
	FrozenDelta    int64  `gorm:"type:bigint;not null"`
	AvailableAfter int64  `gorm:"type:bigint;not null"`
	FrozenAfter    int64  `gorm:"type:bigint;not null"`
	WithdrawalID   int64  `gorm:"index"`
	CreatedAt      int64  `gorm:"not null;autoCreateTime:false"`
}

type AffiliateCashExchange struct {
	ID            int64  `json:"id" gorm:"primaryKey"`
	UserID        int    `json:"user_id" gorm:"not null;uniqueIndex:idx_cash_exchange_request,priority:1"`
	RequestID     string `json:"request_id" gorm:"size:64;not null;uniqueIndex:idx_cash_exchange_request,priority:2"`
	Quota         int    `json:"quota" gorm:"type:bigint;not null"`
	Destination   string `json:"destination" gorm:"size:16;not null"`
	UAmount       string `json:"u_amount" gorm:"size:32;not null"`
	ExchangeRate  string `json:"exchange_rate" gorm:"size:32"`
	ConfigVersion string `json:"config_version" gorm:"size:64"`
	CreatedAt     int64  `json:"created_at" gorm:"not null;autoCreateTime:false"`
}

type AffiliateCashSummary struct {
	RebateUnclaimedQuota  int                   `json:"rebate_unclaimed_quota"`
	MaxPlatformClaimQuota int                   `json:"max_platform_claim_quota"`
	MaxUExchangeQuota     int                   `json:"max_u_exchange_quota"`
	UAvailable            string                `json:"u_available"`
	UFrozen               string                `json:"u_frozen"`
	PendingWithdrawals    int64                 `json:"pending_withdrawals"`
	CanExchange           bool                  `json:"can_exchange"`
	CanWithdraw           bool                  `json:"can_withdraw"`
	PlatformReason        string                `json:"platform_reason"`
	ExchangeReason        string                `json:"exchange_reason"`
	WithdrawalReason      string                `json:"withdrawal_reason"`
	Config                AffiliateCashSettings `json:"config"`
}

type AffiliateExchangeRequest struct {
	Quota         int    `json:"quota"`
	Destination   string `json:"destination"`
	RequestID     string `json:"request_id"`
	ConfigVersion string `json:"config_version"`
	Confirmed     bool   `json:"confirmed"`
}

type AffiliateExchangePreview struct {
	Quota             int    `json:"quota"`
	Destination       string `json:"destination"`
	UAmount           string `json:"u_amount"`
	ExchangeRate      string `json:"exchange_rate"`
	ConfigVersion     string `json:"config_version"`
	MinimumWithdrawal string `json:"minimum_withdrawal"`
	CanSubmit         bool   `json:"can_submit"`
	Reason            string `json:"reason"`
}

func lockAffiliateCashUser(tx *gorm.DB, userID int) (*User, error) {
	var user User
	if err := lockForUpdate(tx).First(&user, userID).Error; err != nil {
		return nil, err
	}
	if user.Status != common.UserStatusEnabled {
		return nil, common.NewMessage("User has been banned")
	}
	return &user, nil
}

// 调用方先锁用户；首次建账与业务事务一起提交，后续不能重置余额。
func lockAffiliateCashWallet(tx *gorm.DB, userID int) (*AffiliateCashWallet, error) {
	var wallet AffiliateCashWallet
	err := lockForUpdate(tx).First(&wallet, "user_id = ?", userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		wallet.UserID = userID
		err = tx.Create(&wallet).Error
	}
	return &wallet, err
}

func changeAffiliateCashWallet(tx *gorm.DB, wallet *AffiliateCashWallet, availableDelta, frozenDelta int64, kind, businessID string, withdrawalID int64) error {
	if availableDelta > affiliateCashMaximum-wallet.Available || availableDelta < -wallet.Available || frozenDelta > affiliateCashMaximum-wallet.Frozen || frozenDelta < -wallet.Frozen {
		return common.NewMessage("Insufficient U balance or account limit exceeded")
	}
	available, frozen := wallet.Available+availableDelta, wallet.Frozen+frozenDelta
	if available > affiliateCashMaximum-frozen {
		return common.NewMessage("The U amount exceeds the account limit")
	}
	result := tx.Model(&AffiliateCashWallet{}).Where("user_id = ? AND available = ? AND frozen = ?", wallet.UserID, wallet.Available, wallet.Frozen).
		Updates(map[string]any{"available": available, "frozen": frozen})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return common.NewMessage("The balance changed. Refresh and try again")
	}
	wallet.Available, wallet.Frozen = available, frozen
	return tx.Create(&AffiliateCashEntry{UserID: wallet.UserID, BusinessID: businessID, Kind: kind, AvailableDelta: availableDelta, FrozenDelta: frozenDelta, AvailableAfter: available, FrozenAfter: frozen, WithdrawalID: withdrawalID, CreatedAt: common.GetTimestamp()}).Error
}

func GetAffiliateCashSummary(userID int) (*AffiliateCashSummary, error) {
	rebate, err := GetAffiliateRebateSummary(userID)
	if err != nil {
		return nil, err
	}
	settings, err := GetAffiliateCashSettings()
	if err != nil {
		return nil, err
	}
	wallet := AffiliateCashWallet{}
	if err = DB.First(&wallet, "user_id = ?", userID).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	var user User
	if err = DB.Select("id", "quota", "unpaid_quota_balance").First(&user, userID).Error; err != nil {
		return nil, err
	}
	platformLimit := max(0, min(rebate.MaxClaimQuota, common.MaxWalletQuota-user.Quota, common.MaxWalletQuota-user.UnpaidQuotaBalance))
	if float64(platformLimit) < common.QuotaPerUnit {
		platformLimit = 0
	}
	result := &AffiliateCashSummary{RebateUnclaimedQuota: rebate.Claimable, MaxPlatformClaimQuota: rebate.MaxClaimQuota, MaxUExchangeQuota: rebate.MaxClaimQuota,
		UAvailable: formatAffiliateCashAmount(wallet.Available), UFrozen: formatAffiliateCashAmount(wallet.Frozen), Config: settings, PlatformReason: rebate.ClaimUnavailableReason}
	result.MaxPlatformClaimQuota = platformLimit
	if platformLimit == 0 && rebate.MaxClaimQuota > 0 {
		result.PlatformReason = "The platform balance has reached its limit"
	}
	if err = DB.Model(&AffiliateWithdrawal{}).Where("user_id = ? AND status IN ?", userID, []string{"pending", "approved", "paying"}).Count(&result.PendingWithdrawals).Error; err != nil {
		return nil, err
	}
	result.CanWithdraw = settings.WithdrawalEnabled && affiliateCashNetworkAvailable(settings) && validateAffiliateCashSettings(settings) == nil
	if !result.CanWithdraw {
		result.WithdrawalReason = "U withdrawals are currently unavailable"
	}
	result.CanExchange = result.CanWithdraw && settings.ExchangeEnabled && rebate.MaxClaimQuota > 0
	result.ExchangeReason = rebate.ClaimUnavailableReason
	if !settings.ExchangeEnabled || !result.CanWithdraw {
		result.ExchangeReason = "U exchange is currently unavailable"
		result.CanExchange = false
	}
	if result.CanExchange {
		if wallet.Available < 0 || wallet.Frozen < 0 || wallet.Available > affiliateCashMaximum-wallet.Frozen {
			return nil, common.NewMessage("The U account requires reconciliation")
		}
		rate, conversionErr := decimal.NewFromString(settings.ExchangeRate)
		if conversionErr != nil || !rate.IsPositive() {
			return nil, common.NewMessage("Configure a positive U exchange rate before enabling exchange")
		}
		capacity := affiliateCashMaximum - wallet.Available - wallet.Frozen
		// floor(兑换U)不超过容量，使用精确商余数计算最大的原始quota。
		limit, remainder := decimal.NewFromInt(capacity+1).Mul(decimal.NewFromFloat(common.QuotaPerUnit)).QuoRem(rate.Mul(decimal.NewFromInt(affiliateCashScale)), 0)
		if remainder.IsZero() {
			limit = limit.Sub(decimal.NewFromInt(1))
		}
		maxQuota, conversionErr := common.WalletQuotaFromDecimalStrict(decimal.Min(limit, decimal.NewFromInt(int64(rebate.MaxClaimQuota))))
		if conversionErr != nil || maxQuota < 0 {
			return nil, common.NewMessage("The U account requires reconciliation")
		}
		result.MaxUExchangeQuota = maxQuota
		amount, conversionErr := affiliateCashExchangeAmount(maxQuota, settings)
		if conversionErr != nil || amount <= 0 {
			result.CanExchange = false
			result.ExchangeReason = "The exchange amount is too small"
		}
		if float64(maxQuota) < common.QuotaPerUnit {
			result.CanExchange = false
			result.ExchangeReason = "The U balance has reached its limit"
		}
	}
	if !result.CanExchange {
		result.MaxUExchangeQuota = 0
	}
	return result, nil
}

func affiliateCashExchangeAmount(quota int, settings AffiliateCashSettings) (int64, error) {
	if quota <= 0 || quota > common.MaxWalletQuota || common.QuotaPerUnit <= 0 {
		return 0, common.NewMessage("Invalid parameters")
	}
	rate, err := decimal.NewFromString(settings.ExchangeRate)
	if err != nil || !rate.IsPositive() {
		return 0, common.NewMessage("Configure a positive U exchange rate before enabling exchange")
	}
	amount := decimal.NewFromInt(int64(quota)).Div(decimal.NewFromFloat(common.QuotaPerUnit)).Mul(rate).Mul(decimal.NewFromInt(affiliateCashScale)).Floor()
	units, err := common.WalletQuotaFromDecimalStrict(amount)
	if err != nil {
		return 0, common.NewMessage("The U amount exceeds the account limit")
	}
	if units <= 0 {
		return 0, common.NewMessage("The exchange amount is too small")
	}
	return int64(units), nil
}

func PreviewAffiliateCashExchange(userID int, req AffiliateExchangeRequest) (*AffiliateExchangePreview, error) {
	if req.Destination != "platform" && req.Destination != "u" {
		return nil, common.NewMessage("Invalid referral claim destination")
	}
	summary, err := GetAffiliateCashSummary(userID)
	if err != nil {
		return nil, err
	}
	preview := &AffiliateExchangePreview{Quota: req.Quota, Destination: req.Destination, UAmount: "0", ExchangeRate: summary.Config.ExchangeRate, ConfigVersion: summary.Config.Version, MinimumWithdrawal: summary.Config.MinimumWithdrawal}
	limit := summary.MaxPlatformClaimQuota
	preview.Reason = summary.PlatformReason
	if req.Destination == "u" {
		limit = summary.MaxUExchangeQuota
		preview.Reason = summary.ExchangeReason
	}
	if req.Quota <= 0 || req.Quota > limit || float64(req.Quota) < common.QuotaPerUnit {
		if preview.Reason == "" {
			preview.Reason = "The rebate amount exceeds the amount currently available to claim"
		}
		return preview, nil
	}
	if req.Destination == "u" {
		amount, err := affiliateCashExchangeAmount(req.Quota, summary.Config)
		if err != nil {
			return nil, err
		}
		preview.UAmount = formatAffiliateCashAmount(amount)
	}
	preview.CanSubmit = true
	preview.Reason = ""
	return preview, nil
}

func ExchangeAffiliateCash(userID int, req AffiliateExchangeRequest) (*AffiliateCashExchange, error) {
	if !affiliateCashIdentifierPattern.MatchString(req.RequestID) || (req.Destination != "platform" && req.Destination != "u") || (req.Destination == "u" && !req.Confirmed) {
		return nil, common.NewMessage("Confirm the destination and provide a valid request ID")
	}
	var receipt AffiliateCashExchange
	replayed := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		user, err := lockAffiliateCashUser(tx, userID)
		if err != nil {
			return err
		}
		err = tx.Where("user_id = ? AND request_id = ?", userID, req.RequestID).First(&receipt).Error
		if err == nil {
			if receipt.Quota != req.Quota || receipt.Destination != req.Destination || receipt.ConfigVersion != req.ConfigVersion {
				return common.NewMessage("This request ID was already used for a different operation")
			}
			replayed = true
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		settings, err := readAffiliateCashSettings(lockForUpdate(tx))
		if err != nil {
			return err
		}
		if req.ConfigVersion != settings.Version {
			return common.NewMessage("The configuration changed. Refresh and confirm again")
		}
		amount := int64(0)
		if req.Destination == "u" {
			if !settings.ExchangeEnabled || !settings.WithdrawalEnabled || !affiliateCashNetworkAvailable(settings) {
				return common.NewMessage("U exchange is currently unavailable")
			}
			if err = validateAffiliateCashSettings(settings); err != nil {
				return err
			}
			amount, err = affiliateCashExchangeAmount(req.Quota, settings)
			if err != nil {
				return err
			}
		}
		replayed, err = claimAffiliateRebateTx(tx, user, req.Quota, req.Destination, req.RequestID)
		if err != nil {
			return err
		}
		if replayed {
			return common.NewMessage("This request ID was already used for a different operation")
		}
		if req.Destination == "u" {
			wallet, err := lockAffiliateCashWallet(tx, userID)
			if err != nil {
				return err
			}
			if err = changeAffiliateCashWallet(tx, wallet, amount, 0, "exchange", "exchange:"+req.RequestID, 0); err != nil {
				return err
			}
		}
		receipt = AffiliateCashExchange{UserID: userID, RequestID: req.RequestID, Quota: req.Quota, Destination: req.Destination, UAmount: formatAffiliateCashAmount(amount), ExchangeRate: settings.ExchangeRate, ConfigVersion: settings.Version, CreatedAt: common.GetTimestamp()}
		return tx.Create(&receipt).Error
	})
	if err != nil {
		return nil, err
	}
	if req.Destination == "platform" && !replayed {
		_ = syncAffiliateClaimQuota(userID, req.Quota, nil)
	}
	return &receipt, nil
}

func ensureAffiliateCashDeletionAllowed(tx *gorm.DB, user *User) error {
	var wallet AffiliateCashWallet
	err := lockForUpdate(tx).First(&wallet, "user_id = ?", user.Id).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	var pending int64
	if err = tx.Model(&AffiliateWithdrawal{}).Where("user_id = ? AND status IN ?", user.Id, []string{"pending", "approved", "paying"}).Count(&pending).Error; err != nil {
		return err
	}
	if wallet.Available != 0 || wallet.Frozen != 0 || pending > 0 {
		return common.NewMessage("Account deletion is blocked: available U {{available}}, frozen U {{frozen}}, unfinished withdrawals {{count}}. U cannot be converted back to platform balance; amounts below the withdrawal minimum must accumulate.", map[string]any{"available": formatAffiliateCashAmount(wallet.Available), "frozen": formatAffiliateCashAmount(wallet.Frozen), "count": pending})
	}
	return nil
}

type AffiliateCashLedgerView struct {
	ID           int64  `json:"id"`
	Kind         string `json:"kind"`
	Quota        int    `json:"quota"`
	UAmount      string `json:"u_amount"`
	ExchangeRate string `json:"exchange_rate"`
	CreatedAt    int64  `json:"created_at"`
	RequestID    string `json:"request_id"`
	Reason       string `json:"reason"`
}

func GetAffiliateCashLedger(userID int, page *common.PageInfo) error {
	query := DB.Model(&AffiliateLedgerEntry{}).Where("user_id = ?", userID)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return err
	}
	var entries []AffiliateLedgerEntry
	if err := query.Order("id DESC").Limit(page.PageSize).Offset(page.GetStartIdx()).Find(&entries).Error; err != nil {
		return err
	}
	views := make([]AffiliateCashLedgerView, 0, len(entries))
	requests := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.Kind == "claim_u" {
			if requestID, ok := strings.CutPrefix(entry.BusinessID, "claim:"); ok {
				requests = append(requests, requestID)
			}
		}
	}
	var exchanges []AffiliateCashExchange
	if len(requests) > 0 {
		if err := DB.Where("user_id = ? AND request_id IN ?", userID, requests).Find(&exchanges).Error; err != nil {
			return err
		}
	}
	amounts := make(map[string]string)
	rates := make(map[string]string)
	for _, exchange := range exchanges {
		amounts["claim:"+exchange.RequestID] = exchange.UAmount
		rates["claim:"+exchange.RequestID] = exchange.ExchangeRate
	}
	for _, entry := range entries {
		amount := amounts[entry.BusinessID]
		if amount == "" {
			amount = "0"
		}
		views = append(views, AffiliateCashLedgerView{ID: entry.ID, Kind: entry.Kind, Quota: entry.Quota, UAmount: amount, ExchangeRate: rates[entry.BusinessID], CreatedAt: entry.CreatedAt, RequestID: entry.BusinessID})
	}
	page.SetTotal(int(total))
	page.SetItems(views)
	return nil
}

func affiliateWithdrawalBusinessID(id int64, action string) string {
	return fmt.Sprintf("withdrawal:%d:%s", id, action)
}
