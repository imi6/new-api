package model

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

const affiliateCashSettingKey = "AffiliateCashSettings"
const affiliateCashScale int64 = 1000000
const affiliateCashMaximum int64 = common.MaxWalletQuota

var affiliateCashDecimalPattern = regexp.MustCompile(`^(0|[1-9][0-9]{0,9})(\.[0-9]{1,6})?$`)
var affiliateCashIdentifierPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

type AffiliateCashNetwork struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	AddressKind string `json:"address_kind"`
	Enabled     bool   `json:"enabled"`
}

// AffiliateCashSettings 整份原子保存；未选择的业务规则不静默使用示例值。
type AffiliateCashSettings struct {
	ExchangeEnabled   bool                   `json:"exchange_enabled"`
	WithdrawalEnabled bool                   `json:"withdrawal_enabled"`
	ExchangeRate      string                 `json:"exchange_rate"`
	MinimumWithdrawal string                 `json:"minimum_withdrawal"`
	FeeMode           string                 `json:"fee_mode"`
	FeeFixed          string                 `json:"fee_fixed"`
	FeePercent        string                 `json:"fee_percent"`
	MinimumBasis      string                 `json:"minimum_basis"`
	CancelFeePolicy   string                 `json:"cancel_fee_policy"`
	FailedFeePolicy   string                 `json:"failed_fee_policy"`
	Networks          []AffiliateCashNetwork `json:"networks"`
	Currency          string                 `json:"currency"`
	Precision         int                    `json:"precision"`
	Version           string                 `json:"version"`
}

func defaultAffiliateCashSettings() AffiliateCashSettings {
	return AffiliateCashSettings{Currency: "USDT", Precision: 6, Networks: []AffiliateCashNetwork{}}
}

func parseAffiliateCashAmount(value string) (int64, error) {
	if !affiliateCashDecimalPattern.MatchString(value) {
		return 0, common.NewMessage("Enter a valid U amount with at most six decimal places")
	}
	amount, err := decimal.NewFromString(value)
	if err != nil {
		return 0, common.NewMessage("Invalid U amount")
	}
	units, err := common.WalletQuotaFromDecimalStrict(amount.Mul(decimal.NewFromInt(affiliateCashScale)))
	if err != nil {
		return 0, common.NewMessage("The U amount exceeds the account limit")
	}
	return int64(units), nil
}

func formatAffiliateCashAmount(units int64) string {
	return decimal.NewFromInt(units).Div(decimal.NewFromInt(affiliateCashScale)).String()
}

func readAffiliateCashSettings(db *gorm.DB) (AffiliateCashSettings, error) {
	settings := defaultAffiliateCashSettings()
	var option Option
	err := db.Where(&Option{Key: affiliateCashSettingKey}).First(&option).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return settings, err
	}
	if err == nil {
		if err = common.UnmarshalJsonStr(option.Value, &settings); err != nil {
			return settings, common.NewMessage("The U withdrawal configuration is invalid")
		}
	}
	settings.Version = ""
	encoded, err := common.Marshal(settings)
	if err != nil {
		return settings, err
	}
	digest := sha256.Sum256(encoded)
	settings.Version = hex.EncodeToString(digest[:])
	return settings, nil
}

func GetAffiliateCashSettings() (AffiliateCashSettings, error) {
	return readAffiliateCashSettings(DB)
}

