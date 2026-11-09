package router

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/authz"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// accessTokenExemptRoutes are /api routes that never reach dashboard
// authentication, so a personal access token has no rule to satisfy there.
var accessTokenExemptRoutes = []string{
	// Anonymous pages and setup.
	"GET /api/setup",
	"POST /api/setup",
	"GET /api/status",
	"GET /api/uptime/status",
	"GET /api/notice",
	"GET /api/user-agreement",
	"GET /api/privacy-policy",
	"GET /api/about",
	"GET /api/home_page_content",
	"GET /api/ratio_config",
	"GET /api/user/groups",

	// Anonymous account entry points.
	"GET /api/verification",
	"GET /api/reset_password",
	"POST /api/user/reset",
	"POST /api/user/register",
	"GET /api/user/login/encryption-key",
	"POST /api/user/login",
	"POST /api/user/login/2fa",
	"POST /api/user/login/verify",
	"POST /api/user/login/passkey/begin",
	"POST /api/user/login/passkey/finish",
	"POST /api/user/passkey/login/begin",
	"POST /api/user/passkey/login/finish",
	"GET /api/oauth/wechat",
	"GET /api/oauth/telegram/login",
	"GET /api/oauth/telegram/bind/:flow_token",

	// Browser session cookie endpoints.
	"POST /api/user/auth/refresh",
	"POST /api/user/auth/logout",

	// Payment callbacks.
	"POST /api/stripe/webhook",
	"POST /api/creem/webhook",
	"POST /api/waffo/webhook",
	"POST /api/waffo-pancake/webhook/:env",
	"GET /api/user/epay/notify",
	"POST /api/user/epay/notify",
	"GET /api/user/epay/gateway/:id/notify",
	"POST /api/user/epay/gateway/:id/notify",
	"GET /api/subscription/epay/notify",
	"POST /api/subscription/epay/notify",
	"GET /api/subscription/epay/return",
	"POST /api/subscription/epay/return",
	"GET /api/subscription/epay/gateway/:id/notify",
	"POST /api/subscription/epay/gateway/:id/notify",
	"GET /api/subscription/epay/gateway/:id/return",
	"POST /api/subscription/epay/gateway/:id/return",
	"GET /api/invoice/epay/notify",
	"POST /api/invoice/epay/notify",
	"GET /api/invoice/epay/gateway/:id/notify",
	"POST /api/invoice/epay/gateway/:id/notify",

	// API key authentication (TokenAuthReadOnly).
	"GET /api/usage/token/",
	"GET /api/log/token",
}

// accessTokenHelperRoutes are declared through handlePermissionRoute outside
// channelPermissionRoutes.
var accessTokenHelperRoutes = map[string]authz.Permission{
	"GET /api/task_plugin_options": authz.TaskPluginBind,
	"GET /api/audit":               authz.AuditRead,
}

func newAccessTokenScopeTestEngine(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	// A permission route that is also in the static table panics here.
	require.NotPanics(t, func() {
		SetApiRouter(engine)
		SetDashboardRouter(engine)
		SetRelayRouter(engine)
		SetTaskPluginProtocolRouter(engine)
		SetVideoRouter(engine)
		SetTaskRouter(engine)
	})
	return engine
}

func TestAccessTokenRouteRulesCoverEveryDashboardRoute(t *testing.T) {
	engine := newAccessTokenScopeTestEngine(t)
	exempt := map[string]bool{}
	for _, key := range accessTokenExemptRoutes {
		exempt[key] = true
	}
	registered := map[string]bool{}
	panel := map[string]bool{}
	for _, route := range engine.Routes() {
		if !strings.HasPrefix(route.Path, "/api/") && !strings.HasPrefix(route.Path, "/pg/") {
			continue
		}
		key := route.Method + " " + route.Path
		registered[key] = true
		if !exempt[key] {
			panel[key] = true
		}
	}
	for _, key := range accessTokenExemptRoutes {
		assert.True(t, registered[key], "exempt route %s is no longer registered", key)
	}

	declared := map[string]int{}
	for _, key := range middleware.AccessTokenRouteRuleKeys() {
		declared[key]++
	}
	for key := range panel {
		assert.Equal(t, 1, declared[key], "panel route %s must be declared exactly once", key)
	}
	for key := range declared {
		assert.True(t, panel[key], "declared route %s is not a registered panel route", key)
	}

	permissionRoutes := map[string]authz.Permission{}
	for _, route := range channelPermissionRoutes {
		permissionRoutes[route.method+" "+joinPaths("/api/channel", route.path)] = route.permission
	}
	for key, permission := range accessTokenHelperRoutes {
		permissionRoutes[key] = permission
	}
	for key, permission := range permissionRoutes {
		rule, ok := middleware.AccessTokenRouteRule(key)
		require.True(t, ok, key)
		assert.Equal(t, "scope", rule.Kind(), key)
		assert.Equal(t, service.AccessTokenScopeOf(permission), rule.Scope(), key)
	}
}

