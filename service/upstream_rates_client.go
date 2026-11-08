package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

type upstreamRateAPIKey struct {
	ID          int    `json:"api_key_id"`
	Fingerprint string `json:"fingerprint"`
}

type upstreamRateGroup struct {
	ID        int                  `json:"group_id,omitempty"`
	Name      string               `json:"group_name"`
	Ratio     *float64             `json:"ratio"`
	UpdatedAt string               `json:"updated_at"`
	Keys      []upstreamRateAPIKey `json:"api_keys"`
}

type upstreamRateRemoteChannel struct {
	ID                 int                 `json:"channel_id"`
	Name               string              `json:"channel_name"`
	Type               string              `json:"channel_type"`
	SiteURL            string              `json:"site_url"`
	OnlyWithKeys       bool                `json:"only_with_keys"`
	Algorithm          string              `json:"key_fingerprint_algorithm"`
	Normalization      string              `json:"key_fingerprint_normalization"`
	Complete           *bool               `json:"key_fingerprints_complete"`
	KeySyncedAt        string              `json:"key_synced_at"`
	KeySyncAttemptedAt string              `json:"key_sync_attempted_at"`
	Status             string              `json:"key_sync_status"`
	UnavailableIDs     []int               `json:"unavailable_api_key_ids"`
	Groups             []upstreamRateGroup `json:"groups"`
}

type UpstreamRateChange struct {
	From float64 `json:"from"`
	To   float64 `json:"to"`
	At   int64   `json:"at"`
}

type upstreamRateHistory struct {
	Ratio       float64             `json:"ratio"`
	CollectedAt int64               `json:"collected_at"`
	Change      *UpstreamRateChange `json:"change,omitempty"`
}

type upstreamRateKnownMatch struct {
	GroupID       int                 `json:"group_id"`
	GroupName     string              `json:"group_name"`
	Ratio         float64             `json:"ratio"`
	CollectedAt   int64               `json:"collected_at"`
	KeySyncedAt   int64               `json:"key_synced_at"`
	Normalization string              `json:"normalization"`
	Change        *UpstreamRateChange `json:"change,omitempty"`
	MovedFrom     string              `json:"moved_from,omitempty"`
	MovedAt       int64               `json:"moved_at,omitempty"`
}

type upstreamRateRecord struct {
	Data    upstreamRateRemoteChannel         `json:"data"`
	ReadAt  int64                             `json:"read_at"`
	Error   string                            `json:"error"`
	History map[string]upstreamRateHistory    `json:"history"`
	Known   map[string]upstreamRateKnownMatch `json:"known"`
}

type upstreamRateSnapshot struct {
	Revision      string                     `json:"revision"`
	AttemptAt     int64                      `json:"attempt_at"`
	ReadAt        int64                      `json:"read_at"`
	Error         string                     `json:"error"`
	Complete      bool                       `json:"complete"`
	Channels      map[int]upstreamRateRecord `json:"channels"`
	ForceAttempts map[int]int64              `json:"force_attempts"`
}

func loadUpstreamRateSnapshot(ctx context.Context, source upstreamRateSource) (upstreamRateSnapshot, error) {
	snapshot := upstreamRateSnapshot{}
	raw, err := model.ReadUpstreamRatesState(ctx, "snapshot."+source.ID)
	if err == nil && raw != "" {
		err = common.UnmarshalJsonStr(raw, &snapshot)
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
	return snapshot, err
}

func upstreamRateGroupIdentity(groupID int, name string) string {
	if groupID > 0 {
		return "id:" + strconv.Itoa(groupID)
	}
	return "name:" + name
}

// upstreamRateFingerprint 必须遵循来源声明的规则，不能根据本地渠道类型猜测。
func upstreamRateFingerprint(raw, normalization string) (string, error) {
	value := strings.TrimSpace(raw)
	switch normalization {
	case "trim":
	case "trim_strip_sk_prefix":
		value = strings.TrimPrefix(value, "sk-")
	default:
		return "", errors.New("unsupported_protocol")
	}
	if value == "" {
		return "", errors.New("unsupported_credential")
	}
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:]), nil
}

func validUpstreamRateFingerprint(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, ch := range value {
		if !(ch >= '0' && ch <= '9') && !(ch >= 'a' && ch <= 'f') {
			return false
		}
	}
	return true
}

func validUpstreamRateGroup(group upstreamRateGroup, now int64) bool {
	at := upstreamRateTimestamp(group.UpdatedAt)
	return group.Name != "" && group.Ratio != nil && !math.IsNaN(*group.Ratio) && !math.IsInf(*group.Ratio, 0) && *group.Ratio >= 0 && at > 0 && at <= now+60
}

