package operation_setting

import (
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

// PartnerSetting holds the limits of the supplier application page, stored
// as partner_setting.<json key> options. Whether the page is shown and
// whether it needs a sign-in are the "partner" top navigation switch.
type PartnerSetting struct {
	// MaxSitesPerUser caps how many sites one signed-in user can submit.
	MaxSitesPerUser int `json:"max_sites_per_user"`
	// MaxOffersPerSite caps the groups in one submission.
	MaxOffersPerSite int `json:"max_offers_per_site"`
	// GuestHourlyLimit caps the submissions of one IP in an hour from
	// visitors who are not signed in.
	GuestHourlyLimit int `json:"guest_hourly_limit"`
	// Intro replaces the default text at the top of the page; empty keeps it.
	Intro string `json:"intro"`
}

const (
	partnerOptionScope = "partner_setting."

	PartnerMinLimit       = 1
	PartnerMaxSitesLimit  = 100
	PartnerMaxOffersLimit = 50
	PartnerMaxGuestLimit  = 100
	PartnerMaxIntroLength = 2000
)

var partnerSetting = PartnerSetting{
	MaxSitesPerUser:  10,
	MaxOffersPerSite: 20,
	GuestHourlyLimit: 3,
}

func init() {
	config.GlobalConfig.Register("partner_setting", &partnerSetting)
}

func GetPartnerSetting() *PartnerSetting {
	return &partnerSetting
}

// PartnerMaxSites, PartnerMaxOffers and PartnerGuestHourlyLimit clamp the
// stored limits to their allowed ranges.
func PartnerMaxSites() int {
	return min(max(partnerSetting.MaxSitesPerUser, PartnerMinLimit), PartnerMaxSitesLimit)
}

func PartnerMaxOffers() int {
	return min(max(partnerSetting.MaxOffersPerSite, PartnerMinLimit), PartnerMaxOffersLimit)
}

func PartnerGuestHourlyLimit() int {
	return min(max(partnerSetting.GuestHourlyLimit, PartnerMinLimit), PartnerMaxGuestLimit)
}

// ValidatePartnerSettingOption checks one partner_setting.* option before it
// is saved. Keys outside these settings are accepted.
func ValidatePartnerSettingOption(key, value string) error {
	field, ok := strings.CutPrefix(key, partnerOptionScope)
	if !ok {
		return nil
	}
	switch field {
	case "max_sites_per_user":
		return validatePartnerIntOption(value, PartnerMinLimit, PartnerMaxSitesLimit)
	case "max_offers_per_site":
		return validatePartnerIntOption(value, PartnerMinLimit, PartnerMaxOffersLimit)
	case "guest_hourly_limit":
		return validatePartnerIntOption(value, PartnerMinLimit, PartnerMaxGuestLimit)
	case "intro":
		if utf8.RuneCountInString(value) > PartnerMaxIntroLength {
			return common.NewMessage("The text can have at most {{max}} characters", map[string]any{"max": PartnerMaxIntroLength})
		}
	default:
		return common.NewMessage("Invalid parameters")
	}
	return nil
}

func validatePartnerIntOption(value string, low, high int) error {
	number, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || number < low || number > high {
		return invoiceRangeError(low, high)
	}
	return nil
}
