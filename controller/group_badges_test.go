package controller

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const groupBadgeTestConfig = `{"labels":[{"id":"self","name":"自营","icon":"shield","color":"teal"},{"id":"genuine","name":"保真","icon":"badge-check","color":"amber"}],"groups":{"standard":["genuine","self"],"hidden":["self"]}}`

func TestGroupBadgeConfigValidation(t *testing.T) {
	previous := common.GroupBadgeConfigJSONString()
	t.Cleanup(func() { require.NoError(t, common.UpdateGroupBadgeConfig(previous)) })
	require.NoError(t, common.UpdateGroupBadgeConfig(groupBadgeTestConfig))
	for _, raw := range []string{
		`null`, `[]`, `{}`, `{"labels":null,"groups":{}}`, `{"labels":[],"groups":null}`,
		`{"labels":[{"id":"self","name":" ","icon":"shield","color":"teal"}],"groups":{}}`,
		strings.Replace(groupBadgeTestConfig, `"name":"自营"`, `"name":" 自营"`, 1),
		strings.Replace(groupBadgeTestConfig, `"name":"自营"`, `"name":"自营 "`, 1),
		strings.Replace(groupBadgeTestConfig, `"name":"自营"`, `"name":"自营\n"`, 1),
		`{"labels":[{"id":"self","name":"1234567890123","icon":"shield","color":"teal"}],"groups":{}}`,
		`{"labels":[{"id":"self","name":"自营","icon":"<svg>","color":"teal"}],"groups":{}}`,
		`{"labels":[{"id":"self","name":"自营","icon":"shield","color":"url(evil)"}],"groups":{}}`,
		`{"labels":[{"id":"bad id","name":"自营","icon":"shield","color":"teal"}],"groups":{}}`,
		`{"labels":[],"groups":{"standard":["unknown"]}}`,
		strings.Replace(groupBadgeTestConfig, `["genuine","self"]`, `["self","self"]`, 1),
		strings.Replace(groupBadgeTestConfig, `"hidden":["self"]`, `"hidden":null`, 1),
		strings.Replace(groupBadgeTestConfig, `"hidden"`, `" "`, 1),
		strings.Replace(groupBadgeTestConfig, `"hidden"`, `"hidden\ncontrol"`, 1),
		strings.Replace(groupBadgeTestConfig, `"hidden"`, `"hidden\u0085control"`, 1),
	} {
		t.Run(raw, func(t *testing.T) {
			require.Error(t, common.UpdateGroupBadgeConfig(raw))
			assert.JSONEq(t, groupBadgeTestConfig, common.GroupBadgeConfigJSONString(), "无效设置不能替换已生效的标签")
		})
	}
	labels := common.GetGroupBadges("standard")
	require.Len(t, labels, 2)
	assert.Equal(t, []string{"genuine", "self"}, []string{labels[0].ID, labels[1].ID})
	labels[0].Name = "被篡改"
	assert.Equal(t, "保真", common.GetGroupBadges("standard")[0].Name)
	assert.Empty(t, common.GetGroupBadges("auto"), "自动分组不继承子分组的标签")
	require.NoError(t, common.UpdateGroupBadgeConfig(""))
	assert.Empty(t, common.GetGroupBadges("standard"))
	assert.JSONEq(t, `{"labels":[],"groups":{}}`, common.GroupBadgeConfigJSONString())
}

