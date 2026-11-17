package service

import (
	"bytes"
	"encoding/binary"
	"errors"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/shirou/gopsutil/disk"
	"golang.org/x/image/vp8"
	"golang.org/x/image/vp8l"
	"golang.org/x/image/webp"
)

const SupportTicketImageMaxBytes = 3 << 20

var (
	ErrSupportImageType       = common.NewMessage("Only PNG, JPG and static WebP screenshots are allowed")
	ErrSupportImageSize       = common.NewMessage("Each screenshot must be no larger than 3 MB")
	ErrSupportImageData       = common.NewMessage("Invalid or unsupported screenshot")
	ErrSupportImageDimensions = common.NewMessage("Screenshots must be at most 8192 pixels per side and 16 megapixels")
	ErrSupportImageOutput     = common.NewMessage("The processed screenshot exceeds 3 MB; use a smaller image")
	ErrSupportImageBusy       = common.NewMessage("Screenshot processing is busy. Please try again")
	ErrSupportImageStorage    = common.NewMessage("Screenshot storage is unavailable. Please try again later")
	supportImageSlots         = make(chan struct{}, 2)
	supportImageWriteMu       sync.Mutex
)

// supportImageWriter 在编码过程中限制输出，避免为过大的重编码文件继续分配内存。
type supportImageWriter struct {
	bytes.Buffer
}

func (writer *supportImageWriter) Write(data []byte) (int, error) {
	if len(data) > SupportTicketImageMaxBytes-writer.Len() {
		return 0, ErrSupportImageOutput
	}
	return writer.Buffer.Write(data)
}

func openSupportImageRoot() (*os.Root, error) {
	directory := common.GetEnvOrDefaultString("SUPPORT_TICKET_FILE_DIR", "/data/support-tickets")
	if err := os.MkdirAll(directory, 0o750); err != nil {
		return nil, err
	}
	return os.OpenRoot(directory)
}

func validSupportImageKey(key string) bool {
	ext := filepath.Ext(key)
	if ext != ".png" && ext != ".jpg" {
		return false
	}
	name := strings.TrimSuffix(key, ext)
	if len(name) != 32 {
		return false
	}
	for _, char := range name {
		if !(char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9') {
			return false
		}
	}
	return true
}

// staticSupportScreenshot 拒绝 APNG 和动画 WebP；解码器只取首帧不能替代动画格式校验。
func staticSupportScreenshot(data []byte, format string) bool {
	if format == "jpeg" {
		return true
	}
	if format == "png" {
		if len(data) < 8 || string(data[:8]) != "\x89PNG\r\n\x1a\n" {
			return false
		}
		for offset := 8; offset <= len(data)-12; {
			length := uint64(binary.BigEndian.Uint32(data[offset : offset+4]))
			end := uint64(offset) + length + 12
			if end > uint64(len(data)) {
				return false
			}
			kind := string(data[offset+4 : offset+8])
			if kind == "acTL" || kind == "fcTL" || kind == "fdAT" {
				return false
			}
			if kind == "IEND" {
				return true
			}
			offset = int(end)
		}
		return false
	}
	return staticSupportWebP(data)
}

func validSupportScreenshotDimensions(width, height int) bool {
	return width > 0 && height > 0 && width <= 8192 && height <= 8192 && int64(width)*int64(height) <= 16_000_000
}