func TestAccessTokenCatalogCoversEveryPermission(t *testing.T) {
	catalog := service.AccessTokenCatalog(1, common.RoleRootUser)
	scopes := map[string]bool{}
	resources := map[string]int{}
	for _, group := range catalog {
		for _, resource := range group.Resources {
			resources[resource.Resource]++
			for _, action := range resource.Actions {
				scopes[resource.Resource+":"+action.Action] = true
			}
		}
	}
	for _, permission := range authz.AllPermissions() {
		assert.True(t, scopes[service.AccessTokenScopeOf(permission)], "root catalog lacks %s", service.AccessTokenScopeOf(permission))
	}
	for resource, count := range resources {
		assert.Equal(t, 1, count, "resource %s appears in more than one catalog entry", resource)
	}
}

func TestAccessTokenVerificationScopesAreAllListed(t *testing.T) {
	files, err := filepath.Glob("../service/*.go")
	require.NoError(t, err)
	fileSet := token.NewFileSet()
	var scopes []string
	for _, file := range files {
		if strings.HasSuffix(file, "_test.go") {
			continue
		}
		parsed, err := parser.ParseFile(fileSet, file, nil, 0)
		require.NoError(t, err)
		for _, declaration := range parsed.Decls {
			general, ok := declaration.(*ast.GenDecl)
			if !ok || general.Tok != token.CONST {
				continue
			}
			for _, spec := range general.Specs {
				value := spec.(*ast.ValueSpec)
				for i, name := range value.Names {
					if !strings.HasPrefix(name.Name, "VerificationScope") || i >= len(value.Values) {
						continue
					}
					literal, ok := value.Values[i].(*ast.BasicLit)
					require.True(t, ok, name.Name)
					scope, err := strconv.Unquote(literal.Value)
					require.NoError(t, err)
					scopes = append(scopes, scope)
				}
			}
		}
	}
	require.NotEmpty(t, scopes)
	for _, scope := range scopes {
		_, listed := service.AccessTokenVerificationScope(scope)
		assert.True(t, listed, "verification scope %s has no access token rule", scope)
	}
}

