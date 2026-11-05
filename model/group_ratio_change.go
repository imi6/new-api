package model

import (
	"math"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

// GroupRatioChange records one change of a group's ratio, or a group being
// added, so users can be shown what changed recently. Rows are written only
// when an administrator saves the group ratios, on the node that saved them.
type GroupRatioChange struct {
	Id        int     `json:"id"`
	GroupName string  `json:"group_name" gorm:"type:varchar(255)"`
	OldRatio  float64 `json:"old_ratio"`
	NewRatio  float64 `json:"new_ratio"`
	// Added marks a group that had no ratio before; OldRatio is unset.
	Added     bool  `json:"added"`
	CreatedAt int64 `json:"created_at" gorm:"index:idx_group_ratio_change_created"`
}

// groupRatioChangeRetentionSeconds keeps the longest display window.
const groupRatioChangeRetentionSeconds = int64(operation_setting.RatioChangeMaxDays) * 24 * 3600

// groupRatioOptionKeys are the option keys that replace the group ratios.
var groupRatioOptionKeys = map[string]bool{
	"GroupRatio":                      true,
	"group_ratio_setting.group_ratio": true,
}

// recordGroupRatioChanges stores every group whose ratio differs between
// before and after. A failure is logged and never fails the save.
func recordGroupRatioChanges(before map[string]float64, after map[string]float64) {
	now := common.GetTimestamp()
	var rows []GroupRatioChange
	for group, ratio := range after {
		old, existed := before[group]
		if existed && sameRatio(old, ratio) {
			continue
		}
		rows = append(rows, GroupRatioChange{
			GroupName: group,
			OldRatio:  old,
			NewRatio:  ratio,
			Added:     !existed,
			CreatedAt: now,
		})
	}
	if len(rows) > 0 {
		if err := DB.Create(&rows).Error; err != nil {
			common.SysError(common.LogText("failed to record group ratio changes: %s", err.Error()))
			return
		}
		clearGroupRatioChangeCache()
	}
	if err := DB.Where("created_at < ?", now-groupRatioChangeRetentionSeconds).Delete(&GroupRatioChange{}).Error; err != nil {
		common.SysError(common.LogText("failed to delete old group ratio changes: %s", err.Error()))
	}
}

func sameRatio(left float64, right float64) bool {
	return math.Abs(left-right) < 1e-9
}

// GroupRatioChangeInfo is what a user is shown for one group: the ratio it
// had at the start of the window and has now, or that the group is new.
type GroupRatioChangeInfo struct {
	From float64 `json:"from"`
	To   float64 `json:"to"`
	// At is the time of the latest change, or when the group was added.
	At  int64 `json:"at"`
	New bool  `json:"new,omitempty"`
}

const (
	groupRatioChangeCacheTTL = 60 * time.Second
	// groupRatioChangeErrorTTL is how long a failed lookup shows no changes
	// before the database is asked again.
	groupRatioChangeErrorTTL = 10 * time.Second
)

var (
	groupRatioChangeCache        map[string]GroupRatioChangeInfo
	groupRatioChangeCacheExpires time.Time
	groupRatioChangeCacheMu      sync.Mutex
)

func clearGroupRatioChangeCache() {
	groupRatioChangeCacheMu.Lock()
	groupRatioChangeCacheExpires = time.Time{}
	groupRatioChangeCacheMu.Unlock()
}

// RecentGroupRatioChanges returns, per group, its net ratio change over the
// configured window, or that it was added in it. A group whose ratio went
// back to where it started is left out. It is nil when the notice is off.
func RecentGroupRatioChanges() map[string]GroupRatioChangeInfo {
	if !operation_setting.GetRatioChangeSetting().Enabled {
		return nil
	}
	groupRatioChangeCacheMu.Lock()
	defer groupRatioChangeCacheMu.Unlock()
	if time.Now().Before(groupRatioChangeCacheExpires) {
		return groupRatioChangeCache
	}
	since := common.GetTimestamp() - int64(operation_setting.RatioChangeDays())*24*3600
	var rows []GroupRatioChange
	err := DB.Where("created_at >= ?", since).Order("created_at ASC, id ASC").Find(&rows).Error
	if err != nil {
		common.SysError(common.LogText("failed to load group ratio changes: %s", err.Error()))
		// Keep the empty result for a while: the pages that ask are public,
		// and retrying on every request would pile them up on the database.
		groupRatioChangeCache = nil
		groupRatioChangeCacheExpires = time.Now().Add(groupRatioChangeErrorTTL)
		return nil
	}
	type window struct {
		from  float64
		last  int64
		added bool
	}
	windows := map[string]*window{}
	for _, row := range rows {
		item := windows[row.GroupName]
		if item == nil {
			item = &window{from: row.OldRatio}
			windows[row.GroupName] = item
		}
		item.last = row.CreatedAt
		if row.Added {
			item.added = true
		}
	}
	current := ratio_setting.GetGroupRatioCopy()
	changes := map[string]GroupRatioChangeInfo{}
	for group, item := range windows {
		ratio, ok := current[group]
		if !ok {
			continue
		}
		if item.added {
			changes[group] = GroupRatioChangeInfo{To: ratio, At: item.last, New: true}
			continue
		}
		if sameRatio(item.from, ratio) {
			continue
		}
		changes[group] = GroupRatioChangeInfo{From: item.from, To: ratio, At: item.last}
	}
	groupRatioChangeCache = changes
	groupRatioChangeCacheExpires = time.Now().Add(groupRatioChangeCacheTTL)
	return changes
}
