package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUSDTTopUpBonusAddsOnePercentQuota(t *testing.T) {
	originalMethods := operation_setting.PayMethods
	originalQuotaPerUnit := common.QuotaPerUnit
	t.Cleanup(func() {
		operation_setting.PayMethods = originalMethods
		common.QuotaPerUnit = originalQuotaPerUnit
	})
	common.QuotaPerUnit = 500000
	operation_setting.PayMethods = []map[string]string{
		{"type": "alipay"},
		{"type": "usdt", "bonus_percent": "1"},
		{"type": "broken", "bonus_percent": "150"},
	}

	alipay, err := creditedTopUpQuota(decimal.NewFromInt(100), "alipay", "")
	require.NoError(t, err)
	usdt, err := creditedTopUpQuota(decimal.NewFromInt(100), "usdt", "")
	require.NoError(t, err)
	broken, err := creditedTopUpQuota(decimal.NewFromInt(100), "broken", "")
	require.NoError(t, err)

	assert.Equal(t, 50000000, alipay)
	assert.Equal(t, 50500000, usdt)
	assert.Equal(t, 50000000, broken)
}

func TestEpayCallbackMustMatchMoneyAndGateway(t *testing.T) {
	originalMethods := operation_setting.PayMethods
	t.Cleanup(func() { operation_setting.PayMethods = originalMethods })
	operation_setting.PayMethods = []map[string]string{
		{"type": "alipay"},
		{"type": "usdt", "gateway": "siteusdt"},
	}

	assert.True(t, epayCallbackMatches(10, "alipay", "10.00", "epay", ""))
	assert.True(t, epayCallbackMatches(10, "alipay", "10", "epay", ""))
	assert.False(t, epayCallbackMatches(10, "alipay", "0.01", "epay", ""))
	assert.False(t, epayCallbackMatches(10, "alipay", "10.00", "siteusdt", ""))
	assert.False(t, epayCallbackMatches(10, "usdt", "10.00", "epay", ""))
	assert.True(t, epayCallbackMatches(10, "usdt", "10.00", "siteusdt", ""))
	assert.False(t, epayCallbackMatches(10, "alipay", "", "epay", ""))
	assert.True(t, epayCallbackMatches(10, "alipay", "10.00", "epay2", "epay2"))
	assert.False(t, epayCallbackMatches(10, "alipay", "10.00", "epay", "epay2"))
}
