package operation_setting

import (
	"math"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

// InvoiceSetting holds the invoice center options. They are stored as
// invoice_setting.<json key> options.
type InvoiceSetting struct {
	Enabled               bool    `json:"enabled"`
	TaxRate               float64 `json:"tax_rate"`         // general invoice, percent, 6 means 6%
	SpecialTaxRate        float64 `json:"special_tax_rate"` // special invoice, percent
	OrderDays             int     `json:"order_days"`
	Categories            string  `json:"categories"` // one product category per line
	NormalEnabled         bool    `json:"normal_enabled"`
	SpecialEnabled        bool    `json:"special_enabled"`
	PaymentTimeoutMinutes int     `json:"payment_timeout_minutes"`
	FileMaxKB             int     `json:"file_max_kb"`
}

const (
	defaultInvoiceTaxRate               = 6
	defaultInvoiceOrderDays             = 30
	defaultInvoiceCategories            = "*生产生活服务*软件开发服务"
	defaultInvoicePaymentTimeoutMinutes = 30
	defaultInvoiceFileMaxKB             = 100

	invoiceMaxCategories      = 50
	invoiceMaxCategoryLength  = 100
	invoiceMinOrderDays       = 1
	invoiceMaxOrderDays       = 3650
	invoiceMinTimeoutMinutes  = 5
	invoiceMaxTimeoutMinutes  = 1440
	invoiceMinFileMaxKB       = 10
	invoiceMaxFileMaxKB       = 20480
	invoiceSettingOptionScope = "invoice_setting."
)

var invoiceSetting = InvoiceSetting{
	Enabled:               false,
	TaxRate:               defaultInvoiceTaxRate,
	SpecialTaxRate:        defaultInvoiceTaxRate,
	OrderDays:             defaultInvoiceOrderDays,
	Categories:            defaultInvoiceCategories,
	NormalEnabled:         true,
	SpecialEnabled:        true,
	PaymentTimeoutMinutes: defaultInvoicePaymentTimeoutMinutes,
	FileMaxKB:             defaultInvoiceFileMaxKB,
}

func init() {
	config.GlobalConfig.Register("invoice_setting", &invoiceSetting)
}

func GetInvoiceSetting() *InvoiceSetting {
	return &invoiceSetting
}

// InvoiceTaxRate is the tax percent applied to new general invoice
// applications. A stored value outside 0–100 falls back to the default.
func InvoiceTaxRate() float64 {
	return invoiceTaxRateInRange(invoiceSetting.TaxRate)
}

// InvoiceSpecialTaxRate is the tax percent applied to new special invoice
// applications. A stored value outside 0–100 falls back to the default.
func InvoiceSpecialTaxRate() float64 {
	return invoiceTaxRateInRange(invoiceSetting.SpecialTaxRate)
}

func invoiceTaxRateInRange(rate float64) float64 {
	if math.IsNaN(rate) || rate < 0 || rate > 100 {
		return defaultInvoiceTaxRate
	}
	return rate
}

func InvoiceOrderDays() int {
	return invoiceIntInRange(invoiceSetting.OrderDays, invoiceMinOrderDays, invoiceMaxOrderDays, defaultInvoiceOrderDays)
}

func InvoicePaymentTimeoutMinutes() int {
	return invoiceIntInRange(invoiceSetting.PaymentTimeoutMinutes, invoiceMinTimeoutMinutes, invoiceMaxTimeoutMinutes, defaultInvoicePaymentTimeoutMinutes)
}

func InvoiceFileMaxKB() int {
	return invoiceIntInRange(invoiceSetting.FileMaxKB, invoiceMinFileMaxKB, invoiceMaxFileMaxKB, defaultInvoiceFileMaxKB)
}

func invoiceIntInRange(value, low, high, fallback int) int {
	if value < low || value > high {
		return fallback
	}
	return value
}

// InvoiceCategories returns the configured product categories in order,
// trimmed and without blanks or duplicates.
func InvoiceCategories() []string {
	categories := make([]string, 0)
	seen := make(map[string]struct{})
	for line := range strings.SplitSeq(invoiceSetting.Categories, "\n") {
		category := strings.TrimSpace(line)
		if category == "" {
			continue
		}
		if _, duplicate := seen[category]; duplicate {
			continue
		}
		seen[category] = struct{}{}
		categories = append(categories, category)
	}
	return categories
}

// ValidateInvoiceSettingOption checks one invoice_setting.* option before it
// is saved. Keys outside the invoice settings are accepted unchanged.
func ValidateInvoiceSettingOption(key, value string) error {
	field, ok := strings.CutPrefix(key, invoiceSettingOptionScope)
	if !ok {
		return nil
	}
	value = strings.TrimSpace(value)
	switch field {
	case "enabled", "normal_enabled", "special_enabled":
		if _, err := strconv.ParseBool(value); err != nil {
			return common.NewMessage("Invalid parameters")
		}
	case "tax_rate", "special_tax_rate":
		rate, err := strconv.ParseFloat(value, 64)
		if err != nil || math.IsNaN(rate) || rate < 0 || rate > 100 {
			return invoiceRangeError(0, 100)
		}
	case "order_days":
		return validateInvoiceIntOption(value, invoiceMinOrderDays, invoiceMaxOrderDays)
	case "payment_timeout_minutes":
		return validateInvoiceIntOption(value, invoiceMinTimeoutMinutes, invoiceMaxTimeoutMinutes)
	case "file_max_kb":
		return validateInvoiceIntOption(value, invoiceMinFileMaxKB, invoiceMaxFileMaxKB)
	case "categories":
		count := 0
		for line := range strings.SplitSeq(value, "\n") {
			category := strings.TrimSpace(line)
			if category == "" {
				continue
			}
			if utf8.RuneCountInString(category) > invoiceMaxCategoryLength {
				return common.NewMessage("Each product category can have at most {{max}} characters", map[string]any{"max": invoiceMaxCategoryLength})
			}
			count++
		}
		if count == 0 {
			return common.NewMessage("Enter at least one product category")
		}
		if count > invoiceMaxCategories {
			return common.NewMessage("Enter at most {{max}} product categories", map[string]any{"max": invoiceMaxCategories})
		}
	default:
		return common.NewMessage("Invalid parameters")
	}
	return nil
}

func validateInvoiceIntOption(value string, low, high int) error {
	number, err := strconv.Atoi(value)
	if err != nil || number < low || number > high {
		return invoiceRangeError(low, high)
	}
	return nil
}

// EpayInvoiceNotifyPath is the callback path for invoice tax payments. It is
// separate from the top-up callback so tax is never credited as a top-up.
func EpayInvoiceNotifyPath(gateway string) string {
	if gateway == "" || gateway == EpayGatewayPrimary {
		return "/api/invoice/epay/notify"
	}
	return "/api/invoice/epay/gateway/" + gateway + "/notify"
}

func invoiceRangeError(low, high int) error {
	return common.NewMessage("The value must be between {{min}} and {{max}}", map[string]any{"min": low, "max": high})
}
