package controller

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

// The scheduled intelligence checks ask each configured group a fixed
// question, routed like a user request: the group's channels are chosen by
// priority and weight and retried by the relay retry rules. A failure never
// disables a channel or counts toward channel health; it is only a result.

const (
	intelligenceCheckTimeout      = 10 * time.Minute
	intelligenceCheckMaxBodyBytes = 16 << 20
	intelligenceCheckLogName      = "Intelligence check"
	intelligenceCheckCacheTTL     = 60 * time.Second
	intelligenceCheckListLimit    = 10
)

type intelligenceCheckItem struct {
	checkKey string
	group    string
	model    string
}

type intelligenceCheckTaskPayload struct {
	// Force runs every enabled check of every group now, as the admin's
	// "check now" does; a scheduled run takes only the checks that are due.
	Force bool `json:"force,omitempty"`
}

type intelligenceCheckSummary struct {
	Checked int `json:"checked"`
	Passed  int `json:"passed"`
	Failed  int `json:"failed"`
	Other   int `json:"other"`
}

// dueIntelligenceChecks lists the checks to run now. A check is due when it
// never ran in its group or its interval has passed since it last started.
func dueIntelligenceChecks(force bool) ([]intelligenceCheckItem, error) {
	setting := operation_setting.GetIntelligenceCheckSetting()
	if !setting.Enabled || len(setting.Targets) == 0 {
		return nil, nil
	}
	lastRuns, err := model.GetIntelligenceCheckLastRuns()
	if err != nil {
		return nil, err
	}
	last := map[string]int64{}
	for _, run := range lastRuns {
		last[run.CheckKey+"\x00"+run.GroupName] = run.CreatedAt
	}
	checks := []struct {
		key     string
		enabled bool
		hours   int
	}{
		{model.IntelligenceCheckCandy, setting.CandyEnabled, setting.CandyIntervalHours},
		{model.IntelligenceCheckPelican, setting.PelicanEnabled, setting.PelicanIntervalHours},
	}
	now := common.GetTimestamp()
	var items []intelligenceCheckItem
	for _, target := range setting.Targets {
		for _, check := range checks {
			if !check.enabled {
				continue
			}
			lastRun, ran := last[check.key+"\x00"+target.Group]
			interval := int64(operation_setting.IntelligenceCheckInterval(check.hours)) * 3600
			if force || !ran || now-lastRun >= interval {
				items = append(items, intelligenceCheckItem{checkKey: check.key, group: target.Group, model: target.Model})
			}
		}
	}
	return items, nil
}

// intelligenceCheckRequest builds the question for a channel, in the shape of
// the endpoint a channel test would use for that model.
func intelligenceCheckRequest(channel *model.Channel, modelName, prompt string, maxTokens int) (dto.Request, string) {
	tokens := uint(operation_setting.IntelligenceCheckMaxTokensOrDefault(maxTokens))
	if channel.Type == constant.ChannelTypeCodex || strings.Contains(strings.ToLower(modelName), "codex") {
		input, _ := common.Marshal([]map[string]string{{"role": "user", "content": prompt}})
		return &dto.OpenAIResponsesRequest{
			Model:           modelName,
			Input:           input,
			Stream:          lo.ToPtr(true),
			MaxOutputTokens: lo.ToPtr(tokens),
		}, string(constant.EndpointTypeOpenAIResponse)
	}
	return &dto.GeneralOpenAIRequest{
		Model:         modelName,
		Stream:        lo.ToPtr(true),
		StreamOptions: &dto.StreamOptions{IncludeUsage: true},
		MaxTokens:     lo.ToPtr(tokens),
		Messages:      []dto.Message{{Role: "user", Content: prompt}},
	}, string(constant.EndpointTypeOpenAI)
}

