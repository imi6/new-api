package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetStatusReturnsLogCacheHitRateVisibility(t *testing.T) {
	settings := operation_setting.GetLogSetting()
	previousEnabled := settings.CacheHitRateEnabled
	previousOptions := common.OptionMap
	t.Cleanup(func() {
		settings.CacheHitRateEnabled = previousEnabled
		common.OptionMap = previousOptions
	})
	common.OptionMap = map[string]string{}

	for _, tc := range []struct {
		name    string
		enabled bool
	}{
		{name: "显示", enabled: true},
		{name: "隐藏", enabled: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			settings.CacheHitRateEnabled = tc.enabled
			response := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(response)
			context.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)

			GetStatus(context)

			var payload struct {
				Success bool           `json:"success"`
				Data    map[string]any `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
			require.True(t, payload.Success)
			assert.Equal(t, tc.enabled, payload.Data["log_cache_hit_rate_enabled"])
		})
	}
}
