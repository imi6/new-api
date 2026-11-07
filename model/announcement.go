package model

import (
	"errors"
	"slices"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Announcements an administrator publishes to everyone. Each one either pops
// up or only shows in the notification bell, and can go live and offline at
// set times. A signed-in user's reads are kept here so a read announcement
// does not pop up again on another device; they are not reported to anyone.
// This is separate from the announcement timeline in the console settings.

const (
	AnnouncementStatusDraft     = "draft"
	AnnouncementStatusPublished = "published"
	AnnouncementStatusArchived  = "archived"

	AnnouncementNotifySilent = "silent"
	AnnouncementNotifyPopup  = "popup"

	// AnnouncementPublicLimit caps the announcements a visitor receives.
	AnnouncementPublicLimit = 20
)

var AnnouncementStatuses = []string{AnnouncementStatusDraft, AnnouncementStatusPublished, AnnouncementStatusArchived}
var AnnouncementNotifyModes = []string{AnnouncementNotifySilent, AnnouncementNotifyPopup}

type Announcement struct {
	Id         int    `json:"id"`
	Title      string `json:"title" gorm:"type:varchar(255)"`
	Content    string `json:"content" gorm:"type:text"`
	Status     string `json:"status" gorm:"type:varchar(16);index"`
	NotifyMode string `json:"notify_mode" gorm:"type:varchar(16)"`
	// StartsAt and EndsAt are Unix seconds; 0 means no limit.
	StartsAt int64 `json:"starts_at"`
	EndsAt   int64 `json:"ends_at"`
	// PublishedAt is when it was first published; archiving and publishing
	// again keeps it.
	PublishedAt int64 `json:"published_at"`
	CreatedBy   int   `json:"created_by"`
	UpdatedBy   int   `json:"updated_by"`
	CreatedAt   int64 `json:"created_at"`
	UpdatedAt   int64 `json:"updated_at"`
}

// AnnouncementRead records that a user read an announcement, once.
type AnnouncementRead struct {
	Id             int   `json:"id"`
	UserId         int   `json:"user_id" gorm:"uniqueIndex:idx_announcement_read_user_announcement"`
	AnnouncementId int   `json:"announcement_id" gorm:"uniqueIndex:idx_announcement_read_user_announcement;index"`
	ReadAt         int64 `json:"read_at"`
}

// ShownAt is the time shown with an announcement and used to order them:
// its start time when it has one, else when it was first published.
func (a *Announcement) ShownAt() int64 {
	if a.StartsAt > 0 {
		return a.StartsAt
	}
	return a.PublishedAt
}

func (a *Announcement) activeAt(now int64) bool {
	if a.Status != AnnouncementStatusPublished {
		return false
	}
	if a.StartsAt > 0 && now < a.StartsAt {
		return false
	}
	return a.EndsAt == 0 || now < a.EndsAt
}

// The published announcements, read again from the database at most once
// a minute. An administrator's change refreshes this instance at once;
// other instances see it within a minute. A failed read keeps what was
// cached and tries again ten seconds later, so a slow database does not
// queue every request for its own retry.
var announcementCache struct {
	sync.Mutex
	items     []Announcement
	expiresAt time.Time
}

const (
	announcementCacheTTL      = time.Minute
	announcementCacheRetryTTL = 10 * time.Second
)

func publishedAnnouncements() []Announcement {
	announcementCache.Lock()
	defer announcementCache.Unlock()
	now := time.Now()
	if now.Before(announcementCache.expiresAt) {
		return announcementCache.items
	}
	var items []Announcement
	if err := DB.Where("status = ?", AnnouncementStatusPublished).Find(&items).Error; err != nil {
		common.SysError(common.LogText("failed to load announcements: %s", err.Error()))
		announcementCache.expiresAt = now.Add(announcementCacheRetryTTL)
		return announcementCache.items
	}
	announcementCache.items = items
	announcementCache.expiresAt = now.Add(announcementCacheTTL)
	return items
}

func invalidateAnnouncementCache() {
	announcementCache.Lock()
	announcementCache.expiresAt = time.Time{}
	announcementCache.Unlock()
}

// ActiveAnnouncements returns the announcements live now, newest first, at
// most AnnouncementPublicLimit of them.
func ActiveAnnouncements() []Announcement {
	now := common.GetTimestamp()
	active := make([]Announcement, 0)
	for _, item := range publishedAnnouncements() {
		if item.activeAt(now) {
			active = append(active, item)
		}
	}
	slices.SortFunc(active, func(left, right Announcement) int {
		if left.ShownAt() != right.ShownAt() {
			if left.ShownAt() > right.ShownAt() {
				return -1
			}
			return 1
		}
		return right.Id - left.Id
	})
	if len(active) > AnnouncementPublicLimit {
		active = active[:AnnouncementPublicLimit]
	}
	return active
}

// ReadAnnouncementIds returns which of the announcements the user has read.
func ReadAnnouncementIds(userId int, announcementIds []int) (map[int]bool, error) {
	read := map[int]bool{}
	if userId <= 0 || len(announcementIds) == 0 {
		return read, nil
	}
	var ids []int
	err := DB.Model(&AnnouncementRead{}).
		Where("user_id = ? AND announcement_id IN ?", userId, announcementIds).
		Pluck("announcement_id", &ids).Error
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		read[id] = true
	}
	return read, nil
}

