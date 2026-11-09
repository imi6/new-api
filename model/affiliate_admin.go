package model

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"gorm.io/gorm"
)

// The admin view of referral rewards: who invited how many users, what the
// invitees' paid consumption earned them, and what they claimed. It only
// reads. Deleted users are left out, as in the user list.

// AffiliateInviterRow is one inviter in the ranking.
type AffiliateInviterRow struct {
	UserID       int    `json:"user_id" gorm:"column:user_id"`
	Username     string `json:"username" gorm:"column:username"`
	DisplayName  string `json:"display_name" gorm:"column:display_name"`
	Group        string `json:"group" gorm:"column:group_name"`
	InviteeCount int64  `json:"invitee_count" gorm:"column:invitee_count"`
	// SignupReward is the inviter's share of the signup bonus (aff_history).
	SignupReward int64 `json:"signup_reward" gorm:"column:signup_reward"`
	InviteePaid  int64 `json:"invitee_paid" gorm:"column:invitee_paid"`
	Accrued      int64 `json:"accrued" gorm:"column:accrued"`
	Claimed      int64 `json:"claimed" gorm:"column:claimed"`
	Unclaimed    int64 `json:"unclaimed" gorm:"-"`
	LastClaimAt  int64 `json:"last_claim_at" gorm:"column:last_claim_at"`
	// SpecialRatio marks an inviter whose group has a special ratio rule.
	SpecialRatio bool `json:"special_ratio" gorm:"-"`
}

// affiliateInviterSorts maps a sort key to its column expression; only these
// reach the query.
var affiliateInviterSorts = map[string]string{
	"accrued":   "COALESCE(a.accrued, 0)",
	"invitees":  "COALESCE(inv.invitee_count, 0)",
	"claimed":   "COALESCE(a.claimed, 0)",
	"unclaimed": "COALESCE(a.accrued, 0) - COALESCE(a.claimed, 0)",
	"paid":      "COALESCE(inv.invitee_paid, 0)",
	"signup":    "u.aff_history",
}

// affiliateKeywordFilter matches a user id, or a username or display name.
func affiliateKeywordFilter(query *gorm.DB, alias string, keyword string) *gorm.DB {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return query
	}
	like := "%" + keyword + "%"
	condition := alias + ".username LIKE ? OR " + alias + ".display_name LIKE ?"
	if id, err := strconv.Atoi(keyword); err == nil {
		return query.Where("("+alias+".id = ? OR "+condition+")", id, like, like)
	}
	return query.Where("("+condition+")", like, like)
}

// affiliateInviterQuery selects every user who invited someone, earned a
// signup reward, or claimed rebate, joined with their invitees' totals.
func affiliateInviterQuery(keyword string) *gorm.DB {
	invitees := DB.Model(&User{}).
		Select("inviter_id, COUNT(*) AS invitee_count, COALESCE(SUM(paid_quota_consumed), 0) AS invitee_paid").
		Where("inviter_id > 0").
		Group("inviter_id")
	claims := DB.Model(&AffiliateRebateClaim{}).
		Select("user_id, MAX(created_at) AS last_claim_at").
		Group("user_id")
	query := DB.Table("users AS u").
		Joins("LEFT JOIN affiliate_accounts AS a ON a.user_id = u.id").
		Joins("LEFT JOIN (?) AS inv ON inv.inviter_id = u.id", invitees).
		Joins("LEFT JOIN (?) AS cl ON cl.user_id = u.id", claims).
		Where("u.deleted_at IS NULL").
		Where("(COALESCE(inv.invitee_count, 0) > 0 OR COALESCE(a.accrued, 0) > 0 OR COALESCE(a.claimed, 0) > 0 OR u.aff_history > 0)")
	return affiliateKeywordFilter(query, "u", keyword)
}

// GetAffiliateInviters returns one page of the ranking and its total.
func GetAffiliateInviters(keyword string, sortBy string, sortOrder string, pageInfo *common.PageInfo) ([]AffiliateInviterRow, int64, error) {
	var total int64
	if err := affiliateInviterQuery(keyword).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	sort, ok := affiliateInviterSorts[sortBy]
	if !ok {
		sort = affiliateInviterSorts["accrued"]
	}
	direction := "DESC"
	if sortOrder == "asc" {
		direction = "ASC"
	}
	rows := make([]AffiliateInviterRow, 0, pageInfo.GetPageSize())
	err := affiliateInviterQuery(keyword).
		Select("u.id AS user_id, u.username, u.display_name, u.aff_history AS signup_reward, COALESCE(a.claimed, 0) AS claimed, u." + commonGroupCol + " AS group_name, " +
			"COALESCE(inv.invitee_count, 0) AS invitee_count, COALESCE(a.accrued, 0) AS accrued, COALESCE(inv.invitee_paid, 0) AS invitee_paid, COALESCE(cl.last_claim_at, 0) AS last_claim_at").
		Order(sort + " " + direction + ", u.id DESC").
		Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).
		Scan(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	for i := range rows {
		rows[i].Unclaimed = max(rows[i].Accrued-rows[i].Claimed, 0)
		rows[i].SpecialRatio = ratio_setting.HasGroupSpecialRatio(rows[i].Group)
	}
	return rows, total, nil
}

