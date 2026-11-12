package controller

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strconv"
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
	// Group limits a forced run to one group, for the per-group button.
	Group string `json:"group,omitempty"`
}

type intelligenceCheckSummary struct {
	Checked int `json:"checked"`
	Passed  int `json:"passed"`
	Failed  int `json:"failed"`
	Other   int `json:"other"`
}

// dueIntelligenceChecks lists the checks to run now. A check is due when it
// never ran in its group or its interval has passed since it last started.
// A non-empty group keeps only that group's checks.
func dueIntelligenceChecks(force bool, group string) ([]intelligenceCheckItem, error) {
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
	now := common.GetTimestamp()
	var items []intelligenceCheckItem
	for _, target := range setting.Targets {
		if group != "" && target.Group != group {
			continue
		}
		// A question runs in a group when it is on and the group asks it.
		checks := []struct {
			key     string
			enabled bool
			hours   int
		}{
			{model.IntelligenceCheckCandy, setting.CandyEnabled && target.RunsCandy(), setting.CandyIntervalHours},
			{model.IntelligenceCheckPelican, setting.PelicanEnabled && target.RunsPelican(), setting.PelicanIntervalHours},
		}
		for _, check := range checks {
			if !check.enabled {
				continue
			}
			lastRun, ran := last[check.key+"\x00"+target.Group]
			// Clearing removes the runs but not the wait for the next one.
			if setting.ClearedAt > lastRun {
				lastRun, ran = setting.ClearedAt, true
			}
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
			// A timed-out answer is a failed request, not a short answer.
			requireCompleteStream: true,
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
	// Show the check in progress at once, not after the cache expires.
	clearIntelligenceCheckCache(item.group)
	checkCtx, cancel := context.WithTimeout(ctx, intelligenceCheckTimeout)
	defer cancel()
	started := time.Now()
	result, channelID, askErr := askIntelligenceCheck(checkCtx, testUserID, item, prompt, maxTokens)
	row.LatencyMs = time.Since(started).Milliseconds()
	row.ChannelId = channelID
	if askErr != nil {
		row.Status = model.IntelligenceCheckError
		row.Error = service.TruncateIntelligenceError(common.MaskSensitiveInfo(askErr.Error()))
		if errors.Is(askErr, context.DeadlineExceeded) {
			row.Error = "timeout"
		}
	} else {
		streamed, cutAtLimit := service.IntelligenceAnswerFromStream(result.body)
		answer := service.IntelligenceAnswerText(streamed)
		if result.usage != nil {
			row.OutputTokens = result.usage.CompletionTokens
		}
		var failed []string
		if item.checkKey == model.IntelligenceCheckCandy {
			row.Status, row.Answer = service.GradeIntelligenceAnswer(answer, expected)
		} else {
			row.Status, failed = service.GradeIntelligenceDrawing(answer)
		}
		// Say why an answer stopped short: raising the limit fixes it.
		if cutAtLimit && row.Status != model.IntelligenceCheckPassed {
			failed = append([]string{service.IntelligenceCheckTokenLimit}, failed...)
		}
		row.FailedChecks = strings.Join(failed, ",")
		row.Response, row.Truncated = service.TruncateIntelligenceResponse(answer)
	}
	keep := operation_setting.IntelligenceCheckKeepResults()
	if err := model.FinishIntelligenceCheck(row, keep); err != nil {
		common.SysError(common.LogText("failed to store intelligence check group=%s: %s", item.group, err.Error()))
		// Do not leave the row running: store the outcome without the answer.
		row.Status, row.Response, row.Answer, row.Error = model.IntelligenceCheckError, "", "", "store_failed"
		if retryErr := model.FinishIntelligenceCheck(row, keep); retryErr != nil {
			common.SysError(common.LogText("failed to end intelligence check group=%s: %s", item.group, retryErr.Error()))
		}
	}
	clearIntelligenceCheckCache(item.group)
	return row.Status
}

// intelligenceCheckHandler runs the checks that are due. Enabled() asks the
// result table whether any is due, so an idle site creates no task rows.
type intelligenceCheckHandler struct{}

func (intelligenceCheckHandler) Type() string { return model.SystemTaskTypeIntelligenceCheck }

func (intelligenceCheckHandler) Enabled() bool {
	items, err := dueIntelligenceChecks(false, "")
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
	// A lowered keep limit applies to the old results too.
	if err := model.TrimAllIntelligenceChecks(operation_setting.IntelligenceCheckKeepResults()); err != nil {
		common.SysError(common.LogText("failed to trim intelligence checks: %s", err.Error()))
	}
	items, err := dueIntelligenceChecks(payload.Force, payload.Group)
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
	// The settings page shows "0 of N" while the first long answer streams.
	report(0, len(items))
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

type intelligenceCheckRunRequest struct {
	// Group runs only that listed group; empty runs every group.
	Group string `json:"group"`
}

// RunIntelligenceChecksNow queues a run of every enabled check, or of one
// group's, for an admin who changed a question and wants to see it answered.
// When a run is already going, it returns that run so the page follows it
// instead of failing.
func RunIntelligenceChecksNow(c *gin.Context) {
	var req intelligenceCheckRunRequest
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, 4096))
	if err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	// An empty body runs every group.
	if len(bytes.TrimSpace(body)) > 0 {
		if err := common.Unmarshal(body, &req); err != nil {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
	}
	req.Group = strings.TrimSpace(req.Group)
	setting := operation_setting.GetIntelligenceCheckSetting()
	if !setting.Enabled || len(setting.Targets) == 0 {
		common.ApiErrorT(c, "Turn on intelligence checks and add a group first")
		return
	}
	if req.Group != "" {
		if _, ok := operation_setting.IntelligenceCheckTargetFor(req.Group); !ok {
			common.ApiErrorT(c, "This group has no intelligence check")
			return
		}
	}
	task, created, err := service.EnqueueSystemTask(model.SystemTaskTypeIntelligenceCheck, intelligenceCheckTaskPayload{Force: true, Group: req.Group})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"task_id": task.TaskID, "already_running": !created})
}

