package router

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/plugins"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestListModelsSupportsOpenAIAndGeminiAuthentication(t *testing.T) {
	setupRelayRouterTestDB(t)

	user := model.User{
		Username: "models-user",
		Status:   common.UserStatusEnabled,
		Group:    "default",
		Quota:    100,
	}
	require.NoError(t, model.DB.Create(&user).Error)
	require.NoError(t, model.DB.Create(&model.Token{
		UserId:         user.Id,
		Key:            "modelstestkey",
		Status:         common.TokenStatusEnabled,
		ExpiredTime:    -1,
		UnlimitedQuota: true,
	}).Error)

	engine := gin.New()
	SetRelayRouter(engine)

	tests := []struct {
		name           string
		path           string
		headerName     string
		expectedObject string
		expectedField  string
	}{
		{
			name:           "OpenAI bearer token",
			path:           "/v1/models",
			headerName:     "Authorization",
			expectedObject: "list",
			expectedField:  "data",
		},
		{
			name:          "Gemini API key header",
			path:          "/v1/models",
			headerName:    "x-goog-api-key",
			expectedField: "models",
		},
		{
			name:          "Gemini API key query",
			path:          "/v1/models?key=modelstestkey",
			expectedField: "models",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, test.path, nil)
			if test.headerName != "" {
				value := "modelstestkey"
				if test.headerName == "Authorization" {
					value = "Bearer " + value
				}
				request.Header.Set(test.headerName, value)
			}

			engine.ServeHTTP(recorder, request)

			require.Equal(t, http.StatusOK, recorder.Code)
			var payload map[string]any
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload))
			assert.Contains(t, payload, test.expectedField)
			assert.NotContains(t, payload, "error")
			if test.expectedObject != "" {
				assert.Equal(t, test.expectedObject, payload["object"])
			}
		})
	}
}

