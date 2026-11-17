package service

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
)

// telegramTrialMembership 不信任“点过链接”；开启门槛时核验群类型、机器人的管理权限和用户身份。
func telegramTrialMembership(cfg *model.TelegramBotConfig, trial *model.TelegramBotTrialConfig, telegramID string) (model.TelegramTrialMembershipProof, error) {
	proof := model.TelegramTrialMembershipProof{ConfigVersion: trial.Version}
	if !trial.RequireMembership {
		return proof, nil
	}
	userID, err := strconv.ParseInt(telegramID, 10, 64)
	if err != nil || userID <= 0 {
		return proof, model.ErrTelegramTrialMembershipRequired
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var chat struct {
		Type string `json:"type"`
	}
	if err := TelegramBotCall(ctx, cfg, "getChat", map[string]any{"chat_id": trial.ChatID}, &chat); err != nil {
		return proof, err
	}
	if chat.Type != "group" && chat.Type != "supergroup" && chat.Type != "channel" {
		return proof, model.ErrTelegramTrialMembershipRequired
	}
	var bot struct {
		Status string `json:"status"`
	}
	if err := TelegramBotCall(ctx, cfg, "getChatMember", map[string]any{"chat_id": trial.ChatID, "user_id": cfg.BotID}, &bot); err != nil {
		return proof, err
	}
	if bot.Status != "creator" && bot.Status != "administrator" {
		return proof, common.NewMessage("Telegram bot must be an administrator of the trial group or channel")
	}
	var member struct {
		Status   string `json:"status"`
		IsMember bool   `json:"is_member"`
	}
	if err := TelegramBotCall(ctx, cfg, "getChatMember", map[string]any{"chat_id": trial.ChatID, "user_id": userID}, &member); err != nil {
		return proof, err
	}
	switch member.Status {
	case "creator", "administrator", "member":
		proof.Confirmed = true
	case "restricted":
		proof.Confirmed = member.IsMember
	}
	proof.CheckedAt = time.Now().Unix()
	if !proof.Confirmed {
		return proof, model.ErrTelegramTrialMembershipRequired
	}
	return proof, nil
}

func processTelegramTrial(cfg *model.TelegramBotConfig, row *model.TelegramBotInbox, user *model.User) (string, error) {
	lang := i18n.LangZhCN
	if row.Argument != "" {
		return i18n.Translate(lang, "telegram.bot.trial_usage"), nil
	}
	trial, err := model.GetTelegramBotTrialConfig()
	if err != nil {
		return "", err
	}
	if !trial.Enabled || trial.MinUserID <= 0 || trial.Quota <= 0 {
		return i18n.Translate(lang, "telegram.bot.trial_unavailable"), nil
	}
	if user.Id < trial.MinUserID {
		return telegramTrialFailure(model.ErrTelegramTrialUserIDRequired)
	}
	membership, err := telegramTrialMembership(cfg, trial, row.TelegramID)
	if err != nil {
		if errors.Is(err, model.ErrTelegramTrialMembershipRequired) {
			return i18n.Translate(lang, "telegram.bot.trial_join_required", map[string]any{"URL": trial.JoinURL}), nil
		}
		return i18n.Translate(lang, "telegram.bot.trial_membership_unavailable"), nil
	}
	identity := model.TelegramTrialIdentity{UserID: user.Id, BotID: cfg.BotID, BotConfigVersion: cfg.Version, TelegramID: row.TelegramID, ConnectionVersion: row.ConnectionVersion}
	claim, newlyGranted, err := model.GrantTelegramTrial(identity, row.ID, trial.Version, membership)
	if err != nil {
		return telegramTrialFailure(err)
	}
	if newlyGranted {
		model.RecordLog(user.Id, model.LogTypeSystem, common.NewMessage("Telegram trial credit received: {{quota}}", map[string]any{"quota": logger.FormatQuota(claim.Quota)}))
	}
	return i18n.Translate(lang, "telegram.bot.trial_success", map[string]any{"Amount": logger.FormatQuota(claim.Quota)}), nil
}

func telegramTrialFailure(err error) (string, error) {
	key := ""
	switch {
	case errors.Is(err, model.ErrTelegramTrialUnavailable):
		key = "telegram.bot.trial_unavailable"
	case errors.Is(err, model.ErrTelegramTrialAlreadyClaimed):
		key = "telegram.bot.trial_already_claimed"
	case errors.Is(err, model.ErrTelegramTrialUserIDRequired):
		key = "telegram.bot.trial_user_id_required"
	case errors.Is(err, model.ErrTelegramTrialEmailRequired):
		return i18n.Translate(i18n.LangZhCN, "telegram.bot.trial_email_required", map[string]any{"URL": strings.TrimRight(system_setting.ServerAddress, "/") + "/security"}), nil
	case errors.Is(err, model.ErrTelegramTrialBudgetExceeded):
		key = "telegram.bot.trial_budget_exceeded"
	case errors.Is(err, model.ErrWalletQuotaLimitExceeded):
		key = "telegram.bot.trial_wallet_limit"
	case errors.Is(err, model.ErrTelegramTrialChanged), errors.Is(err, model.ErrTelegramBotChanged):
		key = "telegram.bot.trial_changed"
	case errors.Is(err, model.ErrTelegramBotNotConnected):
		key = "telegram.bot.trial_connection_changed"
	case errors.Is(err, model.ErrTelegramTrialMembershipRequired):
		key = "telegram.bot.trial_membership_unavailable"
	default:
		return "", err
	}
	return i18n.Translate(i18n.LangZhCN, key), nil
}
