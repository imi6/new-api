package router

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func setupKeyUsageTestDB(t *testing.T, dialect common.DatabaseType) {
	t.Helper()
	var dialector gorm.Dialector
	versionQuery := "SELECT version()"
	switch dialect {
	case common.DatabaseTypeSQLite:
		dialector = sqlite.Open(t.TempDir() + "/key-usage.db")
		versionQuery = "SELECT sqlite_version()"
	case common.DatabaseTypeMySQL:
		dsn := os.Getenv("KEY_USAGE_TEST_MYSQL_DSN")
		if dsn == "" {
			t.Skip("database test DSN not configured")
		}
		dialector = mysql.Open(dsn)
	case common.DatabaseTypePostgreSQL:
		dsn := os.Getenv("KEY_USAGE_TEST_POSTGRES_DSN")
		if dsn == "" {
			t.Skip("database test DSN not configured")
		}
		dialector = postgres.Open(dsn)
	default:
		t.Fatalf("unsupported test database: %s", dialect)
	}
	db, err := gorm.Open(dialector, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })

	var version string
	require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
	t.Logf("database version: %s", version)
	logDB := db
	tables := []any{&model.User{}, &model.Token{}, &model.UserSession{}, &model.UserAccessToken{}, &model.Option{}}
	if dialect == common.DatabaseTypeSQLite {
		logDB, err = gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "key-usage-logs.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
		require.NoError(t, err)
		sqlLogDB, err := logDB.DB()
		require.NoError(t, err)
		t.Cleanup(func() { require.NoError(t, sqlLogDB.Close()) })
		require.NoError(t, logDB.AutoMigrate(&model.Log{}, &model.AuditLog{}))
	} else {
		tables = append(tables, &model.Log{}, &model.AuditLog{})
	}
	for _, table := range tables {
		require.False(t, db.Migrator().HasTable(table), "key usage tests require a dedicated database")
	}
	t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(tables...)) })
	require.NoError(t, db.AutoMigrate(tables...))

	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
	previousRedis, previousSecret := common.RedisEnabled, common.SessionSecret
	previousGlobalLimit, previousCriticalLimit := common.GlobalApiRateLimitEnable, common.CriticalRateLimitEnable
	setting := operation_setting.GetLogSetting()
	previousSetting := *setting
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousMain, previousLog)
		common.RedisEnabled, common.SessionSecret = previousRedis, previousSecret
		common.GlobalApiRateLimitEnable, common.CriticalRateLimitEnable = previousGlobalLimit, previousCriticalLimit
		*setting = previousSetting
	})
	model.DB, model.LOG_DB = db, logDB
	common.SetDatabaseTypes(dialect, dialect)
	common.RedisEnabled, common.SessionSecret = false, "key-usage-test-secret"
	common.GlobalApiRateLimitEnable, common.CriticalRateLimitEnable = false, false
	setting.UserExportEnabled, setting.PublicKeyUsageEnabled, setting.MaxRangeDays = true, false, 30
}

type keyUsageTestPayload struct {
	Success bool `json:"success"`
	Data    struct {
		Enabled       bool             `json:"enabled"`
		ExportEnabled bool             `json:"export_enabled"`
		MaxRangeDays  int              `json:"max_range_days"`
		Items         []map[string]any `json:"items"`
		Token         map[string]any   `json:"token"`
		Total         int              `json:"total"`
		Page          int              `json:"p"`
		PageSize      int              `json:"page_size"`
	} `json:"data"`
}

var keyUsageTestClientSequence atomic.Uint64

func keyUsageTestRequest(engine *gin.Engine, path, authorization, origin, address string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodGet, "https://panel.example.test"+path, nil)
	if authorization != "" {
		request.Header.Set("Authorization", authorization)
	}
	if origin != "" {
		request.Header.Set("Origin", origin)
	}
	if address == "" {
		// 每个独立请求使用不同的 IPv6 /64 测试网段。
		sequence := keyUsageTestClientSequence.Add(1)
		address = fmt.Sprintf("[2001:db8:%x:%x::1]:1234", sequence>>16, sequence&0xffff)
	}
	request.RemoteAddr = address
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)
	return response
}

