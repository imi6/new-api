/**
此文件为旧版支付设置文件，如需增加新的参数、变量等，请在 payment_setting.go 中添加
This file is the old version of the payment settings file. If you need to add new parameters, variables, etc., please add them in payment_setting.go
*/

package operation_setting

import (
	"errors"
	"regexp"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

var PayAddress = ""
var CustomCallbackAddress = ""
var EpayId = ""
var EpayKey = ""
var Price = 7.3
var MinTopUp = 1
var USDExchangeRate = 7.3

const EpayGatewayPrimary = "epay"

const maxEpayGateways = 20

var epayGatewayIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)

// EpayGateway is an extra Epay merchant. The original site stays in PayAddress.
type EpayGateway struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	Address string  `json:"address"`
	EpayID  string  `json:"epay_id"`
	EpayKey string  `json:"epay_key"`
	Price   float64 `json:"price"`
}

// EpayGateways holds every added Epay site. An empty list keeps the original site only.
var EpayGateways []EpayGateway

var PayMethods = []map[string]string{
	{
		"name": "支付宝",
		"icon": "SiAlipay",
		"type": "alipay",
	},
	{
		"name": "微信",
		"icon": "SiWechat",
		"type": "wxpay",
	},
	{
		"name":      "自定义1",
		"icon":      "LuCreditCard",
		"type":      "custom1",
		"min_topup": "50",
	},
}

func UpdatePayMethodsByJsonString(jsonString string) error {
	PayMethods = make([]map[string]string, 0)
	return common.Unmarshal([]byte(jsonString), &PayMethods)
}

func PayMethods2JsonString() string {
	jsonBytes, err := common.Marshal(PayMethods)
	if err != nil {
		return "[]"
	}
	return string(jsonBytes)
}

func ContainsPayMethod(method string) bool {
	for _, payMethod := range PayMethods {
		if payMethod["type"] == method {
			return true
		}
	}
	return false
}

// PayMethodBonusPercent is the extra quota percent for one payment method.
// 1 means a successful top-up grants 1% more balance. Missing and invalid values grant nothing.
func PayMethodBonusPercent(method string) float64 {
	for _, payMethod := range PayMethods {
		if payMethod["type"] != method {
			continue
		}
		raw := strings.TrimSpace(payMethod["bonus_percent"])
		if raw == "" {
			return 0
		}
		percent, err := strconv.ParseFloat(raw, 64)
		if err != nil || percent <= 0 || percent > 100 {
			return 0
		}
		return percent
	}
	return 0
}

// PayMethodGateway reports which Epay site handles this payment method.
// A missing value stays on the original site.
func PayMethodGateway(method string) string {
	for _, payMethod := range PayMethods {
		if payMethod["type"] != method {
			continue
		}
		gateway := strings.TrimSpace(payMethod["gateway"])
		if gateway == "" || gateway == EpayGatewayPrimary {
			return EpayGatewayPrimary
		}
		return gateway
	}
	return EpayGatewayPrimary
}

// EpayUnitPrice is the currency charged per USD of balance for one Epay site.
func EpayUnitPrice(gateway string) float64 {
	if gateway != "" && gateway != EpayGatewayPrimary {
		for _, site := range EpayGateways {
			if site.ID == gateway && site.Price > 0 {
				return site.Price
			}
		}
	}
	return Price
}

// EpayCredentials returns the address, merchant ID, and key for one Epay site.
func EpayCredentials(gateway string) (address string, id string, key string) {
	if gateway != "" && gateway != EpayGatewayPrimary {
		for _, site := range EpayGateways {
			if site.ID != gateway {
				continue
			}
			return strings.TrimSpace(site.Address), strings.TrimSpace(site.EpayID), strings.TrimSpace(site.EpayKey)
		}
		return "", "", ""
	}
	return strings.TrimSpace(PayAddress), strings.TrimSpace(EpayId), strings.TrimSpace(EpayKey)
}

// EpayConfigured reports whether one Epay site has the three required values.
func EpayConfigured(gateway string) bool {
	address, id, key := EpayCredentials(gateway)
	return address != "" && id != "" && key != ""
}