// LiveAnnouncementIds returns which of the ids are live now, read from the
// database rather than the cache: another instance may have published one
// in the last minute, and a read of it must not be dropped.
func LiveAnnouncementIds(ids []int) ([]int, error) {
	live := make([]int, 0, len(ids))
	if len(ids) == 0 {
		return live, nil
	}
	var items []Announcement
	err := DB.Select("id", "status", "starts_at", "ends_at").
		Where("id IN ? AND status = ?", ids, AnnouncementStatusPublished).
		Find(&items).Error
	if err != nil {
		return nil, err
	}
	now := common.GetTimestamp()
	for _, item := range items {
		if item.activeAt(now) {
			live = append(live, item.Id)
		}
	}
	return live, nil
}

// MarkAnnouncementsRead records the user's reads. A read already recorded
// keeps its first time.
func MarkAnnouncementsRead(userId int, announcementIds []int) error {
	if userId <= 0 || len(announcementIds) == 0 {
		return nil
	}
	now := common.GetTimestamp()
	rows := make([]AnnouncementRead, 0, len(announcementIds))
	for _, id := range announcementIds {
		rows = append(rows, AnnouncementRead{UserId: userId, AnnouncementId: id, ReadAt: now})
	}
	return DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&rows).Error
}

// GetAllAnnouncements lists every announcement for administrators, newest
// first.
func GetAllAnnouncements() ([]Announcement, error) {
	items := make([]Announcement, 0)
	err := DB.Order("id DESC").Find(&items).Error
	return items, err
}

func GetAnnouncementById(id int) (*Announcement, error) {
	var item Announcement
	err := DB.Where("id = ?", id).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, common.NewMessage("The announcement does not exist")
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func CreateAnnouncement(item *Announcement) error {
	if err := DB.Create(item).Error; err != nil {
		return err
	}
	invalidateAnnouncementCache()
	return nil
}

// UpdateAnnouncement saves what an administrator can change, so the creator
// and creation time stay as they were.
func UpdateAnnouncement(item *Announcement) error {
	err := DB.Model(&Announcement{}).Where("id = ?", item.Id).
		Select("title", "content", "status", "notify_mode", "starts_at", "ends_at", "published_at", "updated_by", "updated_at").
		Updates(item).Error
	if err != nil {
		return err
	}
	invalidateAnnouncementCache()
	return nil
}

// DeleteAnnouncement removes an announcement and its reads together; the
// tables have no foreign keys to do it.
func DeleteAnnouncement(id int) error {
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("announcement_id = ?", id).Delete(&AnnouncementRead{}).Error; err != nil {
			return err
		}
		result := tx.Where("id = ?", id).Delete(&Announcement{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return common.NewMessage("The announcement does not exist")
		}
		return nil
	})
	if err != nil {
		return err
	}
	invalidateAnnouncementCache()
	return nil
}