// askIntelligenceCheck sends the question as a user request would be sent:
// a channel chosen by priority and weight, retried on retryable failures.
func askIntelligenceCheck(ctx context.Context, testUserID int, item intelligenceCheckItem, prompt string, maxTokens int) (testResult, int, error) {
	var last testResult
	channelID := 0
	for retry := 0; retry <= common.RetryTimes; retry++ {
		if ctx.Err() != nil {
			return last, channelID, ctx.Err()
		}
		channel, err := model.GetRandomSatisfiedChannel(item.group, item.model, retry, nil)
		if err != nil {
			return last, channelID, err
		}
		if channel == nil {
			if retry == 0 {
				return last, 0, errors.New("no available channel")
			}
			break
		}
		channelID = channel.Id
		request, endpoint := intelligenceCheckRequest(channel, item.model, prompt, maxTokens)
		last = runChannelTest(ctx, channel, testUserID, item.model, endpoint, true, channelTestOptions{
			request:      request,
			group:        item.group,
			logName:      intelligenceCheckLogName,
			maxBodyBytes: intelligenceCheckMaxBodyBytes,
		})
		if last.localErr == nil && last.newAPIError == nil {
			return last, channelID, nil
		}
		if last.newAPIError == nil || last.context == nil {
			break
		}
		decision := service.DecideRelayRetry(last.context, last.newAPIError, common.RetryTimes-retry)
		if decision.Action != "retry" {
			break
		}
	}
	if last.newAPIError != nil {
		return last, channelID, last.newAPIError
	}
	if last.localErr != nil {
		return last, channelID, last.localErr
	}
	return last, channelID, errors.New("no available channel")
}

// runIntelligenceCheck runs one check and stores its result.
func runIntelligenceCheck(ctx context.Context, testUserID int, item intelligenceCheckItem) string {
	setting := operation_setting.GetIntelligenceCheckSetting()
	prompt, expected, maxTokens := setting.PelicanPrompt, "", setting.PelicanMaxTokens
	if item.checkKey == model.IntelligenceCheckCandy {
		prompt, expected, maxTokens = setting.CandyPrompt, strings.TrimSpace(setting.CandyAnswer), setting.CandyMaxTokens
		if format := strings.TrimSpace(setting.CandyAnswerFormat); format != "" {
			prompt = strings.TrimRight(prompt, "\n") + "\n\n" + format
		}
	}
	row, err := model.StartIntelligenceCheck(item.checkKey, item.group, item.model, expected)
	if err != nil {
		common.SysError(common.LogText("failed to start intelligence check group=%s: %s", item.group, err.Error()))
		return model.IntelligenceCheckError
	}
	checkCtx, cancel := context.WithTimeout(ctx, intelligenceCheckTimeout)
	defer cancel()
	started := time.Now()
	result, channelID, askErr := askIntelligenceCheck(checkCtx, testUserID, item, prompt, maxTokens)
	row.LatencyMs = time.Since(started).Milliseconds()
	row.ChannelId = channelID
	if askErr != nil {
		row.Status = model.IntelligenceCheckError
		row.Error = common.MaskSensitiveInfo(askErr.Error())
		if errors.Is(askErr, context.DeadlineExceeded) {
			row.Error = "timeout"
		}
	} else {
		answer := service.IntelligenceAnswerFromStream(result.body)
		if result.usage != nil {
			row.OutputTokens = result.usage.CompletionTokens
		}
		if item.checkKey == model.IntelligenceCheckCandy {
			row.Status, row.Answer = service.GradeIntelligenceAnswer(answer, expected)
		} else {
			var failed []string
			row.Status, failed = service.GradeIntelligenceDrawing(answer)
			row.FailedChecks = strings.Join(failed, ",")
		}
		row.Response, row.Truncated = service.TruncateIntelligenceResponse(answer)
	}
	if len(row.Error) > 1024 {
		row.Error = row.Error[:1024]
	}
	if err := model.FinishIntelligenceCheck(row); err != nil {
		common.SysError(common.LogText("failed to store intelligence check group=%s: %s", item.group, err.Error()))
	}
	clearIntelligenceCheckCache(item.group)
	return row.Status
}