// AnyEpayConfigured reports whether the original site or any added site is complete.
func AnyEpayConfigured() bool {
	if EpayConfigured(EpayGatewayPrimary) {
		return true
	}
	for _, site := range EpayGateways {
		if EpayConfigured(site.ID) {
			return true
		}
	}
	return false
}

func EpayTopUpNotifyPath(gateway string) string {
	if gateway == "" || gateway == EpayGatewayPrimary {
		return "/api/user/epay/notify"
	}
	return "/api/user/epay/gateway/" + gateway + "/notify"
}

func EpaySubscriptionNotifyPath(gateway string) string {
	if gateway == "" || gateway == EpayGatewayPrimary {
		return "/api/subscription/epay/notify"
	}
	return "/api/subscription/epay/gateway/" + gateway + "/notify"
}

func EpaySubscriptionReturnPath(gateway string) string {
	if gateway == "" || gateway == EpayGatewayPrimary {
		return "/api/subscription/epay/return"
	}
	return "/api/subscription/epay/gateway/" + gateway + "/return"
}

func EpayGateways2JsonString() string {
	if EpayGateways == nil {
		return "[]"
	}
	jsonBytes, err := common.Marshal(EpayGateways)
	if err != nil {
		return "[]"
	}
	return string(jsonBytes)
}

func PrepareEpayGatewaysJSON(value string) (string, error) {
	next, err := parseEpayGateways(value)
	if err != nil {
		return "", err
	}
	previousKeys := make(map[string]string, len(EpayGateways))
	for _, site := range EpayGateways {
		previousKeys[site.ID] = site.EpayKey
	}
	for i := range next {
		if next[i].EpayKey == "" {
			next[i].EpayKey = previousKeys[next[i].ID]
		}
	}
	encoded, err := common.Marshal(next)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func ValidateEpayGatewaysJSON(value string) error {
	_, err := parseEpayGateways(value)
	return err
}

func UpdateEpayGatewaysByJsonString(value string) error {
	next, err := parseEpayGateways(value)
	if err != nil {
		return err
	}
	previousKeys := make(map[string]string, len(EpayGateways))
	for _, site := range EpayGateways {
		previousKeys[site.ID] = site.EpayKey
	}
	for i := range next {
		if next[i].EpayKey == "" {
			next[i].EpayKey = previousKeys[next[i].ID]
		}
	}
	EpayGateways = next
	return nil
}

func parseEpayGateways(value string) ([]EpayGateway, error) {
	if strings.TrimSpace(value) == "" {
		return []EpayGateway{}, nil
	}
	var sites []EpayGateway
	if err := common.Unmarshal([]byte(value), &sites); err != nil {
		return nil, errors.New("Epay sites must be a JSON array")
	}
	if sites == nil {
		sites = []EpayGateway{}
	}
	if len(sites) > maxEpayGateways {
		return nil, errors.New("at most 20 Epay sites can be added")
	}
	seen := make(map[string]struct{}, len(sites))
	for i := range sites {
		sites[i].ID = strings.TrimSpace(sites[i].ID)
		sites[i].Name = strings.TrimSpace(sites[i].Name)
		sites[i].Address = strings.TrimRight(strings.TrimSpace(sites[i].Address), "/")
		sites[i].EpayID = strings.TrimSpace(sites[i].EpayID)
		sites[i].EpayKey = strings.TrimSpace(sites[i].EpayKey)
		id := sites[i].ID
		if id == EpayGatewayPrimary || !epayGatewayIDPattern.MatchString(id) {
			return nil, errors.New("Epay site id must be letters, numbers, _ or -, and cannot be epay")
		}
		if _, ok := seen[id]; ok {
			return nil, errors.New("Epay site ids must be unique")
		}
		seen[id] = struct{}{}
		if sites[i].Address != "" && !strings.HasPrefix(sites[i].Address, "http://") && !strings.HasPrefix(sites[i].Address, "https://") {
			return nil, errors.New("Epay site endpoint must start with http:// or https://")
		}
		if sites[i].Price < 0 {
			return nil, errors.New("Epay site price cannot be negative")
		}
		if len(sites[i].Name) > 100 || len(sites[i].EpayID) > 128 || len(sites[i].EpayKey) > 512 {
			return nil, errors.New("Epay site name, merchant ID, or key is too long")
		}
	}
	return sites, nil
}
