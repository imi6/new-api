package operation_setting

import (
	"errors"
	"strconv"
	"strings"
	"unicode/utf8"
)

const DefaultAutomaticDisableExclusions = "403 | Image generation is not enabled for this group"

type ChannelDisableExclusion struct {
	// 0 表示不限状态码，只按上游错误消息中的关键词匹配。
	StatusCode int
	Message    string
}

var errInvalidAutomaticDisableExclusions = errors.New("Invalid auto-disable exclusions. Use one rule per line: keyword or status code | keyword; up to 100 rules and 1000 characters per keyword.")

// ParseAutomaticDisableExclusions 接受单独关键词或状态码与关键词组合；空配置表示没有排除规则。
func ParseAutomaticDisableExclusions(raw string) ([]ChannelDisableExclusion, error) {
	rules := make([]ChannelDisableExclusion, 0)
	for line := range strings.SplitSeq(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		code, message, found := strings.Cut(line, "|")
		status := 0
		if found {
			code = strings.TrimSpace(code)
			parsedStatus, err := strconv.Atoi(code)
			if len(code) != 3 || err != nil || parsedStatus < 100 || parsedStatus > 599 {
				return nil, errInvalidAutomaticDisableExclusions
			}
			status = parsedStatus
		} else {
			message = line
		}
		message = strings.TrimSpace(message)
		if message == "" || len(rules) >= 100 || utf8.RuneCountInString(message) > 1000 {
			return nil, errInvalidAutomaticDisableExclusions
		}
		rules = append(rules, ChannelDisableExclusion{StatusCode: status, Message: strings.ToLower(message)})
	}
	return rules, nil
}
