package model

import (
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// A supplier submits one site at a time with the groups it can provide and
// the ratio it offers each at. Nothing here holds an upstream key or makes
// the server reach the supplier's address; the site address is text. A
// submission cannot be changed afterwards. An administrator can remove it,
// whole or one group at a time.

const (
	PartnerStatusPending   = "pending"
	PartnerStatusContacted = "contacted"
	PartnerStatusConnected = "connected"
	PartnerStatusRejected  = "rejected"
)

// PartnerStatuses lists the administrator's marks in display order.
var PartnerStatuses = []string{PartnerStatusPending, PartnerStatusContacted, PartnerStatusConnected, PartnerStatusRejected}

// PartnerSite is one submitted site. The administrator's mark and note are
// never returned to the submitter.
type PartnerSite struct {
	Id          int    `json:"id"`
	UserId      int    `json:"user_id" gorm:"index"`
	SiteName    string `json:"site_name" gorm:"type:varchar(128)"`
	SiteUrl     string `json:"site_url" gorm:"type:varchar(512)"`
	ContactType string `json:"contact_type" gorm:"type:varchar(16)"`
	Contact     string `json:"contact" gorm:"type:varchar(128)"`
	Remark      string `json:"remark" gorm:"type:varchar(2048)"`
	SubmitIp    string `json:"submit_ip" gorm:"type:varchar(64);index"`
	AdminStatus string `json:"admin_status" gorm:"type:varchar(16);index"`
	AdminNote   string `json:"admin_note" gorm:"type:varchar(2048)"`
	CreatedAt   int64  `json:"created_at" gorm:"index"`
}

// PartnerOffer is one group a site offers.
type PartnerOffer struct {
	Id          int     `json:"id"`
	SiteId      int     `json:"site_id" gorm:"index"`
	GroupName   string  `json:"group_name" gorm:"type:varchar(128)"`
	ChannelType int     `json:"channel_type" gorm:"index"`
	Ratio       float64 `json:"ratio"`
	Models      string  `json:"models" gorm:"type:text"`
	Description string  `json:"description" gorm:"type:varchar(1024)"`
}

// CreatePartnerSite stores a site and its offers. A signed-in user may hold
// at most maxSites; the user's row is locked so concurrent submissions
// cannot pass the limit together.
func CreatePartnerSite(site *PartnerSite, offers []PartnerOffer, maxSites int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if site.UserId > 0 {
			var user User
			if err := lockForUpdate(tx).Select("id").First(&user, site.UserId).Error; err != nil {
				return err
			}
			var count int64
			if err := tx.Model(&PartnerSite{}).Where("user_id = ?", site.UserId).Count(&count).Error; err != nil {
				return err
			}
			if count >= int64(maxSites) {
				return common.NewMessage("You can submit at most {{max}} sites", map[string]any{"max": maxSites})
			}
		}
		if err := tx.Create(site).Error; err != nil {
			return err
		}
		for i := range offers {
			offers[i].Id = 0
			offers[i].SiteId = site.Id
		}
		return tx.Create(&offers).Error
	})
}

// CountGuestPartnerSitesSince counts the visitor submissions from an IP since
// a time, for the hourly limit.
func CountGuestPartnerSitesSince(ip string, sinceTs int64) (int64, error) {
	var count int64
	err := DB.Model(&PartnerSite{}).
		Where("user_id = 0 AND submit_ip = ? AND created_at >= ?", ip, sinceTs).
		Count(&count).Error
	return count, err
}

// PartnerSiteView is a site with its offers, as its submitter sees it.
type PartnerSiteView struct {
	Id          int            `json:"id"`
	SiteName    string         `json:"site_name"`
	SiteUrl     string         `json:"site_url"`
	ContactType string         `json:"contact_type"`
	Contact     string         `json:"contact"`
	Remark      string         `json:"remark"`
	CreatedAt   int64          `json:"created_at"`
	Offers      []PartnerOffer `json:"offers"`
}

// partnerMineLimit caps the submissions listed back to one user.
const partnerMineLimit = 100

// GetUserPartnerSites lists a user's own submissions, newest first.
func GetUserPartnerSites(userID int) ([]PartnerSiteView, error) {
	var sites []PartnerSite
	if err := DB.Where("user_id = ?", userID).Order("id DESC").Limit(partnerMineLimit).Find(&sites).Error; err != nil {
		return nil, err
	}
	views := make([]PartnerSiteView, 0, len(sites))
	if len(sites) == 0 {
		return views, nil
	}
	ids := make([]int, 0, len(sites))
	for _, site := range sites {
		ids = append(ids, site.Id)
	}
	var offers []PartnerOffer
	if err := DB.Where("site_id IN ?", ids).Order("id ASC").Find(&offers).Error; err != nil {
		return nil, err
	}
	bySite := map[int][]PartnerOffer{}
	for _, offer := range offers {
		bySite[offer.SiteId] = append(bySite[offer.SiteId], offer)
	}
	for _, site := range sites {
		siteOffers := bySite[site.Id]
		if siteOffers == nil {
			siteOffers = []PartnerOffer{}
		}
		views = append(views, PartnerSiteView{
			Id:          site.Id,
			SiteName:    site.SiteName,
			SiteUrl:     site.SiteUrl,
			ContactType: site.ContactType,
			Contact:     site.Contact,
			Remark:      site.Remark,
			CreatedAt:   site.CreatedAt,
			Offers:      siteOffers,
		})
	}
	return views, nil
}