type intelligenceCheckClearRequest struct {
	// Before deletes the results created before this time; zero deletes all.
	Before int64 `json:"before"`
}

// ClearIntelligenceChecks deletes stored results, all of them or those older
// than a time. The next scheduled check waits a full interval from now, so a
// clear does not set off every check at once.
func ClearIntelligenceChecks(c *gin.Context) {
	var req intelligenceCheckClearRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || req.Before < 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	deleted, err := model.DeleteIntelligenceChecksBefore(req.Before)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if deleted > 0 {
		if err := model.UpdateOption("intelligence_check_setting.cleared_at", strconv.FormatInt(common.GetTimestamp(), 10)); err != nil {
			common.SysError(common.LogText("failed to record intelligence check clear: %s", err.Error()))
		}
	}
	intelligenceCheckCacheMu.Lock()
	intelligenceCheckCache = map[string]intelligenceCheckCacheEntry{}
	intelligenceCheckCacheMu.Unlock()
	common.ApiSuccess(c, gin.H{"deleted": deleted})
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
	Group   string `json:"group"`
	Model   string `json:"model"`
	Enabled bool   `json:"enabled"`
	// CandyEnabled and PelicanEnabled say whether the group is asked each
	// question now; the dialog shows a question that is asked or has results.
	CandyEnabled   bool                    `json:"candy_enabled"`
	PelicanEnabled bool                    `json:"pelican_enabled"`
	Candy          []intelligenceCheckView `json:"candy"`
	Pelican        []intelligenceCheckView `json:"pelican"`
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
	target, _ := operation_setting.IntelligenceCheckTargetFor(group)
	data := &intelligenceCheckGroupData{
		Group:          group,
		Model:          target.Model,
		Enabled:        setting.Enabled,
		CandyEnabled:   setting.CandyEnabled && target.RunsCandy(),
		PelicanEnabled: setting.PelicanEnabled && target.RunsPelican(),
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

// A user's own check: the browser asks the question with the user's key
// through the normal API, so it is billed and logged as any other call. The
// server only serves the questions and grades the answer; the expected answer
// never leaves it.

// intelligenceUserTestMaxResponseBytes bounds the answer a user sends for
// grading. A drawing is far smaller; this only stops oversized bodies.
const intelligenceUserTestMaxResponseBytes = 1 << 20

type intelligenceUserTestQuestion struct {
	Key       string `json:"key"`
	Prompt    string `json:"prompt"`
	MaxTokens int    `json:"max_tokens"`
}

// GetIntelligenceUserTest serves the enabled questions and, for each model the
// user can call, the endpoints it supports, so the page picks Responses for
// models that only serve it. It does not depend on the pricing page being on.
func GetIntelligenceUserTest(c *gin.Context) {
	setting := operation_setting.GetIntelligenceCheckSetting()
	if !setting.UserTestEnabled {
		common.ApiErrorT(c, "Intelligence tests are turned off")
		return
	}
	questions := make([]intelligenceUserTestQuestion, 0, 2)
	if setting.PelicanEnabled {
		questions = append(questions, intelligenceUserTestQuestion{
			Key:       model.IntelligenceCheckPelican,
			Prompt:    setting.PelicanPrompt,
			MaxTokens: operation_setting.IntelligenceCheckMaxTokensOrDefault(setting.PelicanMaxTokens),
		})
	}
	if setting.CandyEnabled {
		prompt := setting.CandyPrompt
		if format := strings.TrimSpace(setting.CandyAnswerFormat); format != "" {
			prompt = strings.TrimRight(prompt, "\n") + "\n\n" + format
		}
		questions = append(questions, intelligenceUserTestQuestion{
			Key:       model.IntelligenceCheckCandy,
			Prompt:    prompt,
			MaxTokens: operation_setting.IntelligenceCheckMaxTokensOrDefault(setting.CandyMaxTokens),
		})
	}
	userGroup, err := model.GetUserGroup(c.GetInt("id"), false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// The models of each group the user can use, so the page lists a key's
	// models the same way the API serves them.
	groupModels := map[string][]string{}
	for group := range service.GetUserUsableGroups(userGroup) {
		if group != "auto" {
			groupModels[group] = model.GetGroupEnabledModels(group)
		}
	}
	// The endpoint table is rebuilt with the pricing cache; refresh it here so
	// it stays current while the pricing page is turned off.
	model.GetPricing()
	endpoints := map[string][]constant.EndpointType{}
	for _, models := range groupModels {
		for _, modelName := range models {
			if _, done := endpoints[modelName]; !done {
				endpoints[modelName] = model.GetModelSupportEndpointTypes(modelName)
			}
		}
	}
	common.ApiSuccess(c, gin.H{
		"questions":       questions,
		"user_group":      userGroup,
		"auto_groups":     service.GetUserAutoGroup(userGroup),
		"group_models":    groupModels,
		"model_endpoints": endpoints,
	})
}

type intelligenceUserTestGradeRequest struct {
	Question   string `json:"question"`
	Response   string `json:"response"`
	CutAtLimit bool   `json:"cut_at_limit"`
}

// GradeIntelligenceUserTest grades an answer with the scheduled checks'
// rules. The candy result carries the model's number, not the expected one.
func GradeIntelligenceUserTest(c *gin.Context) {
	setting := operation_setting.GetIntelligenceCheckSetting()
	if !setting.UserTestEnabled {
		common.ApiErrorT(c, "Intelligence tests are turned off")
		return
	}
	var req intelligenceUserTestGradeRequest
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, intelligenceUserTestMaxResponseBytes+4096))
	if err != nil || len(body) > intelligenceUserTestMaxResponseBytes+4096 || common.Unmarshal(body, &req) != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	answer := service.IntelligenceAnswerText(req.Response)
	result := intelligenceCheckView{FailedChecks: ""}
	var failed []string
	switch req.Question {
	case model.IntelligenceCheckCandy:
		if !setting.CandyEnabled {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		result.Status, result.Answer = service.GradeIntelligenceAnswer(answer, strings.TrimSpace(setting.CandyAnswer))
	case model.IntelligenceCheckPelican:
		if !setting.PelicanEnabled {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		result.Status, failed = service.GradeIntelligenceDrawing(answer)
	default:
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	// Say why an answer stopped short, as the scheduled checks do.
	if req.CutAtLimit && result.Status != model.IntelligenceCheckPassed {
		failed = append([]string{service.IntelligenceCheckTokenLimit}, failed...)
	}
	result.FailedChecks = strings.Join(failed, ",")
	result.Response, result.Truncated = service.TruncateIntelligenceResponse(answer)
	common.ApiSuccess(c, result)
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
