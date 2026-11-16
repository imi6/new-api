package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetTelegramBotTrialConfig(c *gin.Context) {
	config, err := model.GetTelegramBotTrialConfig()
	if err != nil {
		telegramBotError(c, err)
		return
	}
	common.ApiSuccess(c, config)
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
		Enabled: input.Enabled, Quota: input.Quota, DailyLimit: input.DailyLimit, TotalLimit: input.TotalLimit,
		RequireMembership: input.RequireMembership, ChatID: input.ChatID, JoinURL: input.JoinURL, Version: input.Version,
	})
	if err != nil {
		telegramBotError(c, err)
		return
	}
	succeeded = true
	common.ApiSuccess(c, config)
}
