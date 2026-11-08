package service

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/url"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

const upstreamRatesTaskType = "upstream_rates"

var (
	ErrUpstreamRateConfig     = errors.New("Invalid upstream rate configuration")
	ErrUpstreamRateEncryption = errors.New("Set CRYPTO_SECRET or SESSION_SECRET before saving upstream rate credentials")
	ErrUpstreamRateBusy       = errors.New("An upstream rate refresh is already running")
	ErrUpstreamRateCooldown   = errors.New("Wait 60 seconds before forcing another upstream refresh")
)

type UpstreamRateSourceInput struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	BaseURL     string `json:"base_url"`
	Token       string `json:"token"`
	Enabled     bool   `json:"enabled"`
	PollSeconds int    `json:"poll_seconds"`
	ScanMinutes int    `json:"scan_minutes"`
}

type upstreamRateSource struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	BaseURL         string `json:"base_url"`
	TokenCiphertext string `json:"token_ciphertext"`
	Enabled         bool   `json:"enabled"`
	PollSeconds     int    `json:"poll_seconds"`
	ScanMinutes     int    `json:"scan_minutes"`
	Revision        string `json:"revision"`
}

type upstreamRateConfig struct {
	Sources []upstreamRateSource `json:"sources"`
}

type UpstreamRateSourceView struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	BaseURL         string `json:"base_url"`
	Enabled         bool   `json:"enabled"`
	TokenConfigured bool   `json:"token_configured"`
	PollSeconds     int    `json:"poll_seconds"`
	ScanMinutes     int    `json:"scan_minutes"`
	ReadAt          int64  `json:"read_at"`
	Error           string `json:"error"`
	Complete        bool   `json:"complete"`
}

type UpstreamRateConfigView struct {
	Sources         []UpstreamRateSourceView `json:"sources"`
	EncryptionReady bool                     `json:"encryption_ready"`
}

func loadUpstreamRateConfig(ctx context.Context) (upstreamRateConfig, error) {
	config := upstreamRateConfig{Sources: []upstreamRateSource{}}
	raw, err := model.ReadUpstreamRatesState(ctx, "config")
	if err == nil && raw != "" {
		err = common.UnmarshalJsonStr(raw, &config)
	}
	return config, err
}

func upstreamRateEncryptionReady() bool {
	return os.Getenv("CRYPTO_SECRET") != "" || os.Getenv("SESSION_SECRET") != ""
}

// upstreamRateCipher 只使用已配置的稳定密钥，避免重启后无法解密。
func upstreamRateCipher() (cipher.AEAD, error) {
	if !upstreamRateEncryptionReady() {
		return nil, ErrUpstreamRateEncryption
	}
	key := sha256.Sum256([]byte("new-api/upstream-rates/v1\x00" + common.CryptoSecret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func GetUpstreamRateConfig(ctx context.Context) (*UpstreamRateConfigView, error) {
	config, err := loadUpstreamRateConfig(ctx)
	if err != nil {
		return nil, err
	}
	view := &UpstreamRateConfigView{Sources: []UpstreamRateSourceView{}, EncryptionReady: upstreamRateEncryptionReady()}
	for _, source := range config.Sources {
		snapshot, err := loadUpstreamRateSnapshot(ctx, source)
		if err != nil {
			return nil, err
		}
		item := UpstreamRateSourceView{ID: source.ID, Name: source.Name, BaseURL: source.BaseURL, Enabled: source.Enabled, TokenConfigured: source.TokenCiphertext != "", PollSeconds: source.PollSeconds, ScanMinutes: source.ScanMinutes, ReadAt: snapshot.ReadAt, Error: snapshot.Error, Complete: snapshot.Complete}
		view.Sources = append(view.Sources, item)
	}
	return view, nil
}

func SaveUpstreamRateSource(ctx context.Context, input UpstreamRateSourceInput) error {
	input.Name = strings.TrimSpace(input.Name)
	input.BaseURL = strings.TrimRight(strings.TrimSpace(input.BaseURL), "/")
	u, err := url.Parse(input.BaseURL)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || (u.Port() != "" && u.Port() != "443") || len(input.Name) < 1 || utf8.RuneCountInString(input.Name) > 80 || len(input.BaseURL) > 1024 {
		return ErrUpstreamRateConfig
	}
	if input.PollSeconds < 30 || input.PollSeconds > 3600 || input.ScanMinutes < 1 || input.ScanMinutes > 1440 {
		return ErrUpstreamRateConfig
	}
	if input.Token != "" {
		if len(input.Token) < 32 || len(input.Token) > 4096 {
			return ErrUpstreamRateConfig
		}
		for _, ch := range []byte(input.Token) {
			if ch < 33 || ch > 126 {
				return ErrUpstreamRateConfig
			}
		}
	}
	return model.MutateUpstreamRatesState(ctx, "config", func(raw string) (string, error) {
		var config upstreamRateConfig
		if err := common.UnmarshalJsonStr(raw, &config); err != nil {
			return "", err
		}
		index := -1
		for i := range config.Sources {
			if config.Sources[i].ID == input.ID {
				index = i
				break
			}
		}
		if input.ID != "" && index < 0 {
			return "", ErrUpstreamRateConfig
		}
		if index < 0 && len(config.Sources) >= 20 {
			return "", ErrUpstreamRateConfig
		}
		source := upstreamRateSource{}
		if index >= 0 {
			source = config.Sources[index]
		}
		if source.ID == "" {
			id, err := common.GenerateRandomCharsKey(16)
			if err != nil {
				return "", err
			}
			source.ID = id
		}
		if (source.BaseURL != "" && source.BaseURL != input.BaseURL && input.Token == "") || (source.TokenCiphertext == "" && input.Token == "") {
			return "", ErrUpstreamRateConfig
		}
		changed := source.BaseURL != input.BaseURL || input.Token != "" || source.Enabled != input.Enabled
		if input.Token != "" {
			aead, err := upstreamRateCipher()
			if err != nil {
				return "", err
			}
			nonce := make([]byte, aead.NonceSize())
			if _, err := rand.Read(nonce); err != nil {
				return "", err
			}
			sealed := aead.Seal(nonce, nonce, []byte(input.Token), []byte(source.ID))
			source.TokenCiphertext = base64.StdEncoding.EncodeToString(sealed)
		}
		if changed || source.Revision == "" {
			revision, err := common.GenerateRandomCharsKey(16)
			if err != nil {
				return "", err
			}
			source.Revision = revision
		}
		source.Name, source.BaseURL, source.Enabled = input.Name, input.BaseURL, input.Enabled
		source.PollSeconds, source.ScanMinutes = input.PollSeconds, input.ScanMinutes
		if index < 0 {
			config.Sources = append(config.Sources, source)
		} else {
			config.Sources[index] = source
		}
		encoded, err := common.Marshal(config)
		return string(encoded), err
	})
}

func DeleteUpstreamRateSource(ctx context.Context, id string) error {
	return model.MutateUpstreamRatesState(ctx, "config", func(raw string) (string, error) {
		var config upstreamRateConfig
		if err := common.UnmarshalJsonStr(raw, &config); err != nil {
			return "", err
		}
		for i := range config.Sources {
			if config.Sources[i].ID == id {
				config.Sources = append(config.Sources[:i], config.Sources[i+1:]...)
				break
			}
		}
		encoded, err := common.Marshal(config)
		return string(encoded), err
	})
}

func upstreamRateTimestamp(value string) int64 {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return 0
	}
	return parsed.Unix()
}