// AffiliateAdminSummary sums the ranking over every inviter.
type AffiliateAdminSummary struct {
	Inviters           int64 `json:"inviters"`
	Invitees           int64 `json:"invitees"`
	SignupReward       int64 `json:"signup_reward"`
	Accrued            int64 `json:"accrued"`
	Claimed            int64 `json:"claimed"`
	Unclaimed          int64 `json:"unclaimed"`
	UserPlatformQuota  int64 `json:"user_platform_quota"`
	AdminPlatformQuota int64 `json:"admin_platform_quota"`
	UExchangeQuota     int64 `json:"u_exchange_quota"`
	AdminRevokedQuota  int64 `json:"admin_revoked_quota"`
	// Claimers is how many users have claimed rebate at least once.
	Claimers int64 `json:"claimers"`
	// ExcludeSpecialRatio tells whether inviters with a special ratio earn
	// no rebate now.
	ExcludeSpecialRatio bool `json:"exclude_special_ratio"`
}

// GetAffiliateAdminSummary returns the totals of the ranking. The inviters'
// rows are summed here rather than in SQL: a sum of the per-inviter sums is a
// decimal on PostgreSQL, and one row per inviter is small.
func GetAffiliateAdminSummary() (*AffiliateAdminSummary, error) {
	var rows []AffiliateInviterRow
	err := affiliateInviterQuery("").
		Select("u.aff_history AS signup_reward, COALESCE(a.claimed, 0) AS claimed, " +
			"COALESCE(inv.invitee_count, 0) AS invitee_count, COALESCE(a.accrued, 0) AS accrued").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	summary := &AffiliateAdminSummary{Inviters: int64(len(rows))}
	for _, row := range rows {
		summary.Invitees += row.InviteeCount
		summary.SignupReward += row.SignupReward
	}
	// 资金总额包含已删除账户的历史，不能由当前用户资料筛选决定。
	// 单独接收资金聚合，避免 Scan 重置已汇总的邀请人数和注册奖励。
	var accountTotals struct {
		Accrued   int64
		Claimed   int64
		Unclaimed int64
	}
	if err := DB.Model(&AffiliateAccount{}).Select("COALESCE(SUM(accrued), 0) AS accrued, COALESCE(SUM(claimed), 0) AS claimed, COALESCE(SUM(CASE WHEN accrued > claimed THEN accrued - claimed ELSE 0 END), 0) AS unclaimed").Scan(&accountTotals).Error; err != nil {
		return nil, err
	}
	summary.Accrued = accountTotals.Accrued
	summary.Claimed = accountTotals.Claimed
	summary.Unclaimed = accountTotals.Unclaimed
	var claimTotals []struct {
		Destination string
		Quota       int64
	}
	if err := DB.Model(&AffiliateRebateClaim{}).Select("destination, COALESCE(SUM(quota), 0) AS quota").Group("destination").Scan(&claimTotals).Error; err != nil {
		return nil, err
	}
	for _, total := range claimTotals {
		if total.Destination == "u" {
			summary.UExchangeQuota += total.Quota
		} else {
			summary.UserPlatformQuota += total.Quota
		}
	}
	var adjustmentTotals []struct {
		Kind  string
		Quota int64
	}
	if err := DB.Model(&AffiliateLedgerEntry{}).Where("kind IN ?", []string{"admin_grant", "admin_revoke"}).Select("kind, -COALESCE(SUM(quota), 0) AS quota").Group("kind").Scan(&adjustmentTotals).Error; err != nil {
		return nil, err
	}
	for _, total := range adjustmentTotals {
		if total.Kind == "admin_grant" {
			summary.AdminPlatformQuota = total.Quota
		} else {
			summary.AdminRevokedQuota = total.Quota
		}
	}
	if err := DB.Model(&AffiliateRebateClaim{}).
		Select("COUNT(DISTINCT user_id)").Scan(&summary.Claimers).Error; err != nil {
		return nil, err
	}
	summary.ExcludeSpecialRatio = common.AffiliateRebateExcludeSpecialRatioEnabled
	return summary, nil
}

// AffiliateAdminInvitee is one user an inviter invited.
type AffiliateAdminInvitee struct {
	UserID       int    `json:"user_id"`
	Username     string `json:"username"`
	DisplayName  string `json:"display_name"`
	Group        string `json:"group"`
	PaidConsumed int    `json:"paid_consumed"`
	Rebate       int    `json:"rebate"`
	CreatedAt    int64  `json:"created_at"`
}

