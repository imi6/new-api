package service

import (
	"context"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/bytedance/gopkg/util/gopool"
)

// groupRenameDriveTimeout 之后改名交回系统任务按周期推进。
const groupRenameDriveTimeout = 10 * time.Minute

var groupRenameDriving atomic.Bool

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

// DriveGroupRename 在发起改名的节点上每秒推进一次改名，不等系统任务的 30 秒周期。
// 本节点加载到新版本后立即上报，其他节点由节点同步在几秒内加载并上报，所以每一步通常几秒就能确认。
// 推进和系统任务都先锁别名配置并核对步骤，同时执行也只会推进一次。
func DriveGroupRename() {
	if !groupRenameDriving.CompareAndSwap(false, true) {
		return
	}
	gopool.Go(func() {
		defer groupRenameDriving.Store(false)
		reported := int64(-1)
		deadline := time.Now().Add(groupRenameDriveTimeout)
		for time.Now().Before(deadline) {
			if !common.GroupRenameNeedsWork(model.GroupRenameRetentionSeconds, common.GetTimestamp()) {
				return
			}
			if revision := common.GroupRenameAliasRevision(); revision != reported {
				if err := ReportCurrentSystemInstance(); err == nil {
					reported = revision
				}
			}
			if err := model.AdvanceGroupRename(); err != nil {
				logger.LogWarn(context.Background(), common.LogText("group rename advance failed: %v", err))
				return
			}
			// 遇到需要管理员处理的问题时停下，交给系统任务按周期重试，不每秒重写别名配置。
			if status, err := model.GetGroupRenameStatus(); err != nil || status.Alias != nil && status.Alias.Error != nil {
				return
			}
			time.Sleep(time.Second)
		}
	})
}
