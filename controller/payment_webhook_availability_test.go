package controller

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/Calcium-Ion/go-epay/epay"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func confirmPaymentComplianceForTest(t *testing.T) {
	t.Helper()
	paymentSetting := operation_setting.GetPaymentSetting()
	originalConfirmed := paymentSetting.ComplianceConfirmed
	originalTermsVersion := paymentSetting.ComplianceTermsVersion
	t.Cleanup(func() {
		paymentSetting.ComplianceConfirmed = originalConfirmed
		paymentSetting.ComplianceTermsVersion = originalTermsVersion
	})
	paymentSetting.ComplianceConfirmed = true
	paymentSetting.ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
}

func TestStripeWebhookEnabledRequiresTopUpAndWebhookConfig(t *testing.T) {
	confirmPaymentComplianceForTest(t)
	originalAPISecret := setting.StripeApiSecret
	originalWebhookSecret := setting.StripeWebhookSecret
	originalPriceID := setting.StripePriceId
	t.Cleanup(func() {
		setting.StripeApiSecret = originalAPISecret
		setting.StripeWebhookSecret = originalWebhookSecret
		setting.StripePriceId = originalPriceID
	})

	setting.StripeWebhookSecret = ""
	setting.StripeApiSecret = "sk_test_123"
	setting.StripePriceId = "price_123"
	require.False(t, isStripeWebhookEnabled())

	setting.StripeWebhookSecret = "whsec_test"
	require.True(t, isStripeWebhookEnabled())

	setting.StripePriceId = ""
	require.False(t, isStripeWebhookEnabled())
}

func TestCreemWebhookEnabledRequiresTopUpAndWebhookConfig(t *testing.T) {
	confirmPaymentComplianceForTest(t)
	originalAPIKey := setting.CreemApiKey
	originalProducts := setting.CreemProducts
	originalWebhookSecret := setting.CreemWebhookSecret
	t.Cleanup(func() {
		setting.CreemApiKey = originalAPIKey
		setting.CreemProducts = originalProducts
		setting.CreemWebhookSecret = originalWebhookSecret
	})

	setting.CreemWebhookSecret = ""
	setting.CreemApiKey = "creem_api_key"
	setting.CreemProducts = `[{"productId":"prod_123"}]`
	require.False(t, isCreemWebhookEnabled())

	setting.CreemWebhookSecret = "creem_secret"
	require.True(t, isCreemWebhookEnabled())

	setting.CreemProducts = "[]"
	require.False(t, isCreemWebhookEnabled())
}

func TestWaffoWebhookEnabledRequiresTopUpAndWebhookConfig(t *testing.T) {
	confirmPaymentComplianceForTest(t)
	originalEnabled := setting.WaffoEnabled
	originalSandbox := setting.WaffoSandbox
	originalAPIKey := setting.WaffoApiKey
	originalPrivateKey := setting.WaffoPrivateKey
	originalPublicCert := setting.WaffoPublicCert
	originalSandboxAPIKey := setting.WaffoSandboxApiKey
	originalSandboxPrivateKey := setting.WaffoSandboxPrivateKey
	originalSandboxPublicCert := setting.WaffoSandboxPublicCert
	t.Cleanup(func() {
		setting.WaffoEnabled = originalEnabled
		setting.WaffoSandbox = originalSandbox
		setting.WaffoApiKey = originalAPIKey
		setting.WaffoPrivateKey = originalPrivateKey
		setting.WaffoPublicCert = originalPublicCert
		setting.WaffoSandboxApiKey = originalSandboxAPIKey
		setting.WaffoSandboxPrivateKey = originalSandboxPrivateKey
		setting.WaffoSandboxPublicCert = originalSandboxPublicCert
	})

	setting.WaffoEnabled = true
	setting.WaffoSandbox = false
	setting.WaffoApiKey = ""
	setting.WaffoPrivateKey = "private"
	setting.WaffoPublicCert = "public"
	require.False(t, isWaffoWebhookEnabled())

	setting.WaffoApiKey = "api"
	require.True(t, isWaffoWebhookEnabled())

	setting.WaffoEnabled = false
	require.False(t, isWaffoWebhookEnabled())

	setting.WaffoEnabled = true
	setting.WaffoSandbox = true
	setting.WaffoSandboxApiKey = ""
	setting.WaffoSandboxPrivateKey = "sandbox_private"
	setting.WaffoSandboxPublicCert = "sandbox_public"
	require.False(t, isWaffoWebhookEnabled())

	setting.WaffoSandboxApiKey = "sandbox_api"
	require.True(t, isWaffoWebhookEnabled())
}