// staticSupportWebP 在完整解码前核对画布和内部帧，防止小画布包装大帧绕过内存限制。
func staticSupportWebP(data []byte) bool {
	if len(data) < 12 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
		return false
	}
	end := uint64(binary.LittleEndian.Uint32(data[4:8])) + 8
	if end != uint64(len(data)) || end < 12 || end%2 != 0 {
		return false
	}
	var (
		extended, frame, alpha, icc, exif, xmp bool
		flags                                  byte
		canvasWidth, canvasHeight              int
	)
	for offset := uint64(12); offset < end; {
		if end-offset < 8 {
			return false
		}
		kind := string(data[offset : offset+4])
		length := uint64(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))
		start := offset + 8
		next := start + length + length%2
		if next > end || (length%2 != 0 && data[start+length] != 0) {
			return false
		}
		chunk := data[start : start+length]
		// ALPH 必须直接属于随后唯一的有损帧，不能被另一块重置解码状态。
		if alpha && !frame && kind != "VP8 " {
			return false
		}
		switch kind {
		case "VP8X":
			if offset != 12 || extended || length != 10 || chunk[0]&0xc3 != 0 || chunk[1] != 0 || chunk[2] != 0 || chunk[3] != 0 {
				return false
			}
			extended, flags = true, chunk[0]
			canvasWidth = 1 + int(chunk[4]) + int(chunk[5])<<8 + int(chunk[6])<<16
			canvasHeight = 1 + int(chunk[7]) + int(chunk[8])<<8 + int(chunk[9])<<16
			if !validSupportScreenshotDimensions(canvasWidth, canvasHeight) {
				return false
			}
		case "ICCP":
			if !extended || flags&0x20 == 0 || icc || frame || alpha || length == 0 {
				return false
			}
			icc = true
		case "ALPH":
			if !extended || flags&0x10 == 0 || alpha || frame || length < 2 || chunk[0]&0xc0 != 0 || (chunk[0]>>4)&3 > 1 || chunk[0]&3 > 1 {
				return false
			}
			// 压缩透明度的 VP8L 尺寸由已校验画布合成，原始透明度须与像素数完全相等。
			if chunk[0]&3 == 0 && length != 1+uint64(canvasWidth)*uint64(canvasHeight) {
				return false
			}
			alpha = true
		case "VP8 ", "VP8L":
			if frame || (kind == "VP8L" && alpha) {
				return false
			}
			var width, height int
			if kind == "VP8 " {
				if extended && (flags&0x10 != 0) != alpha {
					return false
				}
				decoder := vp8.NewDecoder()
				decoder.Init(bytes.NewReader(chunk), len(chunk))
				header, err := decoder.DecodeFrameHeader()
				if err != nil || !header.KeyFrame || header.VersionNumber > 3 || !header.ShowFrame {
					return false
				}
				width, height = header.Width, header.Height
			} else {
				config, err := vp8l.DecodeConfig(bytes.NewReader(chunk))
				if err != nil {
					return false
				}
				width, height = config.Width, config.Height
			}
			if !validSupportScreenshotDimensions(width, height) || (extended && (width != canvasWidth || height != canvasHeight)) {
				return false
			}
			frame = true
		case "EXIF":
			if !extended || flags&0x08 == 0 || !frame || exif || xmp || length == 0 {
				return false
			}
			exif = true
		case "XMP ":
			if !extended || flags&0x04 == 0 || !frame || xmp || length == 0 {
				return false
			}
			xmp = true
		default:
			// 动画、未知扩展和多余帧均不进入解码器。
			return false
		}
		offset = next
	}
	return frame && (!extended || ((flags&0x20 != 0) == icc && (flags&0x08 != 0) == exif && (flags&0x04 != 0) == xmp))
}