func TestAffiliateCashRoutesEnforceOwnershipAndRoles(t *testing.T) {
	setupRelayRouterTestDB(t)
	require.NoError(t, i18n.Init())
	require.NoError(t, model.DB.AutoMigrate(
		&model.UserSession{}, &model.UserAccessToken{}, &model.Option{}, &model.AuditLog{}, &model.Log{},
		&model.AffiliateAccount{}, &model.AffiliateLedgerEntry{}, &model.AffiliateRebateClaim{}, &model.UserPaidConsumptionDay{},
		&model.AffiliateCashWallet{}, &model.AffiliateCashEntry{}, &model.AffiliateCashExchange{},
		&model.AffiliateWithdrawal{}, &model.AffiliateWithdrawalEvent{}, &model.AffiliateWithdrawalProof{},
	))
	previousSecret := common.SessionSecret
	previousGlobalLimit, previousCriticalLimit := common.GlobalApiRateLimitEnable, common.CriticalRateLimitEnable
	previousQuotaUnit, previousPercent, previousThreshold := common.QuotaPerUnit, common.AffiliateRebatePercent, common.AffiliateRebateUpstreamQuota
	previousPayment := *operation_setting.GetPaymentSetting()
	common.SessionSecret = "affiliate-route-session-test-secret"
	common.GlobalApiRateLimitEnable, common.CriticalRateLimitEnable = false, false
	common.QuotaPerUnit, common.AffiliateRebatePercent, common.AffiliateRebateUpstreamQuota = 1, 10, 0
	operation_setting.GetPaymentSetting().ComplianceConfirmed = true
	operation_setting.GetPaymentSetting().ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
	t.Cleanup(func() {
		common.SessionSecret = previousSecret
		common.GlobalApiRateLimitEnable, common.CriticalRateLimitEnable = previousGlobalLimit, previousCriticalLimit
		common.QuotaPerUnit, common.AffiliateRebatePercent, common.AffiliateRebateUpstreamQuota = previousQuotaUnit, previousPercent, previousThreshold
		*operation_setting.GetPaymentSetting() = previousPayment
	})

	users := make([]model.User, 4)
	credentials := make([]string, len(users))
	for i, role := range []int{common.RoleCommonUser, common.RoleAdminUser, common.RoleRootUser, common.RoleCommonUser} {
		users[i] = model.User{Username: fmt.Sprintf("cash-route-%d", i), AffCode: fmt.Sprintf("cash-route-%d", i), Password: "unused", Status: common.UserStatusEnabled, Role: role, Group: "default", AuthVersion: 1, PaidQuotaConsumed: 10000}
		require.NoError(t, model.DB.Create(&users[i]).Error)
		bundle, err := service.CreateLoginSession(users[i].Id, "password", "127.0.0.1", "affiliate-route-test")
		require.NoError(t, err)
		credentials[i] = bundle.AccessToken
	}
	orders := make([]model.AffiliateWithdrawal, 2)
	for i, user := range []model.User{users[0], users[3]} {
		orders[i] = model.AffiliateWithdrawal{UserID: user.Id, RequestID: "seed", RequestHash: "test", AmountUnits: 10000000, FeeUnits: 1000000, NetUnits: 9000000, Network: "ethereum", Address: "0x1111111111111111111111111111111111111111", Status: "pending", ConfigVersion: "test", ConfigSnapshot: "{}", CancelFeePolicy: "refund", FailedFeePolicy: "refund"}
		require.NoError(t, model.DB.Create(&orders[i]).Error)
		require.NoError(t, model.DB.Create(&model.AffiliateCashWallet{UserID: user.Id, Frozen: orders[i].AmountUnits}).Error)
	}
	engine := gin.New()
	SetApiRouter(engine)
	request := func(method, path, credential, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if credential != "" {
			req.Header.Set("Authorization", "Bearer "+credential)
		}
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, req)
		return recorder
	}
	selfBase, adminBase := "/api/user/affiliate_cash", "/api/user/affiliate/cash"
	t.Run("新增接口均拒绝未登录请求", func(t *testing.T) {
		for _, route := range engine.Routes() {
			if !strings.HasPrefix(route.Path, selfBase) && !strings.HasPrefix(route.Path, adminBase) {
				continue
			}
			path := strings.ReplaceAll(route.Path, ":id", strconv.FormatInt(orders[0].ID, 10))
			response := request(route.Method, path, "", `{}`)
			assert.Equal(t, http.StatusUnauthorized, response.Code, "%s %s: %s", route.Method, path, response.Body.String())
		}
		// 刷新 Cookie 不能替代 Authorization 中的有效仪表盘会话。
		req := httptest.NewRequest(http.MethodGet, selfBase+"/withdrawals", nil)
		req.AddCookie(&http.Cookie{Name: service.RefreshCookieName, Value: "cookie-only"})
		response := httptest.NewRecorder()
		engine.ServeHTTP(response, req)
		assert.Equal(t, http.StatusUnauthorized, response.Code)
	})
	t.Run("root个人访问令牌不能替代仪表盘会话", func(t *testing.T) {
		raw := model.AccessTokenPrefix + strings.Repeat("a", 43)
		token := &model.UserAccessToken{Name: "cash-route-pat", TokenHash: model.AccessTokenFingerprint(raw), TokenHint: model.AccessTokenHint(raw)}
		require.NoError(t, token.SetScopes([]string{"wallet:read", "wallet:write", "billing:read", "billing:write", "option:read", "option:write"}))
		require.NoError(t, model.CreateUserAccessToken(users[2].Id, token, service.AccessTokenMaxPerUser))
		for _, route := range engine.Routes() {
			if !strings.HasPrefix(route.Path, selfBase) && !strings.HasPrefix(route.Path, adminBase) {
				continue
			}
			path := strings.ReplaceAll(route.Path, ":id", strconv.FormatInt(orders[0].ID, 10))
			response := request(route.Method, path, raw, `{}`)
			assert.Equal(t, http.StatusForbidden, response.Code, "%s %s: %s", route.Method, path, response.Body.String())
			var body struct {
				Code string `json:"code"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &body))
			assert.Equal(t, "AUTH_SESSION_REQUIRED", body.Code, path)
		}
	})
	t.Run("列表始终限于本人且不接受查询参数越权", func(t *testing.T) {
		response := request(http.MethodGet, selfBase+"/withdrawals?user_id="+strconv.Itoa(users[3].Id), credentials[0], "")
		require.Equal(t, http.StatusOK, response.Code)
		var body struct {
			Success bool `json:"success"`
			Data    struct {
				Items []model.AffiliateWithdrawal `json:"items"`
				Total int                         `json:"total"`
			} `json:"data"`
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &body))
		require.True(t, body.Success, response.Body.String())
		require.Len(t, body.Data.Items, 1)
		assert.Equal(t, 1, body.Data.Total)
		assert.Equal(t, orders[0].ID, body.Data.Items[0].ID)
		assert.Equal(t, users[0].Id, body.Data.Items[0].UserID)
		assert.Contains(t, response.Header().Get("Cache-Control"), "no-store")
	})
	t.Run("不能取消他人且不能注入管理员动作", func(t *testing.T) {
		response := request(http.MethodPost, fmt.Sprintf("%s/withdrawals/%d/cancel", selfBase, orders[1].ID), credentials[0], `{"request_id":"other-cancel","action":"complete","expected_version":1}`)
		var body struct {
			Success bool `json:"success"`
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &body))
		assert.False(t, body.Success)
		var unchanged model.AffiliateWithdrawal
		require.NoError(t, model.DB.First(&unchanged, orders[1].ID).Error)
		assert.Equal(t, "pending", unchanged.Status)
		response = request(http.MethodPost, fmt.Sprintf("%s/withdrawals/%d/cancel", selfBase, orders[0].ID), credentials[0], `{"request_id":"own-cancel","action":"complete"}`)
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &body))
		assert.False(t, body.Success, "没有版本号的旧请求不能修改资金订单")
		response = request(http.MethodPost, fmt.Sprintf("%s/withdrawals/%d/cancel", selfBase, orders[0].ID), credentials[0], `{"request_id":"own-cancel","action":"complete","expected_version":1}`)
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &body))
		require.True(t, body.Success, response.Body.String())
		unchanged = model.AffiliateWithdrawal{}
		require.NoError(t, model.DB.First(&unchanged, orders[0].ID).Error)
		assert.Equal(t, "cancelled", unchanged.Status)
		var wallet model.AffiliateCashWallet
		require.NoError(t, model.DB.First(&wallet, users[0].Id).Error)
		assert.Equal(t, int64(10000000), wallet.Available)
		assert.Zero(t, wallet.Frozen)
	})
	t.Run("普通用户不能访问任何提现管理接口", func(t *testing.T) {
		for _, route := range engine.Routes() {
			if !strings.HasPrefix(route.Path, adminBase) {
				continue
			}
			path := strings.ReplaceAll(route.Path, ":id", strconv.FormatInt(orders[1].ID, 10))
			response := request(route.Method, path, credentials[0], `{}`)
			assert.Equal(t, http.StatusForbidden, response.Code, "%s %s: %s", route.Method, path, response.Body.String())
		}
	})
	t.Run("管理员可读取但只有root能保存配置", func(t *testing.T) {
		response := request(http.MethodGet, adminBase+"/withdrawals", credentials[1], "")
		require.Equal(t, http.StatusOK, response.Code)
		var body struct {
			Success bool `json:"success"`
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &body))
		require.True(t, body.Success, response.Body.String())
		settings, err := model.GetAffiliateCashSettings()
		require.NoError(t, err)
		payload, err := common.Marshal(settings)
		require.NoError(t, err)
		response = request(http.MethodPut, adminBase+"/settings", credentials[1], string(payload))
		assert.Equal(t, http.StatusForbidden, response.Code)
		response = request(http.MethodPut, adminBase+"/settings", credentials[2], string(payload))
		require.Equal(t, http.StatusOK, response.Code)
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &body))
		assert.True(t, body.Success, response.Body.String())
	})
	t.Run("旧领取默认平台且显式未知去向不会触发兑换", func(t *testing.T) {
		require.NoError(t, model.DB.Create(&model.AffiliateAccount{UserID: users[0].Id, Accrued: 1000}).Error)
		now := time.Now()
		year, month, day := now.Date()
		require.NoError(t, model.DB.Create(&model.UserPaidConsumptionDay{UserID: users[0].Id, DayStart: time.Date(year, month, day, 0, 0, 0, 0, now.Location()).Unix(), Delta: 10000}).Error)
		for _, test := range []struct{ path, body string }{
			{"/api/user/affiliate_rebate/claim", `{"quota":10,"destination":"u"}`},
			{"/api/user/affiliate_rebate/claim", `{"quota":10,"destination":"unknown"}`},
			{selfBase + "/exchange/preview", `{"quota":10,"destination":"unknown"}`},
			{selfBase + "/exchange", `{"quota":10,"destination":"unknown","request_id":"invalid"}`},
		} {
			response := request(http.MethodPost, test.path, credentials[0], test.body)
			var body struct {
				Success bool `json:"success"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &body))
			assert.False(t, body.Success, test.path)
		}
		response := request(http.MethodPost, "/api/user/affiliate_rebate/claim", credentials[0], `{"quota":10,"request_id":"legacy-default"}`)
		var body struct {
			Success bool `json:"success"`
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &body))
		require.True(t, body.Success, response.Body.String())
		var stored model.User
		require.NoError(t, model.DB.First(&stored, users[0].Id).Error)
		assert.Equal(t, 10, stored.Quota)
		assert.Equal(t, 10, stored.AffiliateRebateClaimed)
		var claim model.AffiliateRebateClaim
		require.NoError(t, model.DB.Where("user_id = ?", users[0].Id).First(&claim).Error)
		assert.Equal(t, "platform", claim.Destination)
		var wallet model.AffiliateCashWallet
		require.NoError(t, model.DB.First(&wallet, users[0].Id).Error)
		assert.Equal(t, int64(10000000), wallet.Available, "旧平台领取不得改变U余额")
	})
}