func TestWaffoPancakeWebhookEnabledRequiresTopUpAndWebhookConfig(t *testing.T) {
	confirmPaymentComplianceForTest(t)
	originalMerchantID := setting.WaffoPancakeMerchantID
	originalPrivateKey := setting.WaffoPancakePrivateKey
	originalProductID := setting.WaffoPancakeProductID
	t.Cleanup(func() {
		setting.WaffoPancakeMerchantID = originalMerchantID
		setting.WaffoPancakePrivateKey = originalPrivateKey
		setting.WaffoPancakeProductID = originalProductID
	})

	// Presence of all three credentials enables the gateway. Webhook public
	// keys are bundled in the SDK and there is no separate Enabled toggle —
	// clear any of the three fields to disable.
	setting.WaffoPancakeMerchantID = ""
	setting.WaffoPancakePrivateKey = "private"
	setting.WaffoPancakeProductID = "product"
	require.False(t, isWaffoPancakeWebhookEnabled())

	setting.WaffoPancakeMerchantID = "merchant"
	require.True(t, isWaffoPancakeWebhookEnabled())

	setting.WaffoPancakeProductID = ""
	require.False(t, isWaffoPancakeWebhookEnabled())

	setting.WaffoPancakeProductID = "product"
	setting.WaffoPancakePrivateKey = ""
	require.False(t, isWaffoPancakeWebhookEnabled())
}

func TestEpayWebhookEnabledRequiresTopUpAndWebhookConfig(t *testing.T) {
	confirmPaymentComplianceForTest(t)
	originalPayAddress := operation_setting.PayAddress
	originalEpayID := operation_setting.EpayId
	originalEpayKey := operation_setting.EpayKey
	originalPayMethods := operation_setting.PayMethods
	originalGateways := operation_setting.EpayGateways
	t.Cleanup(func() {
		operation_setting.PayAddress = originalPayAddress
		operation_setting.EpayId = originalEpayID
		operation_setting.EpayKey = originalEpayKey
		operation_setting.PayMethods = originalPayMethods
		operation_setting.EpayGateways = originalGateways
	})

	operation_setting.PayAddress = "https://pay.example.com"
	operation_setting.EpayId = "epay_id"
	operation_setting.EpayKey = ""
	operation_setting.EpayGateways = nil
	operation_setting.PayMethods = []map[string]string{{"type": "alipay"}}
	require.False(t, isEpayWebhookEnabled())

	operation_setting.EpayKey = "epay_key"
	require.True(t, isEpayWebhookEnabled())

	operation_setting.PayMethods = nil
	require.False(t, isEpayWebhookEnabled())

	operation_setting.PayAddress = ""
	operation_setting.EpayId = ""
	operation_setting.EpayKey = ""
	operation_setting.EpayGateways = []operation_setting.EpayGateway{{
		ID: "siteusdt", Name: "USDT", Address: "https://usdt.example.com", EpayID: "usdt_id", EpayKey: "usdt_key", Price: 1,
	}}
	operation_setting.PayMethods = []map[string]string{{"type": "usdt", "gateway": "siteusdt"}}
	require.True(t, isEpayWebhookEnabled())
}