func validateAffiliateCashSettings(settings AffiliateCashSettings) error {
	if settings.Currency != "USDT" || settings.Precision != 6 || len(settings.Networks) > 20 {
		return common.NewMessage("The U withdrawal configuration is invalid")
	}
	for _, item := range []struct {
		value   string
		allowed []string
	}{
		{settings.FeeMode, []string{"", "fixed", "percent", "both"}},
		{settings.MinimumBasis, []string{"", "requested", "net"}},
		{settings.CancelFeePolicy, []string{"", "refund", "retain"}},
		{settings.FailedFeePolicy, []string{"", "refund", "retain"}},
	} {
		if !slices.Contains(item.allowed, item.value) {
			return common.NewMessage("The U withdrawal configuration is invalid")
		}
	}
	for _, value := range []string{settings.ExchangeRate, settings.MinimumWithdrawal, settings.FeeFixed, settings.FeePercent} {
		if value != "" {
			if _, err := parseAffiliateCashAmount(value); err != nil {
				return err
			}
		}
	}
	if settings.FeePercent != "" {
		percent, _ := decimal.NewFromString(settings.FeePercent)
		if percent.GreaterThan(decimal.NewFromInt(100)) {
			return common.NewMessage("The withdrawal fee percentage must not exceed 100")
		}
	}
	seen := make(map[string]bool)
	for _, network := range settings.Networks {
		if !affiliateCashIdentifierPattern.MatchString(network.ID) || len(network.ID) > 32 || seen[network.ID] || strings.TrimSpace(network.Name) == "" || utf8.RuneCountInString(network.Name) > 80 || !slices.Contains([]string{"evm", "tron"}, network.AddressKind) {
			return common.NewMessage("Configure a unique withdrawal network and a supported address format")
		}
		seen[network.ID] = true
	}
	if settings.ExchangeEnabled {
		rate, err := parseAffiliateCashAmount(settings.ExchangeRate)
		if err != nil || rate <= 0 {
			return common.NewMessage("Configure a positive U exchange rate before enabling exchange")
		}
	}
	if settings.WithdrawalEnabled || settings.ExchangeEnabled {
		minimum, err := parseAffiliateCashAmount(settings.MinimumWithdrawal)
		if err != nil || minimum <= 0 || settings.FeeMode == "" || settings.MinimumBasis == "" || settings.CancelFeePolicy == "" || settings.FailedFeePolicy == "" {
			return common.NewMessage("Select the withdrawal minimum, fee and refund rules before enabling this feature")
		}
		if (settings.FeeMode == "fixed" || settings.FeeMode == "both") && settings.FeeFixed == "" {
			return common.NewMessage("Configure the fixed withdrawal fee")
		}
		if (settings.FeeMode == "percent" || settings.FeeMode == "both") && settings.FeePercent == "" {
			return common.NewMessage("Configure the withdrawal fee percentage")
		}
		// 提现暂停或没有可用网络时允许保存停用配置，避免旧配置无法关闭。
		if settings.WithdrawalEnabled && affiliateCashNetworkAvailable(settings) {
			fee, err := calculateAffiliateWithdrawalFee(settings, affiliateCashMaximum)
			if err != nil || (settings.MinimumBasis == "net" && affiliateCashMaximum-fee < minimum) {
				return common.NewMessage("The withdrawal fee and minimum must allow a positive payout within the account limit")
			}
		}
	}
	return nil
}

// 手续费以最小 U 单位精确计算并向下取整，预览、申请和配置可行性使用同一公式。
func calculateAffiliateWithdrawalFee(settings AffiliateCashSettings, amount int64) (int64, error) {
	fee := decimal.Zero
	if settings.FeeMode == "fixed" || settings.FeeMode == "both" {
		fixed, err := parseAffiliateCashAmount(settings.FeeFixed)
		if err != nil {
			return 0, err
		}
		fee = decimal.NewFromInt(fixed)
	}
	if settings.FeeMode == "percent" || settings.FeeMode == "both" {
		percent, err := decimal.NewFromString(settings.FeePercent)
		if err != nil {
			return 0, err
		}
		fee = fee.Add(decimal.NewFromInt(amount).Mul(percent).Shift(-2))
	}
	units, err := common.WalletQuotaFromDecimalStrict(fee.Floor())
	if err != nil || units < 0 || int64(units) >= amount {
		return 0, common.NewMessage("The withdrawal amount must exceed the fee")
	}
	return int64(units), nil
}

func SaveAffiliateCashSettings(settings AffiliateCashSettings) (AffiliateCashSettings, error) {
	if err := validateAffiliateCashSettings(settings); err != nil {
		return settings, err
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		current, err := readAffiliateCashSettings(lockForUpdate(tx))
		if err != nil {
			return err
		}
		if settings.Version != current.Version {
			return common.NewMessage("The configuration changed. Refresh and confirm again")
		}
		// 已经用于提现的网络标识不能重新指向另一条链；允许停用或移除。
		for _, network := range settings.Networks {
			var historical AffiliateWithdrawal
			err := tx.Where("network = ?", network.ID).Order("id ASC").First(&historical).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			if err != nil {
				return err
			}
			var snapshot AffiliateCashSettings
			if err = common.UnmarshalJsonStr(historical.ConfigSnapshot, &snapshot); err != nil {
				return err
			}
			index := slices.IndexFunc(snapshot.Networks, func(n AffiliateCashNetwork) bool { return n.ID == network.ID })
			if index < 0 || snapshot.Networks[index].Name != network.Name || snapshot.Networks[index].AddressKind != network.AddressKind {
				return common.NewMessage("A network used by withdrawals cannot be renamed or reassigned. Create a new network ID instead")
			}
		}
		settings.Version = ""
		encoded, err := common.Marshal(settings)
		if err != nil {
			return err
		}
		var option Option
		err = tx.Where(&Option{Key: affiliateCashSettingKey}).First(&option).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return tx.Create(&Option{Key: affiliateCashSettingKey, Value: string(encoded)}).Error
		}
		if err != nil {
			return err
		}
		return tx.Model(&Option{}).Where(&Option{Key: affiliateCashSettingKey}).Update("value", string(encoded)).Error
	})
	if err != nil {
		return settings, err
	}
	return GetAffiliateCashSettings()
}

func affiliateCashNetworkAvailable(settings AffiliateCashSettings) bool {
	return slices.ContainsFunc(settings.Networks, func(network AffiliateCashNetwork) bool { return network.Enabled })
}