// PartnerOfferRow is one offer in the administrator's table, with its site.
type PartnerOfferRow struct {
	OfferId     int     `json:"offer_id" gorm:"column:offer_id"`
	GroupName   string  `json:"group_name" gorm:"column:group_name"`
	ChannelType int     `json:"channel_type" gorm:"column:channel_type"`
	Ratio       float64 `json:"ratio" gorm:"column:ratio"`
	Models      string  `json:"models" gorm:"column:models"`
	Description string  `json:"description" gorm:"column:description"`
	SiteId      int     `json:"site_id" gorm:"column:site_id"`
	SiteName    string  `json:"site_name" gorm:"column:site_name"`
	SiteUrl     string  `json:"site_url" gorm:"column:site_url"`
	ContactType string  `json:"contact_type" gorm:"column:contact_type"`
	Contact     string  `json:"contact" gorm:"column:contact"`
	Remark      string  `json:"remark" gorm:"column:remark"`
	SubmitIp    string  `json:"submit_ip" gorm:"column:submit_ip"`
	AdminStatus string  `json:"admin_status" gorm:"column:admin_status"`
	AdminNote   string  `json:"admin_note" gorm:"column:admin_note"`
	CreatedAt   int64   `json:"created_at" gorm:"column:created_at"`
	UserId      int     `json:"user_id" gorm:"column:user_id"`
	// Username is empty for a visitor or a deleted user (a LEFT JOIN).
	Username *string `json:"username" gorm:"column:username"`
}

// PartnerOfferFilter narrows the administrator's table.
type PartnerOfferFilter struct {
	ChannelType int
	Status      string
	Keyword     string
	// SortDesc sorts by ratio from high to low; the default is low to high.
	SortDesc bool
}

func partnerOfferQuery(filter PartnerOfferFilter) *gorm.DB {
	query := DB.Table("partner_offers AS o").
		Joins("JOIN partner_sites AS s ON s.id = o.site_id").
		Joins("LEFT JOIN users AS u ON u.id = s.user_id")
	if filter.ChannelType > 0 {
		query = query.Where("o.channel_type = ?", filter.ChannelType)
	}
	if filter.Status != "" {
		query = query.Where("s.admin_status = ?", filter.Status)
	}
	if keyword := strings.TrimSpace(filter.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("(s.site_name LIKE ? OR o.group_name LIKE ? OR o.models LIKE ? OR s.contact LIKE ?)", like, like, like, like)
	}
	return query
}

// GetPartnerOffers returns one page of the administrator's table and its
// total, sorted by ratio.
func GetPartnerOffers(filter PartnerOfferFilter, pageInfo *common.PageInfo) ([]PartnerOfferRow, int64, error) {
	var total int64
	if err := partnerOfferQuery(filter).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	direction := "ASC"
	if filter.SortDesc {
		direction = "DESC"
	}
	rows := make([]PartnerOfferRow, 0, pageInfo.GetPageSize())
	err := partnerOfferQuery(filter).
		Select("o.id AS offer_id, o.group_name, o.channel_type, o.ratio, o.models, o.description, " +
			"s.id AS site_id, s.site_name, s.site_url, s.contact_type, s.contact, s.remark, s.submit_ip, " +
			"s.admin_status, s.admin_note, s.created_at, s.user_id, u.username").
		Order("o.ratio " + direction + ", o.id ASC").
		Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).
		Scan(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// UpdatePartnerSiteMark sets the administrator's mark and note of a site.
func UpdatePartnerSiteMark(siteID int, status string, note string) error {
	result := DB.Model(&PartnerSite{}).Where("id = ?", siteID).
		Updates(map[string]any{"admin_status": status, "admin_note": note})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected > 0 {
		return nil
	}
	// MySQL counts only changed rows, so saving the same mark again affects
	// none; look the site up before calling it missing.
	var count int64
	if err := DB.Model(&PartnerSite{}).Where("id = ?", siteID).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return common.NewMessage("The submission does not exist")
	}
	return nil
}

// ClearPartnerSubmitIpsBefore empties the submit IP of the sites submitted
// before a time, so an IP is kept only as long as it helps against spam.
func ClearPartnerSubmitIpsBefore(beforeTs int64) (int64, error) {
	result := DB.Model(&PartnerSite{}).
		Where("created_at < ? AND submit_ip <> ?", beforeTs, "").
		Update("submit_ip", "")
	return result.RowsAffected, result.Error
}

// DeletePartnerOffer removes one group of a site. A site left without a group
// is removed with it: the administrator's table lists a site by its groups,
// so such a site would never be shown again and would still count toward its
// submitter's limit.
func DeletePartnerOffer(offerID int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		missing := common.NewMessage("The quote does not exist")
		var offer PartnerOffer
		if err := tx.Select("id", "site_id").First(&offer, offerID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return missing
			}
			return err
		}
		// Lock the site, so two deletions of its last two groups cannot each
		// count the other's group and leave the site behind.
		var site PartnerSite
		if err := lockForUpdate(tx).Select("id").First(&site, offer.SiteId).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return missing
			}
			return err
		}
		result := tx.Where("id = ?", offerID).Delete(&PartnerOffer{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return missing
		}
		var remaining int64
		if err := tx.Model(&PartnerOffer{}).Where("site_id = ?", site.Id).Count(&remaining).Error; err != nil {
			return err
		}
		if remaining > 0 {
			return nil
		}
		return tx.Where("id = ?", site.Id).Delete(&PartnerSite{}).Error
	})
}

// DeletePartnerSite removes a site and its offers.
func DeletePartnerSite(siteID int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("site_id = ?", siteID).Delete(&PartnerOffer{}).Error; err != nil {
			return err
		}
		result := tx.Where("id = ?", siteID).Delete(&PartnerSite{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return common.NewMessage("The submission does not exist")
		}
		return nil
	})
}
