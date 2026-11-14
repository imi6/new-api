package controller

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUserGroupHealthPermissionsAndCachedSummary(t *testing.T) {
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
	previousRedis := common.RedisEnabled
	previousMaster, previousMemory, previousSQLite := common.IsMasterNode, common.MemoryCacheEnabled, common.SQLitePath
	previousUsable := setting.UserUsableGroups2JSONString()
	previousRatios := ratio_setting.GroupRatio2JSONString()
	special := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup
	previousSpecial := special.ReadAll()
	previousNotices := operation_setting.GetRatioChangeSetting().Enabled
	previousCacheHitRate := operation_setting.GetChannelStatusSetting().CacheHitRateEnabled
	groupHealthCacheMu.Lock()
	previousCache := userGroupHealthCache
	userGroupHealthCache = map[string]userGroupHealthCacheEntry{}
	groupHealthCacheMu.Unlock()
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousMain, previousLog)
		common.RedisEnabled = previousRedis
		common.IsMasterNode, common.MemoryCacheEnabled, common.SQLitePath = previousMaster, previousMemory, previousSQLite
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(previousUsable))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(previousRatios))
		special.Clear()
		special.AddAll(previousSpecial)
		operation_setting.GetRatioChangeSetting().Enabled = previousNotices
		operation_setting.GetChannelStatusSetting().CacheHitRateEnabled = previousCacheHitRate
		groupHealthCacheMu.Lock()
		userGroupHealthCache = previousCache
		groupHealthCacheMu.Unlock()
	})
	t.Setenv("SQL_DSN", "local")
	t.Setenv("LOG_SQL_DSN", "")
	common.IsMasterNode, common.MemoryCacheEnabled, common.RedisEnabled = false, false, false
	common.SQLitePath = filepath.Join(t.TempDir(), "group-health.db")
	require.NoError(t, model.InitDB())
	db := model.DB
	model.LOG_DB = db
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Channel{}, &model.PerfMetric{}, &model.GroupHealthProbe{}))
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default","auto":"Auto","missing-ratio":"Missing"}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"vip":2,"hidden":3,"auto":1}`))
	special.Clear()
	special.Set("vip", map[string]string{"-:default": "", "+:hidden": "Hidden"})
	operation_setting.GetRatioChangeSetting().Enabled = false
	operation_setting.GetChannelStatusSetting().CacheHitRateEnabled = false
	users := []model.User{
		{Id: 101, Username: "health-default", AffCode: "health-default", Group: "default", Status: common.UserStatusEnabled},
		{Id: 102, Username: "health-vip", AffCode: "health-vip", Group: "vip", Status: common.UserStatusEnabled},
	}
	require.NoError(t, db.Create(&users).Error)
	now := time.Now().Unix()
	hour := now - now%3600
	for _, group := range []string{"default", "vip", "hidden", "auto", "missing-ratio"} {
		require.NoError(t, db.Create(&model.Channel{
			Name: "internal-" + group, Key: "private-key-" + group,
			Group: group, Status: common.ChannelStatusEnabled, Models: "internal-model",
		}).Error)
	}
	require.NoError(t, db.Create(&model.PerfMetric{
		ModelName: "internal-model", Group: "vip", BucketTs: hour,
		RequestCount: 10, SuccessCount: 8, TtftSumMs: 6560, TtftCount: 8,
	}).Error)
	require.NoError(t, db.Create(&model.GroupHealthProbe{
		GroupName: "vip", BucketTs: hour, Samples: 2, Successes: 1, LatencySumMs: 100, LastTs: now,
	}).Error)

	ctx, response := newUserGroupHealthTestContext(102)
	GetUserGroupHealth(ctx)
	result := decodeAPIResponse(t, response)
	require.True(t, result.Success, result.Message)
	var summary userGroupHealthResponse
	require.NoError(t, common.Unmarshal(result.Data, &summary))
	require.Len(t, summary.Groups, 2)
	assert.Equal(t, "hidden", summary.Groups[0].Name)
	assert.Equal(t, "vip", summary.Groups[1].Name)
	assert.Equal(t, groupHealthStatusOK, summary.Groups[1].Status)
	assert.Equal(t, 75.0, summary.Groups[1].Total.SuccessRate)
	assert.EqualValues(t, 820, summary.Groups[1].Total.AvgLatencyMs)
	assert.Equal(t, groupHealthLatencyTTFT, summary.Groups[1].Total.LatencySource)
	assert.Len(t, summary.Groups[1].Bars, 24)
	for _, field := range []string{`"top_model"`, `"group_ratio"`, `"channel_id"`, `"request_count"`, "private-key", "internal-model"} {
		assert.NotContains(t, string(result.Data), field)
	}

	// 客户端提供其他用户组或分组参数，不能扩大服务端确定的可见范围。
	ctx, response = newUserGroupHealthTestContext(101)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/user/self/group-health?user_group=vip&group=hidden", nil)
	GetUserGroupHealth(ctx)
	result = decodeAPIResponse(t, response)
	require.True(t, result.Success, result.Message)
	require.NoError(t, common.Unmarshal(result.Data, &summary))
	require.Len(t, summary.Groups, 1)
	assert.Equal(t, "default", summary.Groups[0].Name)
	assert.Equal(t, groupHealthStatusUnknown, summary.Groups[0].Status)
	assert.False(t, summary.Groups[0].Total.HasData)

	// 可用分组发生变化时，即使缓存尚未过期也必须立刻撤销旧分组。
	special.Set("vip", map[string]string{"-:default": ""})
	ctx, response = newUserGroupHealthTestContext(102)
	GetUserGroupHealth(ctx)
	result = decodeAPIResponse(t, response)
	require.True(t, result.Success, result.Message)
	require.NoError(t, common.Unmarshal(result.Data, &summary))
	require.Len(t, summary.Groups, 1)
	assert.Equal(t, "vip", summary.Groups[0].Name)
}

func newUserGroupHealthTestContext(userID int) (*gin.Context, *httptest.ResponseRecorder) {
	response := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(response)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/user/self/group-health", nil)
	ctx.Set("id", userID)
	return ctx, response
}