func TestSub2APIKeyBilling(t *testing.T) {
	setupRelayRouterTestDB(t)
	require.NoError(t, i18n.Init())
	previousGroups := setting.UserUsableGroups2JSONString()
	previousRatios := ratio_setting.GroupRatio2JSONString()
	previousSpecialRatios := ratio_setting.GroupGroupRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(previousGroups))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(previousRatios))
		require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(previousSpecialRatios))
	})
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"billing-vip":"VIP","billing-free":"Free","auto":"Auto"}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"billing-member":1.2,"billing-vip":1.5,"billing-free":2,"billing-private":3}`))
	require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(`{"billing-member":{"billing-vip":0.4,"billing-free":0}}`))

	user := model.User{Username: "key-billing", AffCode: "bk01", Status: common.UserStatusEnabled, Group: "billing-member"}
	require.NoError(t, model.DB.Create(&user).Error)
	blockedUser := model.User{Username: "key-billing-blocked", AffCode: "bk02", Status: common.UserStatusDisabled, Group: "billing-member"}
	require.NoError(t, model.DB.Create(&blockedUser).Error)
	deletedUser := model.User{Username: "key-billing-deleted", AffCode: "bk03", Status: common.UserStatusEnabled, Group: "billing-member"}
	require.NoError(t, model.DB.Create(&deletedUser).Error)
	require.NoError(t, model.DB.Delete(&deletedUser).Error)

	engine := gin.New()
	SetRelayRouter(engine)

	for _, tc := range []struct {
		name           string
		key            string
		group          string
		tokenStatus    int
		expiredTime    int64
		userID         int
		allowIPs       *string
		queryKey       bool
		unknown        bool
		status         int
		groupRatio     float64
		specialRatio   *float64
		effectiveRatio float64
	}{
		{name: "固定分组使用专属倍率", key: "ratetestspecial", group: "billing-vip", status: http.StatusOK, groupRatio: 1.5, specialRatio: common.GetPointer(0.4), effectiveRatio: 0.4},
		{name: "额度耗尽仍可以读取零倍率", key: "ratetestfree", group: "billing-free", tokenStatus: common.TokenStatusExhausted, status: http.StatusOK, groupRatio: 2, specialRatio: common.GetPointer(0.0)},
		{name: "未绑定分组时使用账号分组", key: "ratetestinherited", status: http.StatusOK, groupRatio: 1.2, effectiveRatio: 1.2},
		{name: "过期密钥仍可查询", key: "ratetestexpired", expiredTime: 1, status: http.StatusOK, groupRatio: 1.2, effectiveRatio: 1.2},
		{name: "自动分组不报固定倍率", key: "ratetestauto", group: "auto", status: http.StatusNotFound},
		{name: "没有分组权限", key: "ratetestprivate", group: "billing-private", status: http.StatusForbidden},
		{name: "密钥已停用", key: "ratetestdisabled", tokenStatus: common.TokenStatusDisabled, status: http.StatusUnauthorized},
		{name: "用户已停用", key: "ratetestblockeduser", userID: blockedUser.Id, status: http.StatusForbidden},
		{name: "用户已删除", key: "ratetestdeleteduser", userID: deletedUser.Id, status: http.StatusUnauthorized},
		{name: "请求 IP 不匹配", key: "ratetestiprestricted", allowIPs: common.GetPointer("198.51.100.0/24"), status: http.StatusForbidden},
		{name: "拒绝 URL 查询参数里的密钥", key: "ratetestquery", queryKey: true, status: http.StatusUnauthorized},
		{name: "缺少密钥", status: http.StatusUnauthorized},
		{name: "未知密钥", key: "ratetestunknown", unknown: true, status: http.StatusUnauthorized},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if tc.key != "" && !tc.unknown {
				userID := tc.userID
				if userID == 0 {
					userID = user.Id
				}
				require.NoError(t, model.DB.Create(&model.Token{
					UserId: userID, Key: tc.key, Group: tc.group, Status: tc.tokenStatus,
					ExpiredTime: tc.expiredTime, AllowIps: tc.allowIPs,
				}).Error)
			}

			request := httptest.NewRequest(http.MethodGet, "/v1/sub2api/billing", nil)
			if tc.queryKey {
				request.URL.RawQuery = "key=sk-" + tc.key
			} else if tc.key != "" {
				request.Header.Set("Authorization", "Bearer sk-"+tc.key)
			}
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			require.Equal(t, tc.status, recorder.Code, recorder.Body.String())
			var payload map[string]any
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload))
			assert.Contains(t, recorder.Header().Get("Cache-Control"), "no-store")
			if tc.status != http.StatusOK {
				assert.NotContains(t, payload, "effective_rate_multiplier")
				return
			}

			observedAt, ok := payload["observed_at"].(string)
			require.True(t, ok)
			_, err := time.Parse(time.RFC3339Nano, observedAt)
			assert.NoError(t, err)
			expected := map[string]any{
				"object": "sub2api.key_billing", "schema_version": float64(1), "billing_scope": "token",
				"group_rate_multiplier": tc.groupRatio, "resolved_rate_multiplier": tc.effectiveRatio,
				"effective_rate_multiplier": tc.effectiveRatio, "peak_rate_enabled": false, "observed_at": observedAt,
			}
			if tc.specialRatio != nil {
				expected["user_rate_multiplier"] = *tc.specialRatio
			}
			assert.Equal(t, expected, payload)
		})
	}
}

func TestGeminiRelayHandsLongRunningPredictionToPluginRoute(t *testing.T) {
	setupRelayRouterTestDB(t)
	require.NoError(t, i18n.Init())
	user := model.User{Username: "veo-user", Status: common.UserStatusEnabled, Group: "default", Quota: 100}
	require.NoError(t, model.DB.Create(&user).Error)
	require.NoError(t, model.DB.Create(&model.Token{UserId: user.Id, Key: "veotestkey", Status: common.TokenStatusEnabled, ExpiredTime: -1, UnlimitedQuota: true}).Error)

	engine := gin.New()
	SetRelayRouter(engine)
	source, err := plugins.Source("google")
	require.NoError(t, err)
	registry := jsplugin.NewRegistry()
	_, err = registry.RegisterFactory(source, jsplugin.Options{Key: "google"})
	require.NoError(t, err)
	// The plugin route authenticates as in production, then names itself.
	handlers := func(generation *jsplugin.RoutingGeneration, group jsplugin.RouteGroup) []gin.HandlerFunc {
		production := productionPluginRouteHandlers(generation, group)
		return []gin.HandlerFunc{production[0], production[1], production[2], func(c *gin.Context) {
			c.String(http.StatusOK, "plugin %s for user %d", group.Bindings[0].Plugin.Meta.Key, c.GetInt("id"))
		}}
	}
	require.NoError(t, registry.SetGenerationPreparer(newPluginGenerationBuilder(engine.Routes(), nil, handlers).prepare))
	require.Empty(t, registry.RoutingErrors())
	previousRegistry := defaultPluginDispatcher.registry
	defaultPluginDispatcher.registry = registry
	t.Cleanup(func() { defaultPluginDispatcher.registry = previousRegistry })
	engine.NoRoute(defaultPluginDispatcher.dispatch)

	for _, testCase := range []struct {
		method   string
		path     string
		toPlugin bool
	}{
		{method: http.MethodPost, path: "/v1beta/models/veo-3.1-generate-preview:predictLongRunning", toPlugin: true},
		{method: http.MethodGet, path: "/v1beta/models/veo-3.1-generate-preview/operations/task_sample", toPlugin: true},
		{method: http.MethodPost, path: "/v1beta/models/gemini-2.5-flash:generateContent"},
	} {
		t.Run(testCase.path, func(t *testing.T) {
			request := httptest.NewRequest(testCase.method, testCase.path, strings.NewReader(`{}`))
			request.Header.Set("x-goog-api-key", "veotestkey")
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)

			if testCase.toPlugin {
				assert.Equal(t, fmt.Sprintf("plugin google for user %d", user.Id), recorder.Body.String())
				return
			}
			// The relay looks for a Gemini channel serving the model; there is none.
			assert.Equal(t, http.StatusNotFound, recorder.Code)
			assert.Contains(t, recorder.Body.String(), `"code":"model_not_found"`)
		})
	}
}

func setupRelayRouterTestDB(t *testing.T) {
	t.Helper()

	gin.SetMode(gin.TestMode)
	originalIsMasterNode := common.IsMasterNode
	originalRedisEnabled := common.RedisEnabled
	originalSQLitePath := common.SQLitePath
	originalMainDatabaseType := common.MainDatabaseType()
	originalLogDatabaseType := common.LogDatabaseType()
	originalSQLDSN, hadSQLDSN := os.LookupEnv("SQL_DSN")

	common.IsMasterNode = false
	common.RedisEnabled = false
	common.SQLitePath = fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	require.NoError(t, os.Setenv("SQL_DSN", "local"))
	require.NoError(t, model.InitDB())
	model.LOG_DB = model.DB
	require.NoError(t, model.DB.AutoMigrate(&model.User{}, &model.Token{}, &model.Ability{}))

	t.Cleanup(func() {
		if sqlDB, err := model.DB.DB(); err == nil {
			_ = sqlDB.Close()
		}
		common.IsMasterNode = originalIsMasterNode
		common.RedisEnabled = originalRedisEnabled
		common.SQLitePath = originalSQLitePath
		common.SetDatabaseTypes(originalMainDatabaseType, originalLogDatabaseType)
		if hadSQLDSN {
			require.NoError(t, os.Setenv("SQL_DSN", originalSQLDSN))
		} else {
			require.NoError(t, os.Unsetenv("SQL_DSN"))
		}
	})
}
