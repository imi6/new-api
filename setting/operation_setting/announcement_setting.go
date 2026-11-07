package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

// AnnouncementSetting holds the site-wide choices of the announcements that
// pop up, stored as announcement_setting.<json key> options. It is saved
// through the announcement admin API, which every administrator can use,
// rather than the root-only option API.
type AnnouncementSetting struct {
	// GuestPopup also pops announcements up for visitors who are not signed
	// in. It only decides whether they pop up: the announcements are public
	// either way.
	GuestPopup bool `json:"guest_popup"`
}

// AnnouncementGuestPopupOptionKey is the option that stores GuestPopup.
const AnnouncementGuestPopupOptionKey = "announcement_setting.guest_popup"

var announcementSetting = AnnouncementSetting{
	GuestPopup: true,
}

func init() {
	config.GlobalConfig.Register("announcement_setting", &announcementSetting)
}

func GetAnnouncementSetting() *AnnouncementSetting {
	return &announcementSetting
}