func TestEpayCallbacksVerifyBeforeSettlement(t *testing.T) {
	confirmPaymentComplianceForTest(t)
	originalPayAddress := operation_setting.PayAddress
	originalEpayID := operation_setting.EpayId
	originalEpayKey := operation_setting.EpayKey
	originalPayMethods := operation_setting.PayMethods
	originalServerAddress := system_setting.ServerAddress
	originalDB := model.DB
	t.Cleanup(func() {
		operation_setting.PayAddress = originalPayAddress
		operation_setting.EpayId = originalEpayID
		operation_setting.EpayKey = originalEpayKey
		operation_setting.PayMethods = originalPayMethods
		system_setting.ServerAddress = originalServerAddress
		model.DB = originalDB
	})
	operation_setting.PayAddress = "https://pay.example.com"
	operation_setting.EpayId = "epay_id"
	operation_setting.EpayKey = "test-key"
	operation_setting.PayMethods = []map[string]string{{"type": "alipay"}}
	system_setting.ServerAddress = "https://dashboard.example.com"
	// Rejected callbacks and valid non-success events must never reach settlement.
	// A nil database makes an accidental attempt to settle fail the test.
	model.DB = nil
	require.True(t, isEpayWebhookEnabled())

	// Both ambiguous maps below had this same valid signing string in v0.0.4.
	// This must fail because of parameter ambiguity, not a mismatched signature.
	ambiguousSign := epay.MD5String("money=1.00&name=item&out_trade_no=other&out_trade_no=order&pid=epay_id&trade_status=TRADE_SUCCESS&type=alipay", "test-key")
	pendingSign := epay.MD5String("money=1.00&name=item%26other&out_trade_no=order&pid=epay_id&trade_status=WAIT_BUYER_PAY&type=alipay", "test-key")
	cases := []struct {
		name         string
		productName  string
		tradeNo      string
		status       string
		sign         string
		validPending bool
	}{
		{"separator in product name", "item&out_trade_no=other", "order", epay.StatusTradeSuccess, ambiguousSign, false},
		{"separator in order number", "item", "other&out_trade_no=order", epay.StatusTradeSuccess, ambiguousSign, false},
		{"invalid signature", "item", "order", epay.StatusTradeSuccess, "invalid", false},
		{"missing signature", "item", "order", epay.StatusTradeSuccess, "", false},
		{"valid pending with literal percent escape", "item%26other", "order", "WAIT_BUYER_PAY", pendingSign, true},
	}
	endpoints := []struct {
		name             string
		path             string
		handler          gin.HandlerFunc
		status           int
		rejectedBody     string
		pendingBody      string
		rejectedLocation string
		pendingLocation  string
	}{
		{
			name: "topup notify", path: "/api/user/epay/notify", handler: EpayNotify,
			status: http.StatusOK, rejectedBody: "fail", pendingBody: "success",
		},
		{
			name: "subscription notify", path: "/api/subscription/epay/notify", handler: SubscriptionEpayNotify,
			status: http.StatusOK, rejectedBody: "fail", pendingBody: "fail",
		},
		{
			name: "subscription return", path: "/api/subscription/epay/return", handler: SubscriptionEpayReturn,
			status:           http.StatusFound,
			rejectedLocation: "https://dashboard.example.com/wallet?pay=fail",
			pendingLocation:  "https://dashboard.example.com/wallet?pay=pending",
		},
	}
	router := gin.New()
	for _, endpoint := range endpoints {
		router.Any(endpoint.path, endpoint.handler)
	}
	for _, endpoint := range endpoints {
		for _, method := range []string{http.MethodGet, http.MethodPost} {
			for _, tc := range cases {
				t.Run(endpoint.name+"/"+method+"/"+tc.name, func(t *testing.T) {
					params := url.Values{
						"pid": {"epay_id"}, "type": {"alipay"}, "money": {"1.00"},
						"name": {tc.productName}, "out_trade_no": {tc.tradeNo},
						"trade_status": {tc.status}, "sign_type": {"MD5"},
					}
					if tc.sign != "" {
						params.Set("sign", tc.sign)
					}
					request := httptest.NewRequest(method, endpoint.path+"?"+params.Encode(), nil)
					if method == http.MethodPost {
						request = httptest.NewRequest(method, endpoint.path, strings.NewReader(params.Encode()))
						request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
					}
					recorder := httptest.NewRecorder()
					require.NotPanics(t, func() { router.ServeHTTP(recorder, request) })
					assert.Equal(t, endpoint.status, recorder.Code)
					wantBody, wantLocation := endpoint.rejectedBody, endpoint.rejectedLocation
					if tc.validPending {
						wantBody, wantLocation = endpoint.pendingBody, endpoint.pendingLocation
					}
					if wantBody != "" {
						assert.Equal(t, wantBody, recorder.Body.String())
					}
					assert.Equal(t, wantLocation, recorder.Header().Get("Location"))
				})
			}
		}
	}
}