func TestGroupBadgeDatabaseContracts(t *testing.T) {
	for _, dialect := range []struct{ name, env string }{{"sqlite", ""}, {"mysql", "TEST_MYSQL_DSN"}, {"postgres", "TEST_POSTGRES_DSN"}} {
		t.Run(dialect.name, func(t *testing.T) {
			if dialect.env != "" && os.Getenv(dialect.env) == "" {
				t.Skip("dedicated test database DSN is not configured")
			}
			db, isolatedDSN := newAuditTestDatabase(t, dialect.name, os.Getenv(dialect.env))
			require.NoError(t, db.AutoMigrate(&model.Option{}))
			initialConnection, err := db.DB()
			require.NoError(t, err)
			require.NoError(t, initialConnection.Close())
			previousDB, previousLogDB := model.DB, model.LOG_DB
			previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
			previousRedis, previousMemory := common.RedisEnabled, common.MemoryCacheEnabled
			previousMaster, previousSQLite := common.IsMasterNode, common.SQLitePath
			common.IsMasterNode, common.RedisEnabled, common.MemoryCacheEnabled = false, false, false
			if dialect.name == "sqlite" {
				common.SQLitePath, isolatedDSN = isolatedDSN, "local"
			}
			t.Setenv("SQL_DSN", isolatedDSN)
			t.Setenv("LOG_SQL_DSN", "")
			require.NoError(t, model.InitDB())
			db, model.LOG_DB = model.DB, model.DB
			previousBadgeConfig := common.GroupBadgeConfigJSONString()
			previousUsable := setting.UserUsableGroups2JSONString()
			previousRatios := ratio_setting.GroupRatio2JSONString()
			previousSpecial := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.ReadAll()
			previousNotices := *operation_setting.GetRatioChangeSetting()
			common.OptionMapRWMutex.Lock()
			previousValue, existed := common.OptionMap[common.GroupBadgeConfigOption]
			if common.OptionMap == nil {
				common.OptionMap = map[string]string{}
			}
			common.OptionMapRWMutex.Unlock()
			t.Cleanup(func() {
				model.InvalidatePricingCache()
				connection, err := db.DB()
				require.NoError(t, err)
				require.NoError(t, connection.Close())
				model.DB, model.LOG_DB = previousDB, previousLogDB
				common.SetDatabaseTypes(previousMain, previousLog)
				common.RedisEnabled, common.MemoryCacheEnabled = previousRedis, previousMemory
				common.IsMasterNode, common.SQLitePath = previousMaster, previousSQLite
				require.NoError(t, common.UpdateGroupBadgeConfig(previousBadgeConfig))
				require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(previousUsable))
				require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(previousRatios))
				ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.Clear()
				ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.AddAll(previousSpecial)
				*operation_setting.GetRatioChangeSetting() = previousNotices
				common.OptionMapRWMutex.Lock()
				if existed {
					common.OptionMap[common.GroupBadgeConfigOption] = previousValue
				} else {
					delete(common.OptionMap, common.GroupBadgeConfigOption)
				}
				common.OptionMapRWMutex.Unlock()
			})
			tables := []any{&model.Option{}, &model.User{}, &model.Ability{}, &model.Channel{}, &model.Model{}, &model.Vendor{}}
			require.NoError(t, db.AutoMigrate(tables...))
			require.NoError(t, db.AutoMigrate(tables...))
			t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(tables...)) })
			var version string
			query := "SELECT version()"
			if dialect.name == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("%s database version: %s", dialect.name, version)
			require.NoError(t, common.UpdateGroupBadgeConfig(""))
			assert.Empty(t, common.GetGroupBadges("standard"))
			require.NoError(t, model.UpdateOption(common.GroupBadgeConfigOption, groupBadgeTestConfig))
			var stored model.Option
			require.NoError(t, db.Where(&model.Option{Key: common.GroupBadgeConfigOption}).First(&stored).Error)
			assert.JSONEq(t, groupBadgeTestConfig, stored.Value)
			require.NoError(t, db.AutoMigrate(&model.Option{}))
			require.NoError(t, common.UpdateGroupBadgeConfig(""))
			require.NoError(t, common.UpdateGroupBadgeConfig(stored.Value))
			assert.Equal(t, "genuine", common.GetGroupBadges("standard")[0].ID)
			require.Error(t, model.UpdateOption(common.GroupBadgeConfigOption, `null`))
			require.NoError(t, db.Where(&model.Option{Key: common.GroupBadgeConfigOption}).First(&stored).Error)
			assert.JSONEq(t, groupBadgeTestConfig, stored.Value)

			require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"standard":1,"hidden":2}`))
			require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"standard":"普通组","auto":"自动"}`))
			ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.Clear()
			operation_setting.GetRatioChangeSetting().Enabled = false
			user := model.User{Username: "badge-user", AffCode: "badge-user", Group: "default", Status: common.UserStatusEnabled}
			require.NoError(t, db.Create(&user).Error)
			response := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(response)
			ctx.Request = httptest.NewRequest(http.MethodGet, "/api/user/self/groups", nil)
			ctx.Set("id", user.Id)
			GetUserGroups(ctx)
			var groups struct {
				Success bool `json:"success"`
				Data    map[string]struct {
					Badges []common.GroupLabel `json:"badges"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &groups))
			require.True(t, groups.Success)
			assert.NotContains(t, groups.Data, "hidden")
			require.Len(t, groups.Data["standard"].Badges, 2)
			assert.Equal(t, "genuine", groups.Data["standard"].Badges[0].ID)
			assert.Empty(t, groups.Data["auto"].Badges)

			model.InvalidatePricingCache()
			response = httptest.NewRecorder()
			ctx, _ = gin.CreateTestContext(response)
			ctx.Request = httptest.NewRequest(http.MethodGet, "/api/pricing", nil)
			ctx.Set("id", user.Id)
			GetPricing(ctx)
			var pricing struct {
				Success bool                           `json:"success"`
				Badges  map[string][]common.GroupLabel `json:"group_badges"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &pricing))
			require.True(t, pricing.Success)
			assert.NotContains(t, pricing.Badges, "hidden")
			assert.Equal(t, groups.Data["standard"].Badges, pricing.Badges["standard"])

			require.NoError(t, db.Migrator().DropTable(&model.Option{}))
			require.Error(t, model.UpdateOption(common.GroupBadgeConfigOption, `{"labels":[],"groups":{}}`))
			assert.JSONEq(t, groupBadgeTestConfig, common.GroupBadgeConfigJSONString(), "写库失败不能发布新的标签配置")
		})
	}
}