// AffiliateAdminClaim is one rebate claim.
type AffiliateAdminClaim struct {
	ID          int    `json:"id" gorm:"column:id"`
	UserID      int    `json:"user_id" gorm:"column:user_id"`
	Username    string `json:"username" gorm:"column:username"`
	DisplayName string `json:"display_name" gorm:"column:display_name"`
	Quota       int    `json:"quota" gorm:"column:quota"`
	Destination string `json:"destination" gorm:"column:destination"`
	CreatedAt   int64  `json:"created_at" gorm:"column:created_at"`
}

// affiliateAdminDetailLimit caps the invitees and claims of one inviter's
// detail; the largest rebate and the latest claims come first.
const affiliateAdminDetailLimit = 500

// AffiliateAdminDetail is one inviter's invitees and claims.
type AffiliateAdminDetail struct {
	InviteeTotal int64                   `json:"invitee_total"`
	Invitees     []AffiliateAdminInvitee `json:"invitees"`
	ClaimTotal   int64                   `json:"claim_total"`
	Claims       []AffiliateAdminClaim   `json:"claims"`
	Limit        int                     `json:"limit"`
}

// GetAffiliateAdminDetail returns an inviter's invitees and claims.
func GetAffiliateAdminDetail(inviterID int) (*AffiliateAdminDetail, error) {
	detail := &AffiliateAdminDetail{Limit: affiliateAdminDetailLimit}
	if err := DB.Model(&User{}).Where("inviter_id = ?", inviterID).Count(&detail.InviteeTotal).Error; err != nil {
		return nil, err
	}
	var invitees []User
	if err := DB.Select("id, username, display_name, "+commonGroupCol+", paid_quota_consumed, affiliate_rebate_earned, created_at").
		Where("inviter_id = ?", inviterID).
		Order("affiliate_rebate_earned DESC, id DESC").
		Limit(affiliateAdminDetailLimit).Find(&invitees).Error; err != nil {
		return nil, err
	}
	detail.Invitees = make([]AffiliateAdminInvitee, 0, len(invitees))
	for _, invitee := range invitees {
		detail.Invitees = append(detail.Invitees, AffiliateAdminInvitee{
			UserID:       invitee.Id,
			Username:     invitee.Username,
			DisplayName:  invitee.DisplayName,
			Group:        invitee.Group,
			PaidConsumed: invitee.PaidQuotaConsumed,
			Rebate:       invitee.AffiliateRebateEarned,
			CreatedAt:    invitee.CreatedAt,
		})
	}
	if err := DB.Model(&AffiliateRebateClaim{}).Where("user_id = ?", inviterID).Count(&detail.ClaimTotal).Error; err != nil {
		return nil, err
	}
	detail.Claims = make([]AffiliateAdminClaim, 0)
	if err := DB.Model(&AffiliateRebateClaim{}).
		Select("id, user_id, quota, destination, created_at").
		Where("user_id = ?", inviterID).
		Order("created_at DESC, id DESC").
		Limit(affiliateAdminDetailLimit).Scan(&detail.Claims).Error; err != nil {
		return nil, err
	}
	return detail, nil
}

// affiliateClaimQuery selects the claims in [startTs, endTs] of the users the
// keyword matches; a zero bound is open.
func affiliateClaimQuery(keyword string, startTs int64, endTs int64) *gorm.DB {
	query := DB.Table("affiliate_rebate_claims AS c").
		Joins("LEFT JOIN users AS u ON u.id = c.user_id")
	if startTs > 0 {
		query = query.Where("c.created_at >= ?", startTs)
	}
	if endTs > 0 {
		query = query.Where("c.created_at <= ?", endTs)
	}
	return affiliateKeywordFilter(query, "u", keyword)
}

// GetAffiliateClaims returns one page of claims, newest first, with how many
// there are and their sum.
func GetAffiliateClaims(keyword string, startTs int64, endTs int64, pageInfo *common.PageInfo) ([]AffiliateAdminClaim, int64, int64, error) {
	var totals struct {
		Count int64 `gorm:"column:claim_count"`
		Sum   int64 `gorm:"column:claim_sum"`
	}
	if err := affiliateClaimQuery(keyword, startTs, endTs).
		Select("COUNT(*) AS claim_count, COALESCE(SUM(c.quota), 0) AS claim_sum").
		Scan(&totals).Error; err != nil {
		return nil, 0, 0, err
	}
	claims := make([]AffiliateAdminClaim, 0, pageInfo.GetPageSize())
	err := affiliateClaimQuery(keyword, startTs, endTs).
		Select("c.id, c.user_id, c.quota, c.destination, c.created_at, u.username, u.display_name").
		Order("c.created_at DESC, c.id DESC").
		Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).
		Scan(&claims).Error
	if err != nil {
		return nil, 0, 0, err
	}
	return claims, totals.Count, totals.Sum, nil
}
