package operation_setting

import (
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

// IntelligenceCheckTarget names the model checked in one group and the
// questions it is asked. A group appears at most once. A question left unset
// is asked, so targets saved before the choice existed keep both.
type IntelligenceCheckTarget struct {
	Group   string `json:"group"`
	Model   string `json:"model"`
	Candy   *bool  `json:"candy,omitempty"`
	Pelican *bool  `json:"pelican,omitempty"`
}

// RunsCandy reports whether the group is asked the candy question.
func (t IntelligenceCheckTarget) RunsCandy() bool { return t.Candy == nil || *t.Candy }

// RunsPelican reports whether the group is asked for the pelican drawing.
func (t IntelligenceCheckTarget) RunsPelican() bool { return t.Pelican == nil || *t.Pelican }

// IntelligenceCheckSetting holds the scheduled "dumbed-down model" checks
// shown on the channel status page. They are stored as
// intelligence_check_setting.<json key> options.
type IntelligenceCheckSetting struct {
	Enabled bool                      `json:"enabled"`
	Targets []IntelligenceCheckTarget `json:"targets"`

	CandyEnabled       bool   `json:"candy_enabled"`
	CandyIntervalHours int    `json:"candy_interval_hours"`
	CandyPrompt        string `json:"candy_prompt"`
	CandyAnswer        string `json:"candy_answer"`
	CandyAnswerFormat  string `json:"candy_answer_format"`
	CandyMaxTokens     int    `json:"candy_max_tokens"`

	PelicanEnabled       bool   `json:"pelican_enabled"`
	PelicanIntervalHours int    `json:"pelican_interval_hours"`
	PelicanPrompt        string `json:"pelican_prompt"`
	PelicanMaxTokens     int    `json:"pelican_max_tokens"`
}

const (
	intelligenceCheckOptionScope = "intelligence_check_setting."

	IntelligenceCheckMinIntervalHours = 1
	IntelligenceCheckMaxIntervalHours = 168
	IntelligenceCheckMinMaxTokens     = 256
	IntelligenceCheckMaxMaxTokens     = 65536
	IntelligenceCheckMaxTargets       = 50
	IntelligenceCheckMaxPromptLength  = 8000
	IntelligenceCheckMaxAnswerLength  = 64

	defaultCandyIntervalHours   = 6
	defaultCandyMaxTokens       = 8192
	defaultPelicanIntervalHours = 24
	// A thinking model spends part of the limit before writing the page.
	defaultPelicanMaxTokens = 32000

	// DefaultCandyAnswer is the answer to DefaultCandyPrompt: draw 9 round and
	// 12 star candies, since shape can be told apart by touch.
	DefaultCandyAnswer       = "21"
	DefaultCandyAnswerFormat = "请在回答的最后单独一行写：最终答案：数字"
	DefaultCandyPrompt       = `在一个不透明的袋子中有三种口味、两种形状的糖果，数量分布如下：

圆形：苹果味 7 颗、桃子味 9 颗、西瓜味 8 颗

五角星形：苹果味 7 颗、桃子味 6 颗、西瓜味 4 颗

参赛者只能靠手感分辨形状，无法分辨口味。请问：至少要摸出多少颗糖果，才能保证手中同时拥有不同形状的"苹果味"与"桃子味"糖果？（即满足以下任一组合即可：① 圆形苹果味 + 五角星桃子味；② 五角星苹果味 + 圆形桃子味）。

要求：给出计算步骤并标明最终数字。`
	DefaultPelicanPrompt = `请生成可直接运行的单文件HTML，使用内联SVG绘制鹈鹕骑自行车的二维循环动画。画面以鹈鹕和自行车为主体，展示清晰的身体结构、踩踏动作和车轮转动，配合协调的背景、配色与层次。动画应流畅自然、衔接连续，并适配不同屏幕尺寸。禁止依赖外部资源，只输出完整HTML，不要代码围栏或解释文字。`
)

var intelligenceCheckSetting = IntelligenceCheckSetting{
	Enabled:              false,
	Targets:              []IntelligenceCheckTarget{},
	CandyEnabled:         true,
	CandyIntervalHours:   defaultCandyIntervalHours,
	CandyPrompt:          DefaultCandyPrompt,
	CandyAnswer:          DefaultCandyAnswer,
	CandyAnswerFormat:    DefaultCandyAnswerFormat,
	CandyMaxTokens:       defaultCandyMaxTokens,
	PelicanEnabled:       true,
	PelicanIntervalHours: defaultPelicanIntervalHours,
	PelicanPrompt:        DefaultPelicanPrompt,
	PelicanMaxTokens:     defaultPelicanMaxTokens,
}

func init() {
	config.GlobalConfig.Register("intelligence_check_setting", &intelligenceCheckSetting)
}

func GetIntelligenceCheckSetting() *IntelligenceCheckSetting {
	return &intelligenceCheckSetting
}

// IntelligenceCheckTargetFor returns the check settings of the group, if it
// is checked.
func IntelligenceCheckTargetFor(group string) (IntelligenceCheckTarget, bool) {
	for _, target := range intelligenceCheckSetting.Targets {
		if target.Group == group {
			return target, true
		}
	}
	return IntelligenceCheckTarget{}, false
}

// IntelligenceCheckTargetModel returns the model checked in the group, or
// empty when the group is not checked.
func IntelligenceCheckTargetModel(group string) string {
	target, _ := IntelligenceCheckTargetFor(group)
	return target.Model
}

// IntelligenceCheckInterval clamps a stored interval to the allowed range.
func IntelligenceCheckInterval(hours int) int {
	return min(max(hours, IntelligenceCheckMinIntervalHours), IntelligenceCheckMaxIntervalHours)
}

// IntelligenceCheckMaxTokensOrDefault clamps a stored output limit.
func IntelligenceCheckMaxTokensOrDefault(tokens int) int {
	return min(max(tokens, IntelligenceCheckMinMaxTokens), IntelligenceCheckMaxMaxTokens)
}

// ValidateIntelligenceCheckSettingOption checks one
// intelligence_check_setting.* option before it is saved. Keys outside these
// settings are accepted unchanged.
func ValidateIntelligenceCheckSettingOption(key, value string) error {
	field, ok := strings.CutPrefix(key, intelligenceCheckOptionScope)
	if !ok {
		return nil
	}
	switch field {
	case "enabled", "candy_enabled", "pelican_enabled":
		if _, err := strconv.ParseBool(strings.TrimSpace(value)); err != nil {
			return common.NewMessage("Invalid parameters")
		}
	case "candy_interval_hours", "pelican_interval_hours":
		return validateIntelligenceIntOption(value, IntelligenceCheckMinIntervalHours, IntelligenceCheckMaxIntervalHours)
	case "candy_max_tokens", "pelican_max_tokens":
		return validateIntelligenceIntOption(value, IntelligenceCheckMinMaxTokens, IntelligenceCheckMaxMaxTokens)
	case "candy_prompt", "pelican_prompt":
		if strings.TrimSpace(value) == "" {
			return common.NewMessage("Enter the question")
		}
		if utf8.RuneCountInString(value) > IntelligenceCheckMaxPromptLength {
			return common.NewMessage("The question can have at most {{max}} characters", map[string]any{"max": IntelligenceCheckMaxPromptLength})
		}
	case "candy_answer":
		answer := strings.TrimSpace(value)
		if answer == "" {
			return common.NewMessage("Enter the expected answer")
		}
		if utf8.RuneCountInString(answer) > IntelligenceCheckMaxAnswerLength {
			return common.NewMessage("The expected answer can have at most {{max}} characters", map[string]any{"max": IntelligenceCheckMaxAnswerLength})
		}
	case "candy_answer_format":
		if utf8.RuneCountInString(value) > IntelligenceCheckMaxPromptLength {
			return common.NewMessage("The answer format can have at most {{max}} characters", map[string]any{"max": IntelligenceCheckMaxPromptLength})
		}
	case "targets":
		var targets []IntelligenceCheckTarget
		if err := common.UnmarshalJsonStr(value, &targets); err != nil {
			return common.NewMessage("Invalid parameters")
		}
		if len(targets) > IntelligenceCheckMaxTargets {
			return common.NewMessage("Check at most {{max}} groups", map[string]any{"max": IntelligenceCheckMaxTargets})
		}
		seen := map[string]bool{}
		for _, target := range targets {
			if strings.TrimSpace(target.Group) == "" || strings.TrimSpace(target.Model) == "" {
				return common.NewMessage("Choose a group and a model for every row")
			}
			if seen[target.Group] {
				return common.NewMessage("Each group can be checked only once")
			}
			if !target.RunsCandy() && !target.RunsPelican() {
				return common.NewMessage("Choose at least one question for every group")
			}
			seen[target.Group] = true
		}
	default:
		return common.NewMessage("Invalid parameters")
	}
	return nil
}

func validateIntelligenceIntOption(value string, low, high int) error {
	number, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || number < low || number > high {
		return invoiceRangeError(low, high)
	}
	return nil
}