// intelligenceCheckHandler runs the checks that are due. Enabled() asks the
// result table whether any is due, so an idle site creates no task rows.
type intelligenceCheckHandler struct{}

func (intelligenceCheckHandler) Type() string { return model.SystemTaskTypeIntelligenceCheck }

func (intelligenceCheckHandler) Enabled() bool {
	items, err := dueIntelligenceChecks(false)
	return err == nil && len(items) > 0
}

func (intelligenceCheckHandler) Interval() time.Duration { return time.Minute }

func (intelligenceCheckHandler) NewPayload() any { return nil }

func (intelligenceCheckHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	payload := intelligenceCheckTaskPayload{}
	if err := task.DecodePayload(&payload); err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	if err := model.MarkStaleIntelligenceChecks(); err != nil {
		common.SysError(common.LogText("failed to end stale intelligence checks: %s", err.Error()))
	}
	items, err := dueIntelligenceChecks(payload.Force)
	if err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	testUserID, err := resolveChannelTestUserID(nil)
	if err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	report := service.NewSystemTaskProgressReporter(task, runnerID)
	summary := intelligenceCheckSummary{}
	// One at a time: the answers are long, and a burst would load every
	// upstream at once.
	for index, item := range items {
		if ctx.Err() != nil {
			break
		}
		switch runIntelligenceCheck(ctx, testUserID, item) {
		case model.IntelligenceCheckPassed:
			summary.Passed++
		case model.IntelligenceCheckFailed:
			summary.Failed++
		default:
			summary.Other++
		}
		summary.Checked++
		report(index+1, len(items))
	}
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
}

// RunIntelligenceChecksNow queues a run of every enabled check, for an admin
// who changed a question and wants to see it answered.
func RunIntelligenceChecksNow(c *gin.Context) {
	setting := operation_setting.GetIntelligenceCheckSetting()
	if !setting.Enabled || len(setting.Targets) == 0 {
		common.ApiErrorT(c, "Turn on intelligence checks and add a group first")
		return
	}
	task, created, err := service.EnqueueSystemTask(model.SystemTaskTypeIntelligenceCheck, intelligenceCheckTaskPayload{Force: true})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !created {
		common.ApiErrorStatus(c, http.StatusConflict, common.NewMessage("An intelligence check is already running. Wait for it to finish"), gin.H{"data": gin.H{"task_id": task.TaskID}})
		return
	}
	common.ApiSuccess(c, gin.H{"task_id": task.TaskID})
}

// GetIntelligenceCheckModels lists the enabled models of every group, for
// choosing what each group is checked with.
func GetIntelligenceCheckModels(c *gin.Context) {
	groups := map[string][]string{}
	for group := range service.GetUserUsableGroups("") {
		if group == "auto" {
			continue
		}
		groups[group] = model.GetGroupEnabledModels(group)
	}
	common.ApiSuccess(c, groups)
}

type intelligenceCheckView struct {
	Id             int    `json:"id"`
	Status         string `json:"status"`
	ModelName      string `json:"model_name"`
	ExpectedAnswer string `json:"expected_answer"`
	Answer         string `json:"answer"`
	FailedChecks   string `json:"failed_checks"`
	Response       string `json:"response"`
	Truncated      bool   `json:"truncated"`
	LatencyMs      int64  `json:"latency_ms"`
	OutputTokens   int    `json:"output_tokens"`
	CreatedAt      int64  `json:"created_at"`
	FinishedAt     int64  `json:"finished_at"`
	// Shown to administrators only: the channel and the error may name an
	// upstream.
	ChannelId int    `json:"channel_id,omitempty"`
	Error     string `json:"error,omitempty"`
	// Interrupted marks a check a restart or crash left unfinished; it is
	// safe to show everyone.
	Interrupted bool `json:"interrupted,omitempty"`
}

type intelligenceCheckGroupData struct {
	Group   string                  `json:"group"`
	Model   string                  `json:"model"`
	Enabled bool                    `json:"enabled"`
	Candy   []intelligenceCheckView `json:"candy"`
	Pelican []intelligenceCheckView `json:"pelican"`
}