func TestPayMethodChoosesEpaySiteAndPrice(t *testing.T) {
	originalMethods := operation_setting.PayMethods
	originalPrice := operation_setting.Price
	originalGateways := operation_setting.EpayGateways
	t.Cleanup(func() {
		operation_setting.PayMethods = originalMethods
		operation_setting.Price = originalPrice
		operation_setting.EpayGateways = originalGateways
	})

	operation_setting.PayMethods = []map[string]string{
		{"type": "alipay"},
		{"type": "wxpay", "gateway": "epay"},
		{"type": "usdt", "gateway": "siteusdt"},
		{"type": "trx", "gateway": "sitetrx"},
		{"type": "custom1", "gateway": "other"},
	}
	operation_setting.Price = 7.3
	operation_setting.EpayGateways = []operation_setting.EpayGateway{
		{ID: "siteusdt", Name: "USDT", Price: 1},
		{ID: "sitetrx", Name: "TRX", Price: 2},
	}

	assert.Equal(t, operation_setting.EpayGatewayPrimary, operation_setting.PayMethodGateway("alipay"))
	assert.Equal(t, operation_setting.EpayGatewayPrimary, operation_setting.PayMethodGateway("wxpay"))
	assert.Equal(t, operation_setting.EpayGatewayPrimary, operation_setting.PayMethodGateway("missing"))
	assert.Equal(t, "siteusdt", operation_setting.PayMethodGateway("usdt"))
	assert.Equal(t, "sitetrx", operation_setting.PayMethodGateway("trx"))
	assert.Equal(t, "other", operation_setting.PayMethodGateway("custom1"))
	assert.Equal(t, 7.3, operation_setting.EpayUnitPrice(operation_setting.EpayGatewayPrimary))
	assert.Equal(t, 1.0, operation_setting.EpayUnitPrice("siteusdt"))
	assert.Equal(t, 2.0, operation_setting.EpayUnitPrice("sitetrx"))

	operation_setting.EpayGateways[0].Price = 0
	assert.Equal(t, 7.3, operation_setting.EpayUnitPrice("siteusdt"))
}

func TestRepeatedEpayTypeUsesTheSelectedSite(t *testing.T) {
	originalMethods := operation_setting.PayMethods
	t.Cleanup(func() {
		operation_setting.PayMethods = originalMethods
	})

	operation_setting.PayMethods = []map[string]string{
		{"name": "支付宝【3%】", "type": "alipay"},
		{"name": "USDT", "type": "usdt.binance", "gateway": "usdt"},
		{"name": "支付宝【4%】", "type": "alipay", "gateway": "epay2"},
	}

	first, ok := operation_setting.FindPayMethod("alipay", "epay")
	require.True(t, ok)
	assert.Equal(t, operation_setting.EpayGatewayPrimary, operation_setting.NormalizeEpayGateway(first["gateway"]))

	second, ok := operation_setting.FindPayMethod("alipay", "epay2")
	require.True(t, ok)
	assert.Equal(t, "epay2", second["gateway"])
	assert.Equal(t, "alipay", second["type"])

	_, ok = operation_setting.FindPayMethod("alipay", "missing")
	assert.False(t, ok)
	assert.Equal(t, operation_setting.EpayGatewayPrimary, operation_setting.PayMethodGateway("alipay"))
}

