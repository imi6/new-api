package controller

import (
	"slices"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

// Announcements that pop up or show in the notification bell. Everyone gets
// the same ones; a signed-in user's reads stop them popping up again.

const (
	announcementMaxTitle   = 200
	announcementMaxContent = 10000
	// announcementMaxTime keeps a start or end time a real date.
	announcementMaxTime = 253402300799 // 9999-12-31 23:59:59 UTC
)

type announcementView struct {
	Id         int    `json:"id"`
	Title      string `json:"title"`
	Content    string `json:"content"`
	NotifyMode string `json:"notify_mode"`
	ShownAt    int64  `json:"shown_at"`
	// Read is only true for a signed-in user who read it; a visitor's reads
	// are kept in the browser.
	Read bool `json:"read"`
}

// GetPublicAnnouncements serves the announcements live now, with the
// signed-in user's reads and whether visitors get the popups too.
func GetPublicAnnouncements(c *gin.Context) {
	active := model.ActiveAnnouncements()
	userId := c.GetInt("id")
	ids := make([]int, 0, len(active))
	for _, item := range active {
		ids = append(ids, item.Id)
	}
	read, err := model.ReadAnnouncementIds(userId, ids)
	if err != nil {
		respondStoreError(c, err, "read announcement reads", "Failed to load announcements, please try again later")
		return
	}
	views := make([]announcementView, 0, len(active))
	for _, item := range active {
		views = append(views, announcementView{
			Id:         item.Id,
			Title:      item.Title,
			Content:    item.Content,
			NotifyMode: item.NotifyMode,
			ShownAt:    item.ShownAt(),
			Read:       read[item.Id],
		})
	}
	common.ApiSuccess(c, gin.H{
		"items":       views,
		"guest_popup": operation_setting.GetAnnouncementSetting().GuestPopup,
	})
}

type announcementReadRequest struct {
	Ids []int `json:"ids"`
}

// MarkMyAnnouncementsRead records the signed-in user's reads, also the ones
// made in this browser before signing in. Ids that are not live are skipped.
func MarkMyAnnouncementsRead(c *gin.Context) {
	var req announcementReadRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || len(req.Ids) == 0 || len(req.Ids) > model.AnnouncementPublicLimit {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	live, err := model.LiveAnnouncementIds(req.Ids)
	if err != nil {
		respondStoreError(c, err, "check live announcements", "Failed to save")
		return
	}
	if err := model.MarkAnnouncementsRead(c.GetInt("id"), live); err != nil {
		respondStoreError(c, err, "mark announcements read", "Failed to save")
		return
	}
	common.ApiSuccess(c, nil)
}

// announcementRequest holds only what an administrator fills in; the
// author, times and first publish time are set by the server.
type announcementRequest struct {
	Title      string `json:"title"`
	Content    string `json:"content"`
	Status     string `json:"status"`
	NotifyMode string `json:"notify_mode"`
	StartsAt   int64  `json:"starts_at"`
	EndsAt     int64  `json:"ends_at"`
}

// validateAnnouncement checks a request and copies it onto item.
func validateAnnouncement(req announcementRequest, item *model.Announcement) error {
	var ok bool
	if item.Title, ok = boundedText(req.Title, announcementMaxTitle, true); !ok {
		return common.NewMessage("Enter a title of at most {{max}} characters", map[string]any{"max": announcementMaxTitle})
	}
	if item.Content, ok = boundedText(req.Content, announcementMaxContent, true); !ok {
		return common.NewMessage("Enter content of at most {{max}} characters", map[string]any{"max": announcementMaxContent})
	}
	if !slices.Contains(model.AnnouncementStatuses, req.Status) || !slices.Contains(model.AnnouncementNotifyModes, req.NotifyMode) {
		return common.NewMessage("Invalid parameters")
	}
	if req.StartsAt < 0 || req.EndsAt < 0 || req.StartsAt > announcementMaxTime || req.EndsAt > announcementMaxTime {
		return common.NewMessage("Invalid parameters")
	}
	if req.StartsAt > 0 && req.EndsAt > 0 && req.EndsAt <= req.StartsAt {
		return common.NewMessage("The end time must be after the start time")
	}
	item.Status = req.Status
	item.NotifyMode = req.NotifyMode
	item.StartsAt = req.StartsAt
	item.EndsAt = req.EndsAt
	return nil
}

// AdminGetAnnouncements lists every announcement and the site-wide choice.
func AdminGetAnnouncements(c *gin.Context) {
	items, err := model.GetAllAnnouncements()
	if err != nil {
		respondStoreError(c, err, "list announcements", "Failed to load announcements, please try again later")
		return
	}
	common.ApiSuccess(c, gin.H{
		"items":       items,
		"guest_popup": operation_setting.GetAnnouncementSetting().GuestPopup,
	})
}

func AdminCreateAnnouncement(c *gin.Context) {
	var req announcementRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	item := &model.Announcement{}
	if err := validateAnnouncement(req, item); err != nil {
		common.ApiError(c, err)
		return
	}
	now := common.GetTimestamp()
	item.CreatedBy = c.GetInt("id")
	item.UpdatedBy = item.CreatedBy
	item.CreatedAt = now
	item.UpdatedAt = now
	if item.Status == model.AnnouncementStatusPublished {
		item.PublishedAt = now
	}
	if err := model.CreateAnnouncement(item); err != nil {
		respondStoreError(c, err, "create announcement", "Failed to save")
		return
	}
	common.ApiSuccess(c, item)
}

func AdminUpdateAnnouncement(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	var req announcementRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	item, err := model.GetAnnouncementById(id)
	if err != nil {
		respondStoreError(c, err, "load announcement", "Failed to save")
		return
	}
	if err := validateAnnouncement(req, item); err != nil {
		common.ApiError(c, err)
		return
	}
	item.UpdatedBy = c.GetInt("id")
	item.UpdatedAt = common.GetTimestamp()
	// The first publish time stays when it is archived and published again.
	if item.Status == model.AnnouncementStatusPublished && item.PublishedAt == 0 {
		item.PublishedAt = item.UpdatedAt
	}
	if err := model.UpdateAnnouncement(item); err != nil {
		respondStoreError(c, err, "update announcement", "Failed to save")
		return
	}
	common.ApiSuccess(c, item)
}

func AdminDeleteAnnouncement(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := model.DeleteAnnouncement(id); err != nil {
		respondStoreError(c, err, "delete announcement", "Failed to delete")
		return
	}
	common.ApiSuccess(c, nil)
}

type announcementSettingRequest struct {
	GuestPopup *bool `json:"guest_popup"`
}

// AdminUpdateAnnouncementSetting saves whether visitors get the popups too.
func AdminUpdateAnnouncementSetting(c *gin.Context) {
	var req announcementSettingRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || req.GuestPopup == nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	value := strconv.FormatBool(*req.GuestPopup)
	if err := model.UpdateOption(operation_setting.AnnouncementGuestPopupOptionKey, value); err != nil {
		respondStoreError(c, err, "save announcement setting", "Failed to save")
		return
	}
	common.ApiSuccess(c, nil)
}
