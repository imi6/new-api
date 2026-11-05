package model

import (
	"github.com/QuantumNous/new-api/common"
)

// Intelligence check results. A row is written as running when a check starts
// and updated with the outcome when it ends, so the page can show a check in
// progress.
const (
	IntelligenceCheckCandy   = "candy"
	IntelligenceCheckPelican = "pelican"

	IntelligenceCheckRunning      = "running"
	IntelligenceCheckPassed       = "passed"
	IntelligenceCheckFailed       = "failed"
	IntelligenceCheckUndetermined = "undetermined"
	IntelligenceCheckError        = "error"

	// IntelligenceCheckKeep is how many results each group and check keeps.
	IntelligenceCheckKeep = 30
	// IntelligenceCheckStaleSeconds is how long a running row may stay
	// unfinished before it is read as interrupted.
	IntelligenceCheckStaleSeconds = 15 * 60
	// IntelligenceCheckMaxResponseBytes keeps a stored answer within MySQL's
	// 65535-byte TEXT limit on every database.
	IntelligenceCheckMaxResponseBytes = 60000
	// IntelligenceCheckMaxAnswerRunes and IntelligenceCheckMaxErrorRunes match
	// the answer and error columns; a longer value fails the write on MySQL.
	IntelligenceCheckMaxAnswerRunes = 64
	IntelligenceCheckMaxErrorRunes  = 1024
)

type IntelligenceCheckResult struct {
	Id             int    `json:"id"`
	CheckKey       string `json:"check_key" gorm:"type:varchar(16);index:idx_intelligence_check_lookup,priority:1"`
	GroupName      string `json:"group_name" gorm:"type:varchar(64);index:idx_intelligence_check_lookup,priority:2"`
	ModelName      string `json:"model_name" gorm:"type:varchar(255)"`
	ChannelId      int    `json:"channel_id"`
	Status         string `json:"status" gorm:"type:varchar(16)"`
	ExpectedAnswer string `json:"expected_answer" gorm:"type:varchar(64)"`
	Answer         string `json:"answer" gorm:"type:varchar(64)"`
	FailedChecks   string `json:"failed_checks" gorm:"type:varchar(255)"` // comma separated check names
	Response       string `json:"response" gorm:"type:text"`
	Truncated      bool   `json:"truncated"`
	Error          string `json:"error" gorm:"type:varchar(1024)"`
	LatencyMs      int64  `json:"latency_ms"`
	OutputTokens   int    `json:"output_tokens"`
	CreatedAt      int64  `json:"created_at" gorm:"index:idx_intelligence_check_lookup,priority:3"`
	FinishedAt     int64  `json:"finished_at"`
}

// StartIntelligenceCheck stores a running row for a check about to be sent.
func StartIntelligenceCheck(checkKey, group, modelName, expectedAnswer string) (*IntelligenceCheckResult, error) {
	row := &IntelligenceCheckResult{
		CheckKey:       checkKey,
		GroupName:      group,
		ModelName:      modelName,
		Status:         IntelligenceCheckRunning,
		ExpectedAnswer: expectedAnswer,
		CreatedAt:      common.GetTimestamp(),
	}
	return row, DB.Create(row).Error
}

// FinishIntelligenceCheck stores the outcome of a running row and keeps only
// the newest results of its group and check.
func FinishIntelligenceCheck(row *IntelligenceCheckResult) error {
	row.FinishedAt = common.GetTimestamp()
	err := DB.Model(&IntelligenceCheckResult{}).Where("id = ?", row.Id).Updates(map[string]any{
		"channel_id":    row.ChannelId,
		"status":        row.Status,
		"answer":        row.Answer,
		"failed_checks": row.FailedChecks,
		"response":      row.Response,
		"truncated":     row.Truncated,
		"error":         row.Error,
		"latency_ms":    row.LatencyMs,
		"output_tokens": row.OutputTokens,
		"finished_at":   row.FinishedAt,
	}).Error
	if err != nil {
		return err
	}
	return trimIntelligenceChecks(row.CheckKey, row.GroupName)
}

func trimIntelligenceChecks(checkKey, group string) error {
	var keep []int
	err := DB.Model(&IntelligenceCheckResult{}).
		Where("check_key = ? AND group_name = ?", checkKey, group).
		Order("id desc").Limit(IntelligenceCheckKeep).Pluck("id", &keep).Error
	if err != nil || len(keep) < IntelligenceCheckKeep {
		return err
	}
	return DB.Where("check_key = ? AND group_name = ? AND id < ?", checkKey, group, keep[len(keep)-1]).
		Delete(&IntelligenceCheckResult{}).Error
}

// MarkStaleIntelligenceChecks ends running rows that a restart or crash left
// unfinished.
func MarkStaleIntelligenceChecks() error {
	cutoff := common.GetTimestamp() - IntelligenceCheckStaleSeconds
	return DB.Model(&IntelligenceCheckResult{}).
		Where("status = ? AND created_at < ?", IntelligenceCheckRunning, cutoff).
		Updates(map[string]any{
			"status":      IntelligenceCheckError,
			"error":       "interrupted",
			"finished_at": common.GetTimestamp(),
		}).Error
}

// IntelligenceCheckLastRun is when a check last started in a group.
type IntelligenceCheckLastRun struct {
	CheckKey  string `gorm:"column:check_key"`
	GroupName string `gorm:"column:group_name"`
	CreatedAt int64  `gorm:"column:created_at"`
}

// GetIntelligenceCheckLastRuns returns the latest start time of every group
// and check, which the scheduler compares with each interval.
func GetIntelligenceCheckLastRuns() ([]IntelligenceCheckLastRun, error) {
	var rows []IntelligenceCheckLastRun
	err := DB.Model(&IntelligenceCheckResult{}).
		Select("check_key, group_name, MAX(created_at) AS created_at").
		Group("check_key, group_name").
		Find(&rows).Error
	return rows, err
}

// GetIntelligenceChecks returns the newest results of a group and check,
// newest first. A running row past the stale limit reads as interrupted.
func GetIntelligenceChecks(checkKey, group string, limit int) ([]IntelligenceCheckResult, error) {
	var rows []IntelligenceCheckResult
	err := DB.Where("check_key = ? AND group_name = ?", checkKey, group).
		Order("id desc").Limit(limit).Find(&rows).Error
	if err != nil {
		return nil, err
	}
	cutoff := common.GetTimestamp() - IntelligenceCheckStaleSeconds
	for i := range rows {
		if rows[i].Status == IntelligenceCheckRunning && rows[i].CreatedAt < cutoff {
			rows[i].Status = IntelligenceCheckError
			rows[i].Error = "interrupted"
		}
	}
	return rows, nil
}
