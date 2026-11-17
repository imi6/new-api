package controller

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// GetTelegramBotTrialStatus 返回登录账号的试用提示，不接受其他用户的身份参数。
func GetTelegramBotTrialStatus(c *gin.Context) {
	status, err := model.GetTelegramTrialStatus(c.GetInt("id"))
	if err != nil {
		telegramBotError(c, err)
		return
	}
	common.ApiSuccess(c, status)
}

func GetTelegramBotTrialConfig(c *gin.Context) {
	config, err := model.GetTelegramBotTrialConfig()
	if err != nil {
		telegramBotError(c, err)
		return
	}
	config.CurrentMaxUserID, err = model.GetTelegramTrialCurrentMaxUserID()
	if err != nil {
		telegramBotError(c, err)
		return
	}
	common.ApiSuccess(c, config)
}

func ListTelegramBotTrialClaims(c *gin.Context) {
	page := common.GetPageQuery(c)
	for _, name := range []string{"p", "page_size"} {
		if value, supplied := c.GetQuery(name); supplied {
			number, err := strconv.Atoi(value)
			if err != nil || number <= 0 || name == "p" && number > 1_000_000 || name == "page_size" && number > 100 {
				common.ApiErrorT(c, "Invalid parameters")
				return
			}
		}
	}
	filter := model.TelegramTrialClaimFilter{Keyword: strings.TrimSpace(c.Query("keyword"))}
	for _, bound := range []struct {
		name  string
		value *int64
	}{{"start_time", &filter.StartTime}, {"end_time", &filter.EndTime}} {
		if value, supplied := c.GetQuery(bound.name); supplied {
			timestamp, err := strconv.ParseInt(value, 10, 64)
			if err != nil || timestamp < 0 {
				common.ApiErrorT(c, "Invalid parameters")
				return
			}
			*bound.value = timestamp
		}
	}
	items, total, err := model.ListTelegramTrialClaims(filter, page)
	if err != nil {
		telegramBotError(c, err)
		return
	}
	page.SetItems(items)
	page.SetTotal(int(total))
	common.ApiSuccess(c, page)
}

func SaveTelegramBotTrialConfig(c *gin.Context) {
	if _, ok := requireBrowserSession(c); !ok {
		return
	}
	succeeded := false
	defer func() {
		recordUserSecurityAudit(c, c.GetInt("id"), "telegram_bot.config_update", map[string]any{"success": succeeded, "section": "trial"})
	}()
	var input struct {
		Enabled           bool   `json:"enabled"`
		MinUserID         int    `json:"min_user_id"`
		Quota             int    `json:"quota"`
		DailyLimit        int    `json:"daily_limit"`
		TotalLimit        int    `json:"total_limit"`
		RequireMembership bool   `json:"require_membership"`
		ChatID            string `json:"chat_id"`
		JoinURL           string `json:"join_url"`
		Version           int64  `json:"version"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		common.ApiErrorT(c, "Invalid request")
		return
	}
	config, err := model.SaveTelegramBotTrialConfig(model.TelegramBotTrialConfig{
		Enabled: input.Enabled, MinUserID: input.MinUserID, Quota: input.Quota, DailyLimit: input.DailyLimit, TotalLimit: input.TotalLimit,
		RequireMembership: input.RequireMembership, ChatID: input.ChatID, JoinURL: input.JoinURL, Version: input.Version,
	})
	if err != nil {
		telegramBotError(c, err)
		return
	}
	succeeded = true
	config.CurrentMaxUserID, err = model.GetTelegramTrialCurrentMaxUserID()
	if err != nil {
		telegramBotError(c, err)
		return
	}
	common.ApiSuccess(c, config)
}