func TestInvoiceDeletionRouteAuthorizationAndFileCleanup(t *testing.T) {
	setupRelayRouterTestDB(t)
	require.NoError(t, i18n.Init())
	require.NoError(t, model.DB.AutoMigrate(
		&model.UserSession{}, &model.UserAccessToken{}, &model.Option{}, &model.AuditLog{},
		&model.Invoice{}, &model.InvoiceItem{}, &model.InvoiceOrderLock{}, &model.InvoiceTaxPayment{},
		&model.InvoiceDeletion{}, &model.InvoiceIDReservation{},
	))
	previousSecret := common.SessionSecret
	previousGlobalLimit, previousCriticalLimit := common.GlobalApiRateLimitEnable, common.CriticalRateLimitEnable
	common.SessionSecret = "invoice-delete-route-test-secret"
	common.GlobalApiRateLimitEnable, common.CriticalRateLimitEnable = false, false
	t.Cleanup(func() {
		common.SessionSecret = previousSecret
		common.GlobalApiRateLimitEnable, common.CriticalRateLimitEnable = previousGlobalLimit, previousCriticalLimit
	})
	storage := t.TempDir()
	t.Setenv("INVOICE_FILE_DIR", storage)
	users := make([]model.User, 2)
	bundles := make([]*service.AuthBundle, 2)
	for i, role := range []int{common.RoleCommonUser, common.RoleAdminUser} {
		users[i] = model.User{Username: fmt.Sprintf("invoice-route-%d", i), AffCode: fmt.Sprintf("invoice-route-%d", i), Password: "unused", Role: role, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1}
		require.NoError(t, model.DB.Create(&users[i]).Error)
		var err error
		bundles[i], err = service.CreateLoginSession(users[i].Id, "password", "127.0.0.1", "invoice-route-test")
		require.NoError(t, err)
	}
	engine := gin.New()
	SetApiRouter(engine)
	request := func(method, path, credential, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if credential != "" {
			req.Header.Set("Authorization", "Bearer "+credential)
		}
		response := httptest.NewRecorder()
		engine.ServeHTTP(response, req)
		return response
	}
	stored, err := service.SaveInvoiceFile("invoice.pdf", []byte("%PDF-1.4\ninvoice deletion test"))
	require.NoError(t, err)
	invoice := model.Invoice{UserId: users[0].Id, Status: model.InvoiceStatusIssued, OrderAmount: "100.00", InvoiceAmount: "100.00", IssuedTime: common.GetTimestamp(), FileKey: stored.Key, FileName: stored.Name, FileMime: stored.Mime}
	require.NoError(t, model.DB.Create(&invoice).Error)
	path := fmt.Sprintf("/api/invoice/admin/%d/delete", invoice.Id)
	const payload = `{"reason":"清理已交付记录"}`
	for _, test := range []struct {
		name, credential string
		status           int
	}{
		{"未登录", "", http.StatusUnauthorized},
		{"伪造凭据", "invalid", http.StatusUnauthorized},
		{"普通用户", bundles[0].AccessToken, http.StatusForbidden},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := request(http.MethodPost, path, test.credential, payload)
			assert.Equal(t, test.status, response.Code, response.Body.String())
		})
	}
	cookieRequest := httptest.NewRequest(http.MethodPost, path, strings.NewReader(payload))
	cookieRequest.AddCookie(&http.Cookie{Name: service.RefreshCookieName, Value: bundles[1].RefreshToken})
	cookieResponse := httptest.NewRecorder()
	engine.ServeHTTP(cookieResponse, cookieRequest)
	assert.Equal(t, http.StatusUnauthorized, cookieResponse.Code)
	revoked, err := service.CreateLoginSession(users[1].Id, "password", "127.0.0.1", "invoice-revoked-test")
	require.NoError(t, err)
	_, err = model.RevokeUserSession(users[1].Id, revoked.Session.SID, "test")
	require.NoError(t, err)
	assert.Equal(t, http.StatusUnauthorized, request(http.MethodPost, path, revoked.AccessToken, payload).Code)
	for _, test := range []struct {
		name, scope string
		expiresAt   int64
		status      int
	}{
		{"只读令牌", "billing:read", 0, http.StatusForbidden},
		{"过期令牌", "billing:write", common.GetTimestamp() - 1, http.StatusUnauthorized},
	} {
		raw := model.AccessTokenPrefix + common.GetRandomString(43)
		token := model.UserAccessToken{Name: test.name, TokenHash: model.AccessTokenFingerprint(raw), TokenHint: model.AccessTokenHint(raw), ExpiresAt: test.expiresAt}
		require.NoError(t, token.SetScopes([]string{test.scope}))
		require.NoError(t, model.CreateUserAccessToken(users[1].Id, &token, service.AccessTokenMaxPerUser))
		assert.Equal(t, test.status, request(http.MethodPost, path, raw, payload).Code, test.name)
	}
	// 拒绝的请求不能删除文件或申请；所有者在真正删除前仍能下载。
	downloadPath := fmt.Sprintf("/api/invoice/%d/file", invoice.Id)
	assert.Equal(t, "%PDF-1.4\ninvoice deletion test", request(http.MethodGet, downloadPath, bundles[0].AccessToken, "").Body.String())
	var result struct {
		Success bool `json:"success"`
		Data    struct {
			FileCleanupPending bool `json:"file_cleanup_pending"`
		} `json:"data"`
	}
	response := request(http.MethodPost, path, bundles[1].AccessToken, `{"reason":"清理已交付记录","admin_id":999}`)
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	require.True(t, result.Success, response.Body.String())
	assert.False(t, result.Data.FileCleanupPending)
	assert.Contains(t, response.Header().Get("Cache-Control"), "no-store")
	_, err = os.Stat(filepath.Join(storage, stored.Key))
	assert.True(t, os.IsNotExist(err))
	var receipt model.InvoiceDeletion
	require.NoError(t, model.DB.First(&receipt, invoice.Id).Error)
	assert.Equal(t, users[1].Id, receipt.DeletedBy, "不能通过请求伪造操作人")
	assert.Empty(t, receipt.FileKey)
	for _, read := range []struct{ path, credential string }{
		{downloadPath, bundles[0].AccessToken},
		{fmt.Sprintf("/api/invoice/self/%d", invoice.Id), bundles[0].AccessToken},
		{fmt.Sprintf("/api/invoice/admin/%d", invoice.Id), bundles[1].AccessToken},
	} {
		response = request(http.MethodGet, read.path, read.credential, "")
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		assert.False(t, result.Success, read.path)
	}
	response = request(http.MethodPost, path, bundles[1].AccessToken, payload)
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	assert.True(t, result.Success, "网络重试应返回首次删除结果")

	// 用非空目录制造真实文件清理失败，数据库删除仍然成功并留下重试信息。
	blockedKey := strings.Repeat("b", 32) + ".pdf"
	blockedPath := filepath.Join(storage, blockedKey)
	require.NoError(t, os.Mkdir(blockedPath, 0o750))
	blocker := filepath.Join(blockedPath, "keep")
	require.NoError(t, os.WriteFile(blocker, []byte("block removal"), 0o600))
	second := model.Invoice{UserId: users[0].Id, Status: model.InvoiceStatusIssued, OrderAmount: "50.00", FileKey: blockedKey}
	require.NoError(t, model.DB.Create(&second).Error)
	raw := model.AccessTokenPrefix + common.GetRandomString(43)
	writer := model.UserAccessToken{Name: "invoice writer", TokenHash: model.AccessTokenFingerprint(raw), TokenHint: model.AccessTokenHint(raw)}
	require.NoError(t, writer.SetScopes([]string{"billing:write"}))
	require.NoError(t, model.CreateUserAccessToken(users[1].Id, &writer, service.AccessTokenMaxPerUser))
	response = request(http.MethodPost, fmt.Sprintf("/api/invoice/admin/%d/delete", second.Id), raw, payload)
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	require.True(t, result.Success, response.Body.String())
	assert.True(t, result.Data.FileCleanupPending)
	_, err = model.GetInvoiceById(second.Id)
	assert.ErrorIs(t, err, model.ErrInvoiceNotFound)
	pending, err := model.ListPendingInvoiceFileDeletions(0, 100)
	require.NoError(t, err)
	require.Len(t, pending, 1)
	assert.Equal(t, blockedKey, pending[0].FileKey)
	require.NoError(t, os.Remove(blocker))
	_, err = service.CleanupDeletedInvoiceFiles(0)
	require.NoError(t, err)
	pending, err = model.ListPendingInvoiceFileDeletions(0, 100)
	require.NoError(t, err)
	assert.Empty(t, pending)
	assert.NoError(t, service.CleanupDeletedInvoiceFile(&model.InvoiceDeletion{InvoiceID: second.Id, FileKey: blockedKey}), "重试已不存在的文件也应成功")

	// 错误文件键不能逃逸附件根目录，且不能提前清除待重试信息。
	outside := filepath.Join(t.TempDir(), strings.Repeat("c", 32)+".pdf")
	require.NoError(t, os.WriteFile(outside, []byte("keep outside file"), 0o600))
	unsafe := model.InvoiceDeletion{InvoiceID: second.Id + 1, UserID: users[0].Id, FileKey: outside, Reason: "legacy invalid key"}
	require.NoError(t, model.DB.Create(&unsafe).Error)
	assert.Error(t, service.CleanupDeletedInvoiceFile(&unsafe))
	content, err := os.ReadFile(outside)
	require.NoError(t, err)
	assert.Equal(t, "keep outside file", string(content))
	pending, err = model.ListPendingInvoiceFileDeletions(0, 100)
	require.NoError(t, err)
	require.Len(t, pending, 1)
	assert.Equal(t, outside, pending[0].FileKey)
}