type intelligenceCheckCacheEntry struct {
	data    *intelligenceCheckGroupData
	expires time.Time
}

var (
	intelligenceCheckCache   = map[string]intelligenceCheckCacheEntry{}
	intelligenceCheckCacheMu sync.Mutex
)

func clearIntelligenceCheckCache(group string) {
	intelligenceCheckCacheMu.Lock()
	delete(intelligenceCheckCache, group)
	intelligenceCheckCacheMu.Unlock()
}

func loadIntelligenceCheckGroup(group string) (*intelligenceCheckGroupData, error) {
	intelligenceCheckCacheMu.Lock()
	entry, ok := intelligenceCheckCache[group]
	intelligenceCheckCacheMu.Unlock()
	if ok && time.Now().Before(entry.expires) {
		return entry.data, nil
	}
	setting := operation_setting.GetIntelligenceCheckSetting()
	data := &intelligenceCheckGroupData{
		Group:   group,
		Model:   operation_setting.IntelligenceCheckTargetModel(group),
		Enabled: setting.Enabled,
	}
	for _, check := range []struct {
		key    string
		target *[]intelligenceCheckView
	}{
		{model.IntelligenceCheckCandy, &data.Candy},
		{model.IntelligenceCheckPelican, &data.Pelican},
	} {
		rows, err := model.GetIntelligenceChecks(check.key, group, intelligenceCheckListLimit)
		if err != nil {
			return nil, err
		}
		views := make([]intelligenceCheckView, 0, len(rows))
		for _, row := range rows {
			views = append(views, intelligenceCheckView{
				Id:             row.Id,
				Status:         row.Status,
				ModelName:      row.ModelName,
				ExpectedAnswer: row.ExpectedAnswer,
				Answer:         row.Answer,
				FailedChecks:   row.FailedChecks,
				Response:       row.Response,
				Truncated:      row.Truncated,
				LatencyMs:      row.LatencyMs,
				OutputTokens:   row.OutputTokens,
				CreatedAt:      row.CreatedAt,
				FinishedAt:     row.FinishedAt,
				ChannelId:      row.ChannelId,
				Error:          row.Error,
				Interrupted:    row.Status == model.IntelligenceCheckError && row.Error == "interrupted",
			})
		}
		*check.target = views
	}
	intelligenceCheckCacheMu.Lock()
	intelligenceCheckCache[group] = intelligenceCheckCacheEntry{data: data, expires: time.Now().Add(intelligenceCheckCacheTTL)}
	intelligenceCheckCacheMu.Unlock()
	return data, nil
}

// GetIntelligenceChecks serves the check results of one group. Access follows
// the channel status switch; channel ids and errors go to administrators only.
func GetIntelligenceChecks(c *gin.Context) {
	group := strings.TrimSpace(c.Query("group"))
	if group == "" || operation_setting.IntelligenceCheckTargetModel(group) == "" {
		common.ApiErrorT(c, "This group has no intelligence check")
		return
	}
	data, err := loadIntelligenceCheckGroup(group)
	if err != nil {
		common.SysError(common.LogText("failed to load intelligence checks group=%s: %s", group, err.Error()))
		common.ApiErrorT(c, "Failed to load intelligence checks")
		return
	}
	// An access token never widens past what a visitor sees here.
	if c.GetInt("role") >= common.RoleAdminUser && !c.GetBool("use_access_token") {
		common.ApiSuccess(c, data)
		return
	}
	public := *data
	public.Candy = hideIntelligenceCheckDetails(data.Candy)
	public.Pelican = hideIntelligenceCheckDetails(data.Pelican)
	common.ApiSuccess(c, public)
}

func hideIntelligenceCheckDetails(views []intelligenceCheckView) []intelligenceCheckView {
	hidden := make([]intelligenceCheckView, len(views))
	for i, view := range views {
		view.ChannelId = 0
		view.Error = ""
		hidden[i] = view
	}
	return hidden
}