func requireKeyUsageResponse(t *testing.T, response *httptest.ResponseRecorder) keyUsageTestPayload {
	t.Helper()
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	assert.Contains(t, response.Header().Get("Cache-Control"), "no-store")
	var payload keyUsageTestPayload
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
	require.True(t, payload.Success, response.Body.String())
	return payload
}

func TestKeyUsageRoutes(t *testing.T) {
	require.NoError(t, i18n.Init())
	gin.SetMode(gin.TestMode)
	for _, dialect := range []common.DatabaseType{common.DatabaseTypeSQLite, common.DatabaseTypeMySQL, common.DatabaseTypePostgreSQL} {
		t.Run(string(dialect), func(t *testing.T) {
			setupKeyUsageTestDB(t, dialect)
			const publicPath = "/api/key-usage/"
			key := fmt.Sprintf("KeyUsageExample%d", keyUsageTestClientSequence.Add(1))
			keyAuth := "Bearer sk-" + key
			const sensitive = "private-field-fixture"
			now := common.GetTimestamp()
			db := model.DB
			user := model.User{Id: int(keyUsageTestClientSequence.Add(1)) + 1000, Username: "key-usage-owner", AffCode: "keyuown", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1, Quota: 3000}
			otherUser := model.User{Username: "key-usage-other", AffCode: "keyuoth", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1}
			require.NoError(t, db.Create(&user).Error)
			require.NoError(t, db.Create(&otherUser).Error)
			primary := model.Token{Id: int(keyUsageTestClientSequence.Add(1)) + 1000, UserId: user.Id, Key: key, Name: sensitive, Status: common.TokenStatusEnabled, RemainQuota: 650, UsedQuota: 350, AllowUserQuotaQuery: true}
			other := model.Token{UserId: otherUser.Id, Key: "OtherKeyUsageExampleOnly", Name: sensitive, Status: common.TokenStatusEnabled}
			peer := model.Token{UserId: user.Id, Key: "PeerKeyUsageExampleOnly", Name: sensitive, Status: common.TokenStatusEnabled}
			require.NoError(t, db.Create(&primary).Error)
			require.NoError(t, db.Create(&other).Error)
			require.NoError(t, db.Create(&peer).Error)
			require.NoError(t, model.LOG_DB.Create(&[]model.Log{
				{UserId: user.Id, TokenId: primary.Id, Type: model.LogTypeConsume, CreatedAt: now - 60, ModelName: "model-a", Quota: 25, PromptTokens: 10, CompletionTokens: 5, Username: sensitive, TokenName: sensitive, Content: sensitive, Other: sensitive, Ip: "192.0.2.10", ChannelId: 32, UpstreamRequestId: sensitive},
				{UserId: user.Id, TokenId: primary.Id, Type: model.LogTypeRefund, CreatedAt: now - 120, ModelName: "model-b", Quota: 12},
				{UserId: user.Id, TokenId: primary.Id, Type: model.LogTypeError, CreatedAt: now - 20, ModelName: "exclude-error"},
				{UserId: user.Id, TokenId: primary.Id, Type: model.LogTypeConsume, CreatedAt: now - 10*86400, ModelName: "exclude-date"},
				{UserId: user.Id, TokenId: peer.Id, Type: model.LogTypeConsume, CreatedAt: now - 10, ModelName: "exclude-peer"},
				{UserId: otherUser.Id, TokenId: other.Id, Type: model.LogTypeConsume, CreatedAt: now - 9, ModelName: "exclude-other"},
				{UserId: otherUser.Id, TokenId: primary.Id, Type: model.LogTypeConsume, CreatedAt: now - 8, ModelName: "exclude-mismatched-owner"},
			}).Error)
			engine := gin.New()
			require.NoError(t, engine.SetTrustedProxies(nil))
			SetApiRouter(engine)
			SetRelayRouter(engine)
			ownerPath := fmt.Sprintf("/api/token/%d/usage", primary.Id)
			bundle, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "key-usage-test")
			require.NoError(t, err)
			ownerAuth := "Bearer " + bundle.AccessToken
			setting := operation_setting.GetLogSetting()

			t.Run("公开开关关闭时登录查询仍可用", func(t *testing.T) {
				payload := requireKeyUsageResponse(t, keyUsageTestRequest(engine, publicPath+"settings", "", "", ""))
				assert.False(t, payload.Data.Enabled)
				assert.Equal(t, 30, payload.Data.MaxRangeDays)
				for _, path := range []string{publicPath, publicPath + "export"} {
					assert.Equal(t, http.StatusNotFound, keyUsageTestRequest(engine, path, keyAuth, "", "").Code)
				}
				payload = requireKeyUsageResponse(t, keyUsageTestRequest(engine, ownerPath, ownerAuth, "", ""))
				assert.Equal(t, 2, payload.Data.Total)
			})
			setting.PublicKeyUsageEnabled = true

			t.Run("公开列表及导出限定当前密钥且隐藏私密字段", func(t *testing.T) {
				payload := requireKeyUsageResponse(t, keyUsageTestRequest(engine, publicPath+"settings", "", "", ""))
				assert.True(t, payload.Data.Enabled)
				assert.True(t, payload.Data.ExportEnabled)
				response := keyUsageTestRequest(engine, publicPath+"?p=1&page_size=1", keyAuth, "https://panel.example.test", "")
				payload = requireKeyUsageResponse(t, response)
				assert.Empty(t, response.Header().Get("Access-Control-Allow-Origin"))
				assert.NotContains(t, response.Body.String(), sensitive)
				assert.NotContains(t, response.Body.String(), key)
				assert.NotContains(t, response.Body.String(), "user_quota")
				assert.NotContains(t, response.Body.String(), "192.0.2.10")
				assert.Equal(t, 2, payload.Data.Total)
				assert.Equal(t, 1, payload.Data.Page)
				assert.Equal(t, 1, payload.Data.PageSize)
				assert.EqualValues(t, 350, payload.Data.Token["total_used"])
				assert.EqualValues(t, 650, payload.Data.Token["total_available"])
				assert.EqualValues(t, 1000, payload.Data.Token["total_granted"])
				assert.EqualValues(t, 0, payload.Data.Token["expires_at"])
				require.Len(t, payload.Data.Items, 1)
				assert.Equal(t, map[string]any{"created_at": float64(now - 60), "model_name": "model-a", "prompt_tokens": float64(10), "completion_tokens": float64(5), "quota": float64(25), "type": float64(model.LogTypeConsume)}, payload.Data.Items[0])
				payload = requireKeyUsageResponse(t, keyUsageTestRequest(engine, publicPath+"?p=2&page_size=1", keyAuth, "", ""))
				require.Len(t, payload.Data.Items, 1)
				assert.Equal(t, "model-b", payload.Data.Items[0]["model_name"])
				assert.EqualValues(t, model.LogTypeRefund, payload.Data.Items[0]["type"])
				assert.EqualValues(t, 12, payload.Data.Items[0]["quota"])
				payload = requireKeyUsageResponse(t, keyUsageTestRequest(engine, publicPath+"export?model_name=model-b", keyAuth, "", ""))
				require.Len(t, payload.Data.Items, 1)
				assert.Equal(t, "model-b", payload.Data.Items[0]["model_name"])
				assert.Len(t, payload.Data.Items[0], 6)
			})

			t.Run("身份与查询限制每次均校验", func(t *testing.T) {
				for _, path := range []string{publicPath, publicPath + "export", publicPath + "settings"} {
					request := httptest.NewRequest(http.MethodOptions, "https://panel.example.test"+path, nil)
					request.Header.Set("Origin", "https://other.example.test")
					request.Header.Set("Access-Control-Request-Method", http.MethodGet)
					request.Header.Set("Access-Control-Request-Headers", "Authorization")
					response := httptest.NewRecorder()
					engine.ServeHTTP(response, request)
					assert.Equal(t, http.StatusMethodNotAllowed, response.Code)
					assert.Empty(t, response.Header().Get("Access-Control-Allow-Origin"))
				}
				for _, tc := range []struct {
					name, path, auth, origin string
					status                   int
				}{
					{"公开查询需要凭据", publicPath, "", "", http.StatusUnauthorized},
					{"拒绝密钥大小写变体", publicPath, "Bearer sk-" + strings.ToLower(key), "", http.StatusUnauthorized},
					{"拒绝附加文本的密钥", publicPath, keyAuth + "-extra", "", http.StatusUnauthorized},
					{"拒绝跨站请求", publicPath, keyAuth, "https://other.example.test", http.StatusForbidden},
					{"拒绝超长时间范围", fmt.Sprintf("%s?start_timestamp=%d&end_timestamp=%d", publicPath, now-31*86400, now), keyAuth, "", http.StatusBadRequest},
					{"登录接口拒绝访客", ownerPath, "", "", http.StatusUnauthorized},
					{"登录接口拒绝别人的密钥", fmt.Sprintf("/api/token/%d/usage/export", other.Id), ownerAuth, "", http.StatusNotFound},
				} {
					t.Run(tc.name, func(t *testing.T) {
						response := keyUsageTestRequest(engine, tc.path, tc.auth, tc.origin, "")
						assert.Equal(t, tc.status, response.Code, response.Body.String())
						assert.NotContains(t, response.Body.String(), key)
					})
				}
			})

			t.Run("个人访问令牌需要用量权限", func(t *testing.T) {
				for _, tc := range []struct {
					scope, fixture string
					status         int
				}{
					{"api_key:read", "K", http.StatusForbidden},
					{"usage:read", "U", http.StatusOK},
				} {
					raw := model.AccessTokenPrefix + strings.Repeat(tc.fixture, 43)
					token := model.UserAccessToken{Name: tc.scope, TokenHash: model.AccessTokenFingerprint(raw), TokenHint: model.AccessTokenHint(raw)}
					require.NoError(t, token.SetScopes([]string{tc.scope}))
					require.NoError(t, model.CreateUserAccessToken(user.Id, &token, service.AccessTokenMaxPerUser))
					for _, path := range []string{ownerPath, ownerPath + "/export"} {
						response := keyUsageTestRequest(engine, path, "Bearer "+raw, "", "")
						assert.Equal(t, tc.status, response.Code, response.Body.String())
						if tc.status == http.StatusOK {
							payload := requireKeyUsageResponse(t, response)
							assert.Len(t, payload.Data.Items, 2)
						}
					}
					var audit []model.AuditLog
					require.NoError(t, model.LOG_DB.Where("user_id = ? AND category = ? AND status = ?", user.Id, model.AuditCategoryAccessToken, tc.status).Find(&audit).Error)
					require.Len(t, audit, 2)
					encoded, err := common.Marshal(audit)
					require.NoError(t, err)
					assert.NotContains(t, string(encoded), raw)
				}
			})

			t.Run("过期和耗尽可查而禁用与白名单立即生效", func(t *testing.T) {
				for _, status := range []int{common.TokenStatusExpired, common.TokenStatusExhausted} {
					require.NoError(t, db.Model(&primary).Update("status", status).Error)
					payload := requireKeyUsageResponse(t, keyUsageTestRequest(engine, publicPath, keyAuth, "", ""))
					assert.EqualValues(t, status, payload.Data.Token["status"])
				}
				require.NoError(t, db.Model(&primary).Update("status", common.TokenStatusDisabled).Error)
				assert.Equal(t, http.StatusUnauthorized, keyUsageTestRequest(engine, publicPath, keyAuth, "", "").Code)
				require.NoError(t, db.Model(&primary).Updates(map[string]any{"status": common.TokenStatusEnabled, "allow_ips": "192.0.2.10"}).Error)
				assert.Equal(t, http.StatusUnauthorized, keyUsageTestRequest(engine, publicPath+"export", keyAuth, "", "192.0.2.11:1234").Code)
				requireKeyUsageResponse(t, keyUsageTestRequest(engine, publicPath, keyAuth, "", "192.0.2.10:1234"))
				require.NoError(t, db.Model(&primary).Update("allow_ips", "").Error)
				require.NoError(t, db.Model(&user).Update("status", common.UserStatusDisabled).Error)
				assert.Equal(t, http.StatusUnauthorized, keyUsageTestRequest(engine, publicPath, keyAuth, "", "").Code)
				require.NoError(t, db.Model(&user).Update("status", common.UserStatusEnabled).Error)
				require.NoError(t, db.Delete(&peer).Error)
				assert.Equal(t, http.StatusUnauthorized, keyUsageTestRequest(engine, publicPath, "Bearer sk-"+peer.Key, "", "").Code)
			})

			t.Run("导出开关及数量上限由后端执行", func(t *testing.T) {
				setting.UserExportEnabled = false
				assert.False(t, requireKeyUsageResponse(t, keyUsageTestRequest(engine, publicPath, keyAuth, "", "")).Data.ExportEnabled)
				assert.Equal(t, http.StatusForbidden, keyUsageTestRequest(engine, publicPath+"export", keyAuth, "", "").Code)
				assert.Equal(t, http.StatusForbidden, keyUsageTestRequest(engine, ownerPath+"/export", ownerAuth, "", "").Code)
				setting.UserExportEnabled = true
				logs := make([]model.Log, 1001)
				for i := range logs {
					logs[i] = model.Log{UserId: user.Id, TokenId: primary.Id, Type: model.LogTypeConsume, CreatedAt: now - 1, ModelName: "bulk-model"}
				}
				require.NoError(t, model.LOG_DB.CreateInBatches(logs, 100).Error)
				response := keyUsageTestRequest(engine, publicPath+"export?model_name=bulk-model", keyAuth, "", "")
				require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
				assert.NotContains(t, response.Body.String(), "items")
			})

			revoked, err := model.RevokeUserSession(user.Id, bundle.Session.SID, "key-usage-test")
			require.NoError(t, err)
			require.True(t, revoked)
			assert.Equal(t, http.StatusUnauthorized, keyUsageTestRequest(engine, ownerPath, ownerAuth, "", "").Code)
		})
	}
}