func upstreamRateSourceToken(source upstreamRateSource) (string, error) {
	if source.TokenCiphertext == "" {
		if source.TokenPlaintext == "" {
			return "", errors.New("credential_unavailable")
		}
		return source.TokenPlaintext, nil
	}
	aead, err := upstreamRateCipher()
	if err != nil {
		return "", err
	}
	sealed, err := base64.StdEncoding.DecodeString(source.TokenCiphertext)
	if err != nil || len(sealed) < aead.NonceSize() {
		return "", errors.New("credential_unavailable")
	}
	plaintext, err := aead.Open(nil, sealed[:aead.NonceSize()], sealed[aead.NonceSize():], []byte(source.ID))
	if err != nil {
		return "", errors.New("credential_unavailable")
	}
	return string(plaintext), nil
}

func fetchUpstreamRateChannels(ctx context.Context, source upstreamRateSource, channelID int, force bool) ([]upstreamRateRemoteChannel, map[int]string, bool, error) {
	token, err := upstreamRateSourceToken(source)
	if err != nil {
		return nil, nil, false, errors.New("credential_unavailable")
	}
	endpoint := source.BaseURL + "/api/external/v1/channel-rates"
	timeout := 40 * time.Second
	if channelID > 0 {
		endpoint = fmt.Sprintf("%s/api/external/v1/channels/%d/group-rates", source.BaseURL, channelID)
	}
	if force {
		endpoint += "?force_refresh=1"
		timeout = 120 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, nil, false, errors.New("invalid_configuration")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	// 复用受保护拨号器并固定公共 HTTPS 目标，禁用代理、重定向和不安全 TLS。
	protection := &common.SSRFProtection{AllowedPorts: []int{443}, ApplyIPFilterForDomain: true}
	dialer := &net.Dialer{Timeout: 15 * time.Second}
	protectedDialer := &protectedFetchDialer{resolver: net.DefaultResolver, dialContext: dialer.DialContext, getProtection: func() (*common.SSRFProtection, bool, error) { return protection, true, nil }}
	transport := &http.Transport{DialContext: protectedDialer.DialContext, TLSHandshakeTimeout: 15 * time.Second, ResponseHeaderTimeout: timeout, ForceAttemptHTTP2: true}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: timeout, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, nil, false, errors.New("timeout")
		}
		return nil, nil, false, errors.New("request_failed")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		code := "request_failed"
		switch response.StatusCode {
		case 400:
			code = "invalid_configuration"
		case 401:
			code = "unauthorized"
		case 403:
			code = "channel_forbidden"
		case 404:
			code = "not_found"
		case 429:
			code = "rate_limited"
		case 502:
			code = "refresh_failed"
		case 503:
			code = "api_unavailable"
		}
		return nil, nil, false, errors.New(code)
	}
	const maxResponse = 8 << 20
	body, err := io.ReadAll(io.LimitReader(response.Body, maxResponse+1))
	if err != nil || len(body) > maxResponse {
		return nil, nil, false, errors.New("invalid_response")
	}
	var envelope struct {
		Success bool            `json:"success"`
		Data    json.RawMessage `json:"data"`
	}
	if err := common.Unmarshal(body, &envelope); err != nil || !envelope.Success {
		return nil, nil, false, errors.New("invalid_response")
	}
	channels := []upstreamRateRemoteChannel{}
	channelErrors := map[int]string{}
	complete := false
	if channelID > 0 {
		var channel upstreamRateRemoteChannel
		if err := common.Unmarshal(envelope.Data, &channel); err != nil || channel.ID != channelID {
			return nil, nil, false, errors.New("invalid_response")
		}
		channels = append(channels, channel)
		complete = channel.Status == "ready" && channel.Complete != nil && *channel.Complete && len(channel.UnavailableIDs) == 0
	} else {
		var data struct {
			Complete *bool                       `json:"complete"`
			Channels []upstreamRateRemoteChannel `json:"channels"`
			Errors   []struct {
				ChannelID int    `json:"channel_id"`
				Code      string `json:"code"`
			} `json:"errors"`
		}
		if err := common.Unmarshal(envelope.Data, &data); err != nil || data.Complete == nil || data.Channels == nil {
			return nil, nil, false, errors.New("unsupported_protocol")
		}
		channels, complete = data.Channels, *data.Complete
		for _, item := range data.Errors {
			channelErrors[item.ChannelID] = "channel_unavailable"
		}
	}
	seen := map[int]bool{}
	if len(channelErrors) > 0 {
		complete = false
	}
	for i := range channels {
		channel := &channels[i]
		if channel.ID <= 0 || seen[channel.ID] {
			return nil, nil, false, errors.New("invalid_response")
		}
		seen[channel.ID] = true
		if channel.Status != "ready" || channel.Complete == nil || !*channel.Complete || len(channel.UnavailableIDs) != 0 || channel.Algorithm != "sha256" || (channel.Normalization != "trim" && channel.Normalization != "trim_strip_sk_prefix") {
			complete = false
		}
		if site, err := url.Parse(channel.SiteURL); err == nil {
			site.User = nil
			site.RawQuery = ""
			site.Fragment = ""
			channel.SiteURL = site.String()
		} else {
			channel.SiteURL = ""
		}
	}
	return channels, channelErrors, complete, nil
}