func TestEpayAddedSiteNotifyUsesItsOwnKey(t *testing.T) {
	confirmPaymentComplianceForTest(t)
	originalPayAddress := operation_setting.PayAddress
	originalEpayID := operation_setting.EpayId
	originalEpayKey := operation_setting.EpayKey
	originalGateways := operation_setting.EpayGateways
	originalPayMethods := operation_setting.PayMethods
	originalDB := model.DB
	t.Cleanup(func() {
		operation_setting.PayAddress = originalPayAddress
		operation_setting.EpayId = originalEpayID
		operation_setting.EpayKey = originalEpayKey
		operation_setting.EpayGateways = originalGateways
		operation_setting.PayMethods = originalPayMethods
		model.DB = originalDB
	})

	operation_setting.PayAddress = "https://pay.example.com"
	operation_setting.EpayId = "epay_id"
	operation_setting.EpayKey = "primary-key"
	operation_setting.EpayGateways = []operation_setting.EpayGateway{
		{ID: "siteusdt", Name: "USDT", Address: "https://usdt.example.com", EpayID: "usdt_id", EpayKey: "usdt-key", Price: 1},
		{ID: "sitetrx", Name: "TRX", Address: "https://trx.example.com", EpayID: "trx_id", EpayKey: "trx-key", Price: 1},
	}
	operation_setting.PayMethods = []map[string]string{{"type": "usdt", "gateway": "siteusdt"}}
	model.DB = nil

	signWith := func(pid string, key string) url.Values {
		params := url.Values{
			"pid": {pid}, "type": {"usdt"}, "money": {"1.00"},
			"name": {"item"}, "out_trade_no": {"order"},
			"trade_status": {"WAIT_BUYER_PAY"}, "sign_type": {"MD5"},
		}
		params.Set("sign", epay.MD5String("money=1.00&name=item&out_trade_no=order&pid="+pid+"&trade_status=WAIT_BUYER_PAY&type=usdt", key))
		return params
	}
	router := gin.New()
	router.POST("/api/user/epay/gateway/:id/notify", EpayNotifyByGateway)
	for _, tc := range []struct {
		name string
		pid  string
		key  string
		body string
	}{
		{"primary key", "usdt_id", "primary-key", "fail"},
		{"other site key", "usdt_id", "trx-key", "fail"},
		{"matching key", "usdt_id", "usdt-key", "success"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			params := signWith(tc.pid, tc.key)
			request := httptest.NewRequest(http.MethodPost, "/api/user/epay/gateway/siteusdt/notify", strings.NewReader(params.Encode()))
			request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			recorder := httptest.NewRecorder()
			require.NotPanics(t, func() { router.ServeHTTP(recorder, request) })
			assert.Equal(t, http.StatusOK, recorder.Code)
			assert.Equal(t, tc.body, recorder.Body.String())
		})
	}
}

func TestPrepareEpayGatewaysKeepsExistingKeyAndRejectsBadID(t *testing.T) {
	originalGateways := operation_setting.EpayGateways
	t.Cleanup(func() {
		operation_setting.EpayGateways = originalGateways
	})
	operation_setting.EpayGateways = []operation_setting.EpayGateway{{
		ID: "siteusdt", EpayKey: "kept-secret",
	}}

	prepared, err := operation_setting.PrepareEpayGatewaysJSON(`[{"id":"siteusdt","name":"USDT","address":"https://usdt.example.com","epay_id":"100","epay_key":"","price":1},{"id":"sitetrx","name":"TRX","address":"https://trx.example.com","epay_id":"200","epay_key":"trx-secret","price":1}]`)
	require.NoError(t, err)
	assert.Contains(t, prepared, `"epay_key":"kept-secret"`)
	assert.Contains(t, prepared, `"epay_key":"trx-secret"`)
	require.Error(t, operation_setting.ValidateEpayGatewaysJSON(`[{"id":"epay","name":"bad","address":"","epay_id":"","epay_key":"","price":1}]`))
}