func TestKeyUsageRateLimits(t *testing.T) {
	require.NoError(t, i18n.Init())
	gin.SetMode(gin.TestMode)
	setupKeyUsageTestDB(t, common.DatabaseTypeSQLite)
	operation_setting.GetLogSetting().PublicKeyUsageEnabled = true
	engine := gin.New()
	require.NoError(t, engine.SetTrustedProxies(nil))
	SetApiRouter(engine)
	SetRelayRouter(engine)
	const publicPath = "/api/key-usage/"

	newKey := func(t *testing.T, userID int) model.Token {
		t.Helper()
		sequence := keyUsageTestClientSequence.Add(1)
		token := model.Token{Id: int(sequence) + 1000, UserId: userID, Key: fmt.Sprintf("KeyUsageRateLimitFixture%d", sequence), Status: common.TokenStatusEnabled, RemainQuota: 100}
		require.NoError(t, model.DB.Create(&token).Error)
		return token
	}
	newUser := func(t *testing.T) model.User {
		t.Helper()
		sequence := keyUsageTestClientSequence.Add(1)
		user := model.User{Id: int(sequence) + 1000, Username: fmt.Sprintf("usage-rate-test-%d", sequence), AffCode: fmt.Sprintf("r%x", sequence), Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1}
		require.NoError(t, model.DB.Create(&user).Error)
		return user
	}
	assertLimited := func(t *testing.T, response *httptest.ResponseRecorder, maxRetrySeconds int) {
		t.Helper()
		require.Equal(t, http.StatusTooManyRequests, response.Code, response.Body.String())
		retrySeconds, err := strconv.Atoi(response.Header().Get("Retry-After"))
		require.NoError(t, err)
		assert.Positive(t, retrySeconds)
		assert.LessOrEqual(t, retrySeconds, maxRetrySeconds)
	}

	t.Run("同一 IPv6 网段共享失败次数且公开设置仍可读", func(t *testing.T) {
		user := newUser(t)
		token := newKey(t, user.Id)
		auth := "Bearer sk-" + token.Key
		network := keyUsageTestClientSequence.Add(1)
		for i := range 5 {
			path := publicPath
			if i%2 != 0 {
				path += "export"
			}
			address := fmt.Sprintf("[2001:db8:ffff:%x::%x]:1234", network, i+1)
			response := keyUsageTestRequest(engine, path, "Bearer sk-WrongUsageRateLimitFixture", "", address)
			require.Equal(t, http.StatusUnauthorized, response.Code, response.Body.String())
		}
		address := fmt.Sprintf("[2001:db8:ffff:%x::6]:1234", network)
		assertLimited(t, keyUsageTestRequest(engine, publicPath, auth, "", address), 600)
		requireKeyUsageResponse(t, keyUsageTestRequest(engine, publicPath+"settings", "", "", address))
		requireKeyUsageResponse(t, keyUsageTestRequest(engine, publicPath, auth, "", ""))
	})

	t.Run("同一 IPv4 地址共享查询预算", func(t *testing.T) {
		user := newUser(t)
		token := newKey(t, user.Id)
		auth := "Bearer sk-" + token.Key
		sequence := keyUsageTestClientSequence.Add(1)
		address := fmt.Sprintf("198.18.%d.%d:1234", (sequence>>8)&255, sequence&255)
		for range 12 {
			requireKeyUsageResponse(t, keyUsageTestRequest(engine, publicPath, auth, "", address))
		}
		assertLimited(t, keyUsageTestRequest(engine, publicPath, auth, "", address), 60)
		requireKeyUsageResponse(t, keyUsageTestRequest(engine, publicPath, auth, "", ""))
	})

	t.Run("公开密钥跨地址共享查询和导出预算", func(t *testing.T) {
		user := newUser(t)
		token := newKey(t, user.Id)
		auth := "Bearer sk-" + token.Key
		for range 20 {
			requireKeyUsageResponse(t, keyUsageTestRequest(engine, publicPath, auth, "", ""))
		}
		assertLimited(t, keyUsageTestRequest(engine, publicPath, auth, "", ""), 60)

		exportToken := newKey(t, user.Id)
		exportAuth := "Bearer sk-" + exportToken.Key
		for range 3 {
			requireKeyUsageResponse(t, keyUsageTestRequest(engine, publicPath+"export", exportAuth, "", ""))
		}
		assertLimited(t, keyUsageTestRequest(engine, publicPath+"export", exportAuth, "", ""), 60)
		requireKeyUsageResponse(t, keyUsageTestRequest(engine, publicPath, exportAuth, "", ""))
	})

	t.Run("登录账号跨密钥共享查询和导出预算", func(t *testing.T) {
		user := newUser(t)
		first := newKey(t, user.Id)
		second := newKey(t, user.Id)
		bundle, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "key-usage-rate-limit-test")
		require.NoError(t, err)
		auth := "Bearer " + bundle.AccessToken
		firstPath := fmt.Sprintf("/api/token/%d/usage", first.Id)
		secondPath := fmt.Sprintf("/api/token/%d/usage", second.Id)
		for range 5 {
			requireKeyUsageResponse(t, keyUsageTestRequest(engine, firstPath+"/export", auth, "", ""))
		}
		assertLimited(t, keyUsageTestRequest(engine, secondPath+"/export", auth, "", ""), 60)
		for range 54 {
			requireKeyUsageResponse(t, keyUsageTestRequest(engine, firstPath, auth, "", ""))
		}
		assertLimited(t, keyUsageTestRequest(engine, firstPath, auth, "", ""), 60)
		assertLimited(t, keyUsageTestRequest(engine, secondPath, auth, "", ""), 60)
	})
}
