package router

import (
	"crypto/hmac"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/authz"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestGetTaskPluginOptionsAdminForbiddenRootAllowed(t *testing.T) {
	wasMaster := common.IsMasterNode
	common.IsMasterNode = true
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.CasbinRule{}, &model.AuthzRole{}))
	require.NoError(t, authz.Init(db))
	t.Cleanup(func() { common.IsMasterNode = wasMaster })

	gin.SetMode(gin.TestMode)
	for _, testCase := range []struct {
		name       string
		id         int
		role       int
		wantStatus int
	}{
		{name: "admin", id: 2, role: common.RoleAdminUser, wantStatus: http.StatusForbidden},
		{name: "root", id: 1, role: common.RoleRootUser, wantStatus: http.StatusOK},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)
			context.Request = httptest.NewRequest(http.MethodGet, "/api/task_plugin_options", nil)
			context.Set("id", testCase.id)
			context.Set("role", testCase.role)
			middleware.RequirePermission(authz.TaskPluginBind)(context)
			if !context.IsAborted() {
				controller.GetTaskPluginOptions(context)
			}
			assert.Equal(t, testCase.wantStatus, recorder.Code)
		})
	}
}

func TestGroupRenameRouteAuthorizationAndCSRF(t *testing.T) {
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousMainType, previousLogType := common.MainDatabaseType(), common.LogDatabaseType()
	previousRedis, previousSecret := common.RedisEnabled, common.SessionSecret
	previousSecure, previousTrusted := common.SessionCookieSecure, common.SessionCookieTrustedURLs
	previousGlobalLimit, previousCriticalLimit := common.GlobalApiRateLimitEnable, common.CriticalRateLimitEnable
	previousActiveLimit, previousIssuanceLimit := common.UserSessionActiveLimit, common.UserSessionIssuanceLimit
	previousIssuanceWindow := common.UserSessionIssuanceWindowSeconds
	previousGinMode := gin.Mode()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetMainDatabaseType(previousMainType)
		common.SetLogDatabaseType(previousLogType)
		common.RedisEnabled, common.SessionSecret = previousRedis, previousSecret
		common.SessionCookieSecure, common.SessionCookieTrustedURLs = previousSecure, previousTrusted
		common.GlobalApiRateLimitEnable, common.CriticalRateLimitEnable = previousGlobalLimit, previousCriticalLimit
		common.UserSessionActiveLimit, common.UserSessionIssuanceLimit = previousActiveLimit, previousIssuanceLimit
		common.UserSessionIssuanceWindowSeconds = previousIssuanceWindow
		gin.SetMode(previousGinMode)
		assert.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}, &model.Option{}))
	model.DB, model.LOG_DB = db, db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.SetLogDatabaseType(common.DatabaseTypeSQLite)
	common.RedisEnabled, common.SessionSecret = false, "group-rename-router-test-secret"
	common.SessionCookieSecure, common.SessionCookieTrustedURLs = true, nil
	common.GlobalApiRateLimitEnable, common.CriticalRateLimitEnable = false, false
	common.UserSessionActiveLimit = common.DefaultUserSessionActiveLimit
	common.UserSessionIssuanceLimit = common.DefaultUserSessionIssuanceLimit
	common.UserSessionIssuanceWindowSeconds = int64(common.DefaultUserSessionIssuanceWindowSeconds)
	gin.SetMode(gin.TestMode)

	bundles := make([]*service.AuthBundle, 3)
	for i, role := range []int{common.RoleCommonUser, common.RoleAdminUser, common.RoleRootUser} {
		user := model.User{
			Username: fmt.Sprintf("group-rename-route-%d", i), AffCode: fmt.Sprintf("rename-route-%d", i),
			Password: "unused-password-hash", Role: role, Status: common.UserStatusEnabled,
			Group: "default", AuthVersion: 1,
		}
		require.NoError(t, db.Create(&user).Error)
		bundles[i], err = service.CreateLoginSession(user.Id, "password", "127.0.0.1", "group-rename-router-test")
		require.NoError(t, err)
	}
	root := bundles[2]
	expiredClaims := jwt.MapClaims{}
	_, _, err = jwt.NewParser().ParseUnverified(root.AccessToken, expiredClaims)
	require.NoError(t, err)
	expiredClaims["exp"] = time.Now().Add(-time.Minute).Unix()
	expiredClaims["nbf"] = time.Now().Add(-2 * time.Minute).Unix()
	expiredClaims["iat"] = time.Now().Add(-2 * time.Minute).Unix()
	mac := hmac.New(sha256.New, []byte(common.SessionSecret))
	_, err = mac.Write([]byte("new-api/auth/access/v1"))
	require.NoError(t, err)
	expired, err := jwt.NewWithClaims(jwt.SigningMethodHS256, expiredClaims).SignedString(mac.Sum(nil))
	require.NoError(t, err)
	parts := strings.Split(root.AccessToken, ".")
	require.Len(t, parts, 3)
	replacement := "A"
	if strings.HasPrefix(parts[2], replacement) {
		replacement = "B"
	}
	parts[2] = replacement + parts[2][1:]
	tampered := strings.Join(parts, ".")

	engine := gin.New()
	SetApiRouter(engine)
	for _, test := range []struct {
		name, credential, origin, code string
		refreshCookie                  bool
		status                         int
	}{
		{name: "未登录", origin: "https://panel.example.com", code: "AUTH_UNAUTHORIZED", status: http.StatusUnauthorized},
		{name: "普通用户", credential: bundles[0].AccessToken, origin: "https://panel.example.com", code: "AUTH_INSUFFICIENT_PRIVILEGE", status: http.StatusForbidden},
		{name: "管理员", credential: bundles[1].AccessToken, origin: "https://panel.example.com", code: "AUTH_INSUFFICIENT_PRIVILEGE", status: http.StatusForbidden},
		{name: "root同源到达处理器", credential: root.AccessToken, origin: "https://panel.example.com", status: http.StatusBadRequest},
		{name: "root跨源被拒绝", credential: root.AccessToken, origin: "https://untrusted.example.com", code: "AUTH_ORIGIN_FORBIDDEN", status: http.StatusForbidden},
		{name: "root缺少来源被拒绝", credential: root.AccessToken, code: "AUTH_ORIGIN_FORBIDDEN", status: http.StatusForbidden},
		{name: "过期令牌", credential: expired, origin: "https://panel.example.com", code: "AUTH_TOKEN_EXPIRED", status: http.StatusUnauthorized},
		{name: "篡改签名", credential: tampered, origin: "https://panel.example.com", code: "AUTH_UNAUTHORIZED", status: http.StatusUnauthorized},
		{name: "刷新Cookie不能替代登录令牌", origin: "https://panel.example.com", refreshCookie: true, code: "AUTH_UNAUTHORIZED", status: http.StatusUnauthorized},
	} {
		t.Run(test.name, func(t *testing.T) {
			// 非法 JSON 保证 root 已通过真实鉴权链后停在处理器，不进入改名事务。
			request := httptest.NewRequest(http.MethodPost, "https://panel.example.com/api/option/group/rename", strings.NewReader("{"))
			request.Header.Set("Content-Type", "application/json")
			if test.credential != "" {
				request.Header.Set("Authorization", "Bearer "+test.credential)
			}
			if test.origin != "" {
				request.Header.Set("Origin", test.origin)
			}
			if test.refreshCookie {
				request.AddCookie(&http.Cookie{Name: service.RefreshCookieName, Value: root.RefreshToken})
			}
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			require.Equal(t, test.status, recorder.Code, recorder.Body.String())
			var response struct {
				Success bool   `json:"success"`
				Code    string `json:"code"`
				Message string `json:"message"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			assert.False(t, response.Success)
			if test.code != "" {
				assert.Equal(t, test.code, response.Code)
			} else {
				assert.Equal(t, "Invalid parameters", response.Message)
			}
		})
	}
}
