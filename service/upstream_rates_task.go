package service

import (
	"context"
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

type upstreamRateTaskPayload struct {
	SourceID  string `json:"source_id,omitempty"`
	ChannelID int    `json:"channel_id,omitempty"`
	Force     bool   `json:"force,omitempty"`
	OnlyDue   bool   `json:"only_due,omitempty"`
}

type upstreamRateTaskHandler struct{}

func init() { RegisterSystemTaskHandler(upstreamRateTaskHandler{}) }

func (upstreamRateTaskHandler) Type() string            { return upstreamRatesTaskType }
func (upstreamRateTaskHandler) Interval() time.Duration { return 30 * time.Second }
func (upstreamRateTaskHandler) NewPayload() any         { return upstreamRateTaskPayload{OnlyDue: true} }
func (upstreamRateTaskHandler) Enabled() bool {
	config, err := loadUpstreamRateConfig(context.Background())
	if err != nil {
		return false
	}
	for _, source := range config.Sources {
		if !source.Enabled {
			continue
		}
		snapshot, err := loadUpstreamRateSnapshot(context.Background(), source)
		if err == nil && time.Now().Unix()-snapshot.AttemptAt >= int64(source.PollSeconds) {
			return true
		}
	}
	return false
}

func EnqueueUpstreamRateRefresh(ctx context.Context, sourceID string, localChannelID int, force bool) (*model.SystemTask, error) {
	if localChannelID < 0 {
		return nil, ErrUpstreamRateConfig
	}
	config, err := loadUpstreamRateConfig(ctx)
	if err != nil {
		return nil, err
	}
	payload := upstreamRateTaskPayload{SourceID: sourceID, Force: force}
	if localChannelID > 0 {
		views, err := GetUpstreamRates(ctx, []int{localChannelID})
		if err != nil {
			return nil, err
		}
		if len(views) != 1 {
			return nil, ErrUpstreamRateConfig
		}
		if force {
			view := views[0]
			if !view.ForceRefreshAvailable || (sourceID != "" && sourceID != view.SourceID) {
				return nil, ErrUpstreamRateConfig
			}
			payload.SourceID, payload.ChannelID = view.SourceID, view.UpstreamChannelID
		}
	}
	if force && payload.ChannelID <= 0 {
		return nil, ErrUpstreamRateConfig
	}
	if payload.SourceID == "" {
		found := false
		for _, source := range config.Sources {
			if source.Enabled {
				found = true
				break
			}
		}
		if !found {
			return nil, ErrUpstreamRateConfig
		}
	}
	if payload.SourceID != "" {
		found := false
		for _, source := range config.Sources {
			if source.ID != payload.SourceID || !source.Enabled {
				continue
			}
			found = true
			if force {
				snapshot, err := loadUpstreamRateSnapshot(ctx, source)
				if err != nil {
					return nil, err
				}
				if time.Now().Unix()-snapshot.ForceAttempts[payload.ChannelID] < 60 {
					return nil, ErrUpstreamRateCooldown
				}
			}
			break
		}
		if !found {
			return nil, ErrUpstreamRateConfig
		}
	}
	task, created, err := EnqueueSystemTask(upstreamRatesTaskType, payload)
	if err != nil {
		return nil, err
	}
	if !created {
		var active upstreamRateTaskPayload
		if task.DecodePayload(&active) != nil || active.Force != payload.Force || active.SourceID != payload.SourceID || active.ChannelID != payload.ChannelID || active.OnlyDue != payload.OnlyDue {
			return nil, ErrUpstreamRateBusy
		}
	}
	return task, nil
}

func mutateUpstreamRateSnapshot(ctx context.Context, source upstreamRateSource, mutate func(*upstreamRateSnapshot) error) error {
	return model.MutateUpstreamRatesState(ctx, "snapshot."+source.ID, func(raw string) (string, error) {
		var snapshot upstreamRateSnapshot
		if err := common.UnmarshalJsonStr(raw, &snapshot); err != nil {
			return "", err
		}
		if snapshot.Revision != source.Revision {
			snapshot = upstreamRateSnapshot{Revision: source.Revision}
		}
		if snapshot.Channels == nil {
			snapshot.Channels = map[int]upstreamRateRecord{}
		}
		if snapshot.ForceAttempts == nil {
			snapshot.ForceAttempts = map[int]int64{}
		}
		if err := mutate(&snapshot); err != nil {
			return "", err
		}
		encoded, err := common.Marshal(snapshot)
		return string(encoded), err
	})
}

func (upstreamRateTaskHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	payload := upstreamRateTaskPayload{}
	var runErr error
	processed, failed := 0, 0
	defer func() {
		status, message := model.SystemTaskStatusSucceeded, ""
		if runErr != nil || failed > 0 {
			status, message = model.SystemTaskStatusFailed, "Upstream rate refresh was not fully successful"
		}
		if err := model.FinishSystemTask(task.TaskID, runnerID, status, map[string]int{"processed": processed, "failed": failed}, message); err != nil {
			logSystemTaskLockError(context.Background(), task, err)
		}
	}()
	if runErr = task.DecodePayload(&payload); runErr != nil {
		return
	}
	config, err := loadUpstreamRateConfig(ctx)
	if err != nil {
		runErr = err
		return
	}
	for _, source := range config.Sources {
		if !source.Enabled || (payload.SourceID != "" && payload.SourceID != source.ID) {
			continue
		}
		if ctx.Err() != nil {
			runErr = ctx.Err()
			return
		}
		snapshot, err := loadUpstreamRateSnapshot(ctx, source)
		if err != nil {
			runErr = err
			return
		}
		now := time.Now().Unix()
		if payload.OnlyDue && now-snapshot.AttemptAt < int64(source.PollSeconds) {
			continue
		}
		if payload.Force && (payload.ChannelID <= 0 || now-snapshot.ForceAttempts[payload.ChannelID] < 60) {
			runErr = ErrUpstreamRateCooldown
			return
		}
		if err := mutateUpstreamRateSnapshot(ctx, source, func(snapshot *upstreamRateSnapshot) error {
			if payload.Force {
				snapshot.ForceAttempts[payload.ChannelID] = now
			} else {
				snapshot.AttemptAt = now
			}
			return nil
		}); err != nil {
			runErr = err
			return
		}
		channels, channelErrors, complete, fetchErr := fetchUpstreamRateChannels(ctx, source, payload.ChannelID, payload.Force)
		now = time.Now().Unix()
		processed++
		if fetchErr != nil || !complete {
			failed++
		}
		// 配置变化时丢弃在途结果；状态读取也会按 revision 隔离旧快照。
		current, err := loadUpstreamRateConfig(ctx)
		if err != nil {
			runErr = err
			return
		}
		validSource := false
		for _, active := range current.Sources {
			if active.ID == source.ID && active.Revision == source.Revision && active.Enabled {
				validSource = true
				break
			}
		}
		if !validSource {
			continue
		}
		err = mutateUpstreamRateSnapshot(ctx, source, func(snapshot *upstreamRateSnapshot) error {
			if fetchErr != nil {
				if payload.ChannelID > 0 {
					record := snapshot.Channels[payload.ChannelID]
					record.Data.ID, record.Error = payload.ChannelID, fetchErr.Error()
					snapshot.Channels[payload.ChannelID] = record
				} else {
					snapshot.Error = fetchErr.Error()
					for id, record := range snapshot.Channels {
						record.Error = fetchErr.Error()
						snapshot.Channels[id] = record
					}
				}
				return nil
			}
			if payload.ChannelID == 0 {
				snapshot.ReadAt, snapshot.Error, snapshot.Complete = now, "", complete
			}
			seen := map[int]bool{}
			for _, channel := range channels {
				seen[channel.ID] = true
				snapshot.Channels[channel.ID] = mergeUpstreamRateRecord(snapshot.Channels[channel.ID], channel, now, int64((source.ScanMinutes*2+5)*60))
				if code, exists := channelErrors[channel.ID]; exists {
					record := snapshot.Channels[channel.ID]
					record.Error = code
					snapshot.Channels[channel.ID] = record
				}
			}
			if payload.ChannelID == 0 {
				for id, record := range snapshot.Channels {
					if seen[id] {
						continue
					}
					record.Error = "channel_unavailable"
					snapshot.Channels[id] = record
				}
			}
			return nil
		})
		if err != nil {
			runErr = err
			return
		}
	}
	if payload.SourceID != "" && processed == 0 {
		runErr = errors.New("source_unavailable")
	}
}

func GetUpstreamRateTask(taskID string) (*model.SystemTaskResponse, error) {
	task, err := model.GetSystemTaskByTaskID(taskID)
	if err != nil {
		return nil, err
	}
	if task == nil || task.Type != upstreamRatesTaskType {
		return nil, ErrUpstreamRateConfig
	}
	response := task.ToResponse()
	return &response, nil
}
