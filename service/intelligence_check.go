package service

import (
	"bytes"
	"math/big"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// Grading for the scheduled intelligence checks. A logic question is passed
// when the stated final answer equals the expected one; a drawing question
// has no single answer, so it is passed when the page it returns is
// complete, self-contained and animated.

var finalAnswerPattern = regexp.MustCompile(`(?i)(?:最终答案|final\s*answer)\s*[:：]\s*\**\s*([-+]?[0-9][0-9,]*(?:\.[0-9]+)?|[^\s*]+)`)

// GradeIntelligenceAnswer extracts the last stated final answer and compares
// it with the expected one: numerically when both are numbers, otherwise as
// trimmed text.
func GradeIntelligenceAnswer(answerText, expected string) (status string, answer string) {
	matches := finalAnswerPattern.FindAllStringSubmatch(answerText, -1)
	if len(matches) == 0 {
		return model.IntelligenceCheckUndetermined, ""
	}
	answer = strings.TrimSpace(matches[len(matches)-1][1])
	expected = strings.TrimSpace(expected)
	if sameIntelligenceAnswer(answer, expected) {
		return model.IntelligenceCheckPassed, answer
	}
	return model.IntelligenceCheckFailed, answer
}

func sameIntelligenceAnswer(answer, expected string) bool {
	a, okA := new(big.Rat).SetString(strings.ReplaceAll(answer, ",", ""))
	e, okE := new(big.Rat).SetString(strings.ReplaceAll(expected, ",", ""))
	if okA && okE {
		return a.Cmp(e) == 0
	}
	return strings.EqualFold(answer, expected)
}

// Names of the drawing checks, as stored in failed_checks.
const (
	DrawingCheckComplete = "incomplete"
	DrawingCheckSVG      = "no_svg"
	DrawingCheckAnimated = "no_animation"
	DrawingCheckExternal = "external_resource"
	DrawingCheckFormat   = "extra_text"
)

var (
	drawingAnimationPattern = regexp.MustCompile(`(?i)<animate|<animateTransform|<animateMotion|@keyframes|animation\s*:|requestAnimationFrame`)
	drawingExternalPattern  = regexp.MustCompile(`(?i)(?:src|href)\s*=\s*["']?\s*(?:https?:)?//|@import\s|url\(\s*["']?\s*(?:https?:)?//`)
)

// GradeIntelligenceDrawing checks the page a drawing question returned and
// lists the checks it failed.
func GradeIntelligenceDrawing(answerText string) (status string, failed []string) {
	text := strings.TrimSpace(answerText)
	if strings.Contains(text, "```") {
		failed = append(failed, DrawingCheckFormat)
	}
	lower := strings.ToLower(text)
	start := strings.Index(lower, "<!doctype html")
	if start < 0 {
		start = strings.Index(lower, "<html")
	}
	end := strings.LastIndex(lower, "</html>")
	if start < 0 || end < start {
		failed = append(failed, DrawingCheckComplete)
	} else if !slices.Contains(failed, DrawingCheckFormat) {
		before := strings.TrimSpace(text[:start])
		after := strings.TrimSpace(text[end+len("</html>"):])
		if before != "" || after != "" {
			failed = append(failed, DrawingCheckFormat)
		}
	}
	if !strings.Contains(lower, "<svg") {
		failed = append(failed, DrawingCheckSVG)
	}
	if !drawingAnimationPattern.MatchString(text) {
		failed = append(failed, DrawingCheckAnimated)
	}
	if drawingExternalPattern.MatchString(text) {
		failed = append(failed, DrawingCheckExternal)
	}
	if len(failed) > 0 {
		return model.IntelligenceCheckFailed, failed
	}
	return model.IntelligenceCheckPassed, nil
}

// TruncateIntelligenceResponse cuts an answer to the stored byte limit on a
// character boundary.
func TruncateIntelligenceResponse(text string) (string, bool) {
	if len(text) <= model.IntelligenceCheckMaxResponseBytes {
		return text, false
	}
	cut := model.IntelligenceCheckMaxResponseBytes
	for cut > 0 && !utf8.RuneStart(text[cut]) {
		cut--
	}
	return text[:cut], true
}

// IntelligenceAnswerFromStream joins the answer text of a client-facing
// stream: Chat Completions content deltas or Responses output_text deltas.
// Reasoning text is left out.
func IntelligenceAnswerFromStream(body []byte) string {
	var answer strings.Builder
	for line := range bytes.SplitSeq(body, []byte{'\n'}) {
		line = bytes.TrimSpace(line)
		payload, ok := bytes.CutPrefix(line, []byte("data:"))
		if !ok {
			continue
		}
		payload = bytes.TrimSpace(payload)
		if len(payload) == 0 || bytes.Equal(payload, []byte("[DONE]")) {
			continue
		}
		var event struct {
			Type    string `json:"type"`
			Delta   any    `json:"delta"`
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
			} `json:"choices"`
		}
		if err := common.Unmarshal(payload, &event); err != nil {
			continue
		}
		if event.Type == "response.output_text.delta" {
			if delta, ok := event.Delta.(string); ok {
				answer.WriteString(delta)
			}
			continue
		}
		for _, choice := range event.Choices {
			answer.WriteString(choice.Delta.Content)
			answer.WriteString(choice.Message.Content)
		}
	}
	return answer.String()
}