// SaveSupportScreenshot 只保存白名单解码器重新编码的像素，原文件、附加数据和元数据都不落盘。
func SaveSupportScreenshot(originalName string, data []byte) (model.SupportTicketAttachment, error) {
	if len(data) == 0 || len(data) > SupportTicketImageMaxBytes {
		return model.SupportTicketAttachment{}, ErrSupportImageSize
	}
	if len(originalName) > 255 {
		return model.SupportTicketAttachment{}, ErrSupportImageType
	}
	ext := strings.ToLower(filepath.Ext(originalName))
	format := ""
	switch ext {
	case ".png":
		format = "png"
	case ".jpg", ".jpeg":
		format = "jpeg"
	case ".webp":
		format = "webp"
	default:
		return model.SupportTicketAttachment{}, ErrSupportImageType
	}
	if http.DetectContentType(data) != "image/"+format || !staticSupportScreenshot(data, format) {
		return model.SupportTicketAttachment{}, ErrSupportImageData
	}
	select {
	case supportImageSlots <- struct{}{}:
		defer func() { <-supportImageSlots }()
	default:
		return model.SupportTicketAttachment{}, ErrSupportImageBusy
	}
	var (
		config  image.Config
		decoded image.Image
		err     error
	)
	reader := bytes.NewReader(data)
	switch format {
	case "png":
		config, err = png.DecodeConfig(reader)
	case "jpeg":
		config, err = jpeg.DecodeConfig(reader)
	case "webp":
		config, err = webp.DecodeConfig(reader)
	}
	if err != nil {
		return model.SupportTicketAttachment{}, ErrSupportImageData
	}
	if !validSupportScreenshotDimensions(config.Width, config.Height) {
		return model.SupportTicketAttachment{}, ErrSupportImageDimensions
	}
	reader.Reset(data)
	switch format {
	case "png":
		decoded, err = png.Decode(reader)
	case "jpeg":
		decoded, err = jpeg.Decode(reader)
	case "webp":
		decoded, err = webp.Decode(reader)
	}
	if err != nil || decoded == nil || decoded.Bounds().Dx() != config.Width || decoded.Bounds().Dy() != config.Height {
		return model.SupportTicketAttachment{}, ErrSupportImageData
	}
	output := &supportImageWriter{}
	outputExt, outputMime := ".png", "image/png"
	if format == "jpeg" {
		outputExt, outputMime = ".jpg", "image/jpeg"
		err = jpeg.Encode(output, decoded, &jpeg.Options{Quality: 90})
	} else {
		err = png.Encode(output, decoded)
	}
	if err != nil {
		if errors.Is(err, ErrSupportImageOutput) {
			return model.SupportTicketAttachment{}, ErrSupportImageOutput
		}
		return model.SupportTicketAttachment{}, ErrSupportImageData
	}
	key, err := common.GenerateRandomCharsKey(32)
	if err != nil {
		return model.SupportTicketAttachment{}, err
	}
	key += outputExt
	root, err := openSupportImageRoot()
	if err != nil {
		return model.SupportTicketAttachment{}, err
	}
	defer root.Close()
	// 同进程的空间检查与写入串行执行，避免并发截图同时花掉预留空间。
	supportImageWriteMu.Lock()
	defer supportImageWriteMu.Unlock()
	minimumFree := uint64(1 << 30)
	if configured := strings.TrimSpace(os.Getenv("SUPPORT_TICKET_MIN_FREE_BYTES")); configured != "" {
		if value, parseErr := strconv.ParseUint(configured, 10, 64); parseErr == nil {
			minimumFree = value
		}
	}
	usage, err := disk.Usage(root.Name())
	if err != nil || usage == nil || usage.Free < minimumFree || uint64(output.Len()) > usage.Free-minimumFree {
		return model.SupportTicketAttachment{}, ErrSupportImageStorage
	}
	file, err := root.OpenFile(key, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o640)
	if err != nil {
		return model.SupportTicketAttachment{}, err
	}
	_, writeErr := file.Write(output.Bytes())
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		_ = root.Remove(key)
		return model.SupportTicketAttachment{}, errors.Join(writeErr, closeErr)
	}
	return model.SupportTicketAttachment{FileKey: key, Mime: outputMime, Size: int64(output.Len()), Width: config.Width, Height: config.Height}, nil
}

// RemoveUnreferencedSupportScreenshots 等待不确定的提交落定后再删文件，数据库不可用时保留待核对。
func RemoveUnreferencedSupportScreenshots(attachments []model.SupportTicketAttachment) {
	if len(attachments) == 0 {
		return
	}
	unreferenced, err := model.UnreferencedSupportScreenshots(attachments)
	if err != nil {
		common.SysError(common.LogText("failed to verify uncommitted support screenshots: %s", err.Error()))
		return
	}
	RemoveSupportScreenshots(unreferenced)
}

func RemoveSupportScreenshots(attachments []model.SupportTicketAttachment) {
	if len(attachments) == 0 {
		return
	}
	root, err := openSupportImageRoot()
	if err != nil {
		common.SysError(common.LogText("failed to open support screenshot storage: %s", err.Error()))
		return
	}
	defer root.Close()
	for i := range attachments {
		if !validSupportImageKey(attachments[i].FileKey) {
			continue
		}
		if err := root.Remove(attachments[i].FileKey); err != nil && !errors.Is(err, os.ErrNotExist) {
			common.SysError(common.LogText("failed to remove uncommitted support screenshot: %s", err.Error()))
		}
	}
}

func OpenSupportScreenshot(key string) (io.ReadCloser, int64, error) {
	if !validSupportImageKey(key) {
		return nil, 0, os.ErrNotExist
	}
	root, err := openSupportImageRoot()
	if err != nil {
		return nil, 0, err
	}
	defer root.Close()
	file, err := root.Open(key)
	if err != nil {
		return nil, 0, err
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > SupportTicketImageMaxBytes {
		_ = file.Close()
		return nil, 0, os.ErrNotExist
	}
	return file, info.Size(), nil
}
