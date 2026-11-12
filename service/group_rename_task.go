package service

import (
	"context"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// groupRenameTaskHandler 推进进行中的分组改名，并清理过了保留期的别名。
type groupRenameTaskHandler struct{}

func init() { RegisterSystemTaskHandler(groupRenameTaskHandler{}) }

func (groupRenameTaskHandler) Type() string            { return model.SystemTaskTypeGroupRename }
func (groupRenameTaskHandler) Interval() time.Duration { return 30 * time.Second }
func (groupRenameTaskHandler) NewPayload() any         { return nil }
func (groupRenameTaskHandler) Enabled() bool {
	return common.GroupRenameNeedsWork(model.GroupRenameRetentionSeconds, common.GetTimestamp())
}

func (groupRenameTaskHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	status, message := model.SystemTaskStatusSucceeded, ""
	if err := model.AdvanceGroupRename(); err != nil {
		status, message = model.SystemTaskStatusFailed, err.Error()
	}
	if err := model.FinishSystemTask(task.TaskID, runnerID, status, nil, message); err != nil {
		logSystemTaskLockError(ctx, task, err)
	}
}
