package controller

import (
	"errors"
	"math"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

// The supplier application page: a site submits the groups it can provide
// and the ratio of each, and the administrator compares them in one table.
// The request structs below hold only the form fields, so a submitter can
// never set the owner, IP, time or the administrator's mark.

const (
	partnerMaxSiteName    = 64
	partnerMaxSiteUrl     = 256
	partnerMaxContact     = 64
	partnerMaxRemark      = 1000
	partnerMaxGroupName   = 64
	partnerMaxDescription = 500
	partnerMaxModels      = 100
	partnerMaxModelName   = 128
	partnerMaxAdminNote   = 1000
	partnerMaxRatio       = 1000
)

var partnerContactTypes = []string{"wechat", "telegram", "qq", "email", "other"}

type partnerOfferRequest struct {
	GroupName   string   `json:"group_name"`
	ChannelType int      `json:"channel_type"`
	Ratio       float64  `json:"ratio"`
	Models      []string `json:"models"`
	Description string   `json:"description"`
}

type partnerSiteRequest struct {
	SiteName    string                `json:"site_name"`
	SiteUrl     string                `json:"site_url"`
	ContactType string                `json:"contact_type"`
	Contact     string                `json:"contact"`
	Remark      string                `json:"remark"`
	Offers      []partnerOfferRequest `json:"offers"`
}

// boundedText trims a field and checks it is within limit characters.
func boundedText(value string, limit int, required bool) (string, bool) {
	value = strings.TrimSpace(value)
	if required && value == "" {
		return "", false
	}
	return value, utf8.RuneCountInString(value) <= limit
}

// partnerSiteURL accepts an empty address or an http(s) address with a host
// and no credentials, so a stored address can never run script when an
// administrator opens it.
func partnerSiteURL(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", true
	}
	if utf8.RuneCountInString(raw) > partnerMaxSiteUrl {
		return "", false
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Hostname() == "" || parsed.User != nil {
		return "", false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", false
	}
	// Normalizing escapes characters such as Chinese, so check the length of
	// what is stored, not of what was typed.
	normalized := parsed.String()
	if utf8.RuneCountInString(normalized) > partnerMaxSiteUrl {
		return "", false
	}
	return normalized, true
}

// respondStoreError sends a refusal from the model as it is, and logs any
// other error and answers with fallbackKey, so a database error never
// reaches the client.
func respondStoreError(c *gin.Context, err error, action string, fallbackKey string) {
	var message *common.Message
	if errors.As(err, &message) {
		common.ApiError(c, err)
		return
	}
	common.SysError(common.LogText("failed to %s: %s", action, err.Error()))
	common.ApiErrorT(c, fallbackKey)
}

// validatePartnerSite turns a request into the rows to store, or the reason
// it is refused.
func validatePartnerSite(req partnerSiteRequest) (*model.PartnerSite, []model.PartnerOffer, error) {
	site := &model.PartnerSite{}
	var ok bool
	if site.SiteName, ok = boundedText(req.SiteName, partnerMaxSiteName, true); !ok {
		return nil, nil, common.NewMessage("Enter a site name of at most {{max}} characters", map[string]any{"max": partnerMaxSiteName})
	}
	if site.SiteUrl, ok = partnerSiteURL(req.SiteUrl); !ok {
		return nil, nil, common.NewMessage("The site address must start with http:// or https://")
	}
	if !slices.Contains(partnerContactTypes, req.ContactType) {
		return nil, nil, common.NewMessage("Choose a contact type")
	}
	site.ContactType = req.ContactType
	if site.Contact, ok = boundedText(req.Contact, partnerMaxContact, true); !ok {
		return nil, nil, common.NewMessage("Enter a contact of at most {{max}} characters", map[string]any{"max": partnerMaxContact})
	}
	if site.Remark, ok = boundedText(req.Remark, partnerMaxRemark, false); !ok {
		return nil, nil, common.NewMessage("The text can have at most {{max}} characters", map[string]any{"max": partnerMaxRemark})
	}

	maxOffers := operation_setting.PartnerMaxOffers()
	if len(req.Offers) == 0 || len(req.Offers) > maxOffers {
		return nil, nil, common.NewMessage("Add 1 to {{max}} groups", map[string]any{"max": maxOffers})
	}
	offers := make([]model.PartnerOffer, 0, len(req.Offers))
	for _, item := range req.Offers {
		offer := model.PartnerOffer{}
		if offer.GroupName, ok = boundedText(item.GroupName, partnerMaxGroupName, true); !ok {
			return nil, nil, common.NewMessage("Enter a group name of at most {{max}} characters", map[string]any{"max": partnerMaxGroupName})
		}
		if _, known := constant.ChannelTypeNames[item.ChannelType]; !known || item.ChannelType <= 0 {
			return nil, nil, common.NewMessage("Choose a platform for every group")
		}
		offer.ChannelType = item.ChannelType
		if math.IsNaN(item.Ratio) || math.IsInf(item.Ratio, 0) || item.Ratio <= 0 || item.Ratio > partnerMaxRatio {
			return nil, nil, common.NewMessage("The ratio must be greater than 0 and at most {{max}}", map[string]any{"max": partnerMaxRatio})
		}
		offer.Ratio = item.Ratio
		if len(item.Models) > partnerMaxModels {
			return nil, nil, common.NewMessage("A group can list at most {{max}} models", map[string]any{"max": partnerMaxModels})
		}
		models := make([]string, 0, len(item.Models))
		for _, name := range item.Models {
			name = strings.TrimSpace(name)
			if name == "" || slices.Contains(models, name) {
				continue
			}
			if utf8.RuneCountInString(name) > partnerMaxModelName || strings.Contains(name, ",") {
				return nil, nil, common.NewMessage("A model name can have at most {{max}} characters and no comma", map[string]any{"max": partnerMaxModelName})
			}
			models = append(models, name)
		}
		offer.Models = strings.Join(models, ",")
		if offer.Description, ok = boundedText(item.Description, partnerMaxDescription, false); !ok {
			return nil, nil, common.NewMessage("The text can have at most {{max}} characters", map[string]any{"max": partnerMaxDescription})
		}
		offers = append(offers, offer)
	}
	return site, offers, nil
}

// GetPartnerConfig serves what the application page needs before a submit.
// Access follows the "partner" top navigation switch.
func GetPartnerConfig(c *gin.Context) {
	setting := operation_setting.GetPartnerSetting()
	common.ApiSuccess(c, gin.H{
		"max_offers_per_site": operation_setting.PartnerMaxOffers(),
		"intro":               setting.Intro,
		"contact_types":       partnerContactTypes,
	})
}

// SubmitPartnerSite stores one submission. A visitor who is not signed in is
// limited per IP and hour; a signed-in user is limited in sites. Neither can
// change a submission afterwards.
func SubmitPartnerSite(c *gin.Context) {
	var req partnerSiteRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	site, offers, err := validatePartnerSite(req)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	now := common.GetTimestamp()
	site.UserId = c.GetInt("id")
	site.SubmitIp = c.ClientIP()
	site.AdminStatus = model.PartnerStatusPending
	site.CreatedAt = now
	if site.UserId == 0 {
		limit := operation_setting.PartnerGuestHourlyLimit()
		count, err := model.CountGuestPartnerSitesSince(site.SubmitIp, now-3600)
		if err != nil {
			respondStoreError(c, err, "count supplier submissions", "Failed to submit, please try again later")
			return
		}
		if count >= int64(limit) {
			common.ApiErrorT(c, "Too many submissions, please try again later")
			return
		}
	}
	if err := model.CreatePartnerSite(site, offers, operation_setting.PartnerMaxSites()); err != nil {
		respondStoreError(c, err, "store supplier submission", "Failed to submit, please try again later")
		return
	}
	common.ApiSuccess(c, gin.H{"id": site.Id})
}

// GetMyPartnerSites lists the signed-in user's own submissions, read only.
func GetMyPartnerSites(c *gin.Context) {
	sites, err := model.GetUserPartnerSites(c.GetInt("id"))
	if err != nil {
		respondStoreError(c, err, "list supplier submissions", "Failed to load submissions, please try again later")
		return
	}
	common.ApiSuccess(c, sites)
}

// AdminGetPartnerOffers serves one page of every offer, sorted by ratio.
func AdminGetPartnerOffers(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	channelType, _ := strconv.Atoi(c.Query("channel_type"))
	status := c.Query("status")
	if status != "" && !slices.Contains(model.PartnerStatuses, status) {
		status = ""
	}
	rows, total, err := model.GetPartnerOffers(model.PartnerOfferFilter{
		ChannelType: channelType,
		Status:      status,
		Keyword:     c.Query("keyword"),
		SortDesc:    c.Query("sort_order") == "desc",
	}, pageInfo)
	if err != nil {
		respondStoreError(c, err, "list supplier quotes", "Failed to load quotes, please try again later")
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(rows)
	common.ApiSuccess(c, pageInfo)
}

type partnerMarkRequest struct {
	AdminStatus string `json:"admin_status"`
	AdminNote   string `json:"admin_note"`
}

// AdminUpdatePartnerSite sets the administrator's mark and note of a site.
func AdminUpdatePartnerSite(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	var req partnerMarkRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || !slices.Contains(model.PartnerStatuses, req.AdminStatus) {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	note, ok := boundedText(req.AdminNote, partnerMaxAdminNote, false)
	if !ok {
		common.ApiError(c, common.NewMessage("The text can have at most {{max}} characters", map[string]any{"max": partnerMaxAdminNote}))
		return
	}
	if err := model.UpdatePartnerSiteMark(id, req.AdminStatus, note); err != nil {
		respondStoreError(c, err, "mark supplier submission", "Failed to save")
		return
	}
	common.ApiSuccess(c, nil)
}

// AdminDeletePartnerSite removes a submission and its offers.
func AdminDeletePartnerSite(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := model.DeletePartnerSite(id); err != nil {
		respondStoreError(c, err, "delete supplier submission", "Failed to delete submission")
		return
	}
	common.ApiSuccess(c, nil)
}
