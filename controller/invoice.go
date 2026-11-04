package controller

import (
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"

	"github.com/Calcium-Ion/go-epay/epay"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

// invoicePayMethods lists the Epay methods offered for tax payment: the same
// methods top-up offers, without Stripe, Creem, Waffo, hidden methods, and
// methods whose Epay site is not configured.
func invoicePayMethods() []map[string]string {
	methods := make([]map[string]string, 0)
	if !operation_setting.IsPaymentComplianceConfirmed() {
		return methods
	}
	for _, method := range operation_setting.PayMethods {
		switch method["type"] {
		case model.PaymentMethodStripe, model.PaymentMethodCreem, model.PaymentMethodWaffo, model.PaymentMethodWaffoPancake:
			continue
		}
		if operation_setting.PayMethodHidden(method) {
			continue
		}
		if !operation_setting.EpayConfigured(operation_setting.NormalizeEpayGateway(method["gateway"])) {
			continue
		}
		methods = append(methods, map[string]string{
			"name":    method["name"],
			"type":    method["type"],
			"color":   method["color"],
			"gateway": operation_setting.NormalizeEpayGateway(method["gateway"]),
		})
	}
	return methods
}

func invoiceIdParam(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return 0, false
	}
	return id, true
}

func GetInvoiceConfig(c *gin.Context) {
	setting := operation_setting.GetInvoiceSetting()
	common.ApiSuccess(c, gin.H{
		"enabled":         setting.Enabled,
		"tax_rate":        operation_setting.InvoiceTaxRate(),
		"order_days":      operation_setting.InvoiceOrderDays(),
		"categories":      operation_setting.InvoiceCategories(),
		"special_enabled": setting.SpecialEnabled,
		"payment_timeout": operation_setting.InvoicePaymentTimeoutMinutes(),
		"max_orders":      model.InvoiceMaxOrders,
		"pay_methods":     invoicePayMethods(),
	})
}

func GetInvoiceSummary(c *gin.Context) {
	model.ExpireStaleInvoices()
	summary, err := model.GetInvoiceSummary(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, summary)
}

func GetInvoiceableOrders(c *gin.Context) {
	model.ExpireStaleInvoices()
	orders, err := model.ListInvoiceableOrders(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, orders)
}

func GetUserInvoices(c *gin.Context) {
	model.ExpireStaleInvoices()
	pageInfo := common.GetPageQuery(c)
	invoices, total, err := model.ListInvoices(model.InvoiceQuery{UserId: c.GetInt("id"), Status: c.Query("status")}, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	for _, invoice := range invoices {
		invoice.AdminRemark = ""
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(invoices)
	common.ApiSuccess(c, pageInfo)
}

func GetUserInvoice(c *gin.Context) {
	id, ok := invoiceIdParam(c)
	if !ok {
		return
	}
	model.ExpireStaleInvoices()
	invoice, err := model.GetUserInvoice(c.GetInt("id"), id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items, err := model.GetInvoiceItems(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	invoice.AdminRemark = ""
	common.ApiSuccess(c, gin.H{"invoice": invoice, "items": items})
}

// resolveInvoicePayMethod finds the Epay method the user picked for tax.
func resolveInvoicePayMethod(paymentMethod, gateway string) (method string, site string, err error) {
	payMethod, ok := operation_setting.FindPayMethod(paymentMethod, gateway)
	if !ok {
		return "", "", common.NewMessage("Payment method does not exist")
	}
	switch payMethod["type"] {
	case model.PaymentMethodStripe, model.PaymentMethodCreem, model.PaymentMethodWaffo, model.PaymentMethodWaffoPancake:
		return "", "", common.NewMessage("Payment method does not exist")
	}
	if operation_setting.PayMethodHidden(payMethod) {
		return "", "", common.NewMessage("This payment method is hidden")
	}
	site = operation_setting.NormalizeEpayGateway(payMethod["gateway"])
	if !operation_setting.EpayConfigured(site) {
		return "", "", common.NewMessage("Payment information has not been configured by administrator")
	}
	return payMethod["type"], site, nil
}

// startInvoiceTaxPayment builds the Epay checkout for an application that
// waits for payment. The amount is the tax itself, in CNY, without the
// gateway's top-up unit price.
func startInvoiceTaxPayment(invoice *model.Invoice) (string, map[string]string, error) {
	if invoice.TaxTradeNo == nil || *invoice.TaxTradeNo == "" {
		return "", nil, common.NewMessage("Failed to start payment")
	}
	client := GetEpayClientFor(invoice.TaxGateway)
	if client == nil {
		return "", nil, common.NewMessage("Payment information has not been configured by administrator")
	}
	notifyUrl, err := url.Parse(service.GetCallbackAddress() + operation_setting.EpayInvoiceNotifyPath(invoice.TaxGateway))
	if err != nil {
		return "", nil, common.NewMessage("Callback URL configuration error")
	}
	returnUrl, err := url.Parse(paymentReturnPath("/invoice?pay=return"))
	if err != nil {
		return "", nil, common.NewMessage("Callback URL configuration error")
	}
	uri, params, err := client.Purchase(&epay.PurchaseArgs{
		Type:           invoice.TaxPaymentMethod,
		ServiceTradeNo: *invoice.TaxTradeNo,
		Name:           fmt.Sprintf("INV%d", invoice.Id),
		Money:          invoice.TaxAmount,
		Device:         epay.PC,
		NotifyUrl:      notifyUrl,
		ReturnUrl:      returnUrl,
	})
	if err != nil {
		common.SysError(common.LogText("Epay failed to start invoice tax payment invoice_id=%d trade_no=%s error=%q", invoice.Id, *invoice.TaxTradeNo, err.Error()))
		return "", nil, common.NewMessage("Failed to start payment")
	}
	return uri, params, nil
}

func CreateInvoice(c *gin.Context) {
	if !operation_setting.GetInvoiceSetting().Enabled {
		common.ApiErrorT(c, "The invoice center is not enabled")
		return
	}
	var input model.InvoiceInput
	if err := common.DecodeJson(c.Request.Body, &input); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := input.Normalize(); err != nil {
		common.ApiError(c, err)
		return
	}
	userId := c.GetInt("id")
	model.ExpireStaleInvoices()
	quote, err := model.QuoteInvoice(userId, input.Orders)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if quote.TaxAmount.IsPositive() {
		if !requirePaymentCompliance(c) {
			return
		}
		method, site, err := resolveInvoicePayMethod(input.PaymentMethod, input.Gateway)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		input.TaxPaymentMethod, input.TaxGateway = method, site
	}

	invoice, items, err := model.CreateInvoice(userId, &input)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	data := gin.H{"invoice": invoice, "items": items}
	if invoice.Status != model.InvoiceStatusPendingPayment {
		common.ApiSuccess(c, data)
		return
	}
	uri, params, err := startInvoiceTaxPayment(invoice)
	if err != nil {
		// Release the orders at once instead of holding them until timeout.
		_ = model.CancelInvoice(userId, invoice.Id)
		common.ApiError(c, err)
		return
	}
	data["url"] = uri
	data["params"] = params
	common.ApiSuccess(c, data)
}

type invoicePayRequest struct {
	PaymentMethod string `json:"payment_method"`
	Gateway       string `json:"gateway"`
}

// PayInvoice starts a new payment attempt for an application that still
// waits for payment. The order number stays the same, so a late callback of
// an earlier attempt still settles it once.
func PayInvoice(c *gin.Context) {
	id, ok := invoiceIdParam(c)
	if !ok {
		return
	}
	if !requirePaymentCompliance(c) {
		return
	}
	var req invoicePayRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	userId := c.GetInt("id")
	model.ExpireStaleInvoices()
	invoice, err := model.GetUserInvoice(userId, id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if invoice.Status != model.InvoiceStatusPendingPayment {
		common.ApiError(c, model.ErrInvoiceAlreadyProcessed)
		return
	}
	if req.PaymentMethod != "" {
		method, site, err := resolveInvoicePayMethod(req.PaymentMethod, req.Gateway)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		// Keep the gateway the earlier attempt used: its callback must still
		// verify against the gateway stored on the application.
		if site != operation_setting.NormalizeEpayGateway(invoice.TaxGateway) {
			common.ApiErrorT(c, "Choose a payment method of the same payment site as the first attempt, or cancel this application and submit again")
			return
		}
		if invoice, err = model.SetInvoiceTaxPayment(userId, id, method, site); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	uri, params, err := startInvoiceTaxPayment(invoice)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"url": uri, "params": params})
}

func CancelInvoice(c *gin.Context) {
	id, ok := invoiceIdParam(c)
	if !ok {
		return
	}
	if err := model.CancelInvoice(c.GetInt("id"), id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// DownloadInvoiceFile serves an invoice file as an attachment. A user gets
// only an issued invoice of their own. An administrator signed in through the
// browser gets any uploaded file; an access token never widens past the
// owner, because this route only asks for the wallet scope.
func DownloadInvoiceFile(c *gin.Context) {
	id, ok := invoiceIdParam(c)
	if !ok {
		return
	}
	var (
		invoice *model.Invoice
		err     error
	)
	if c.GetInt("role") >= common.RoleAdminUser && !c.GetBool("use_access_token") {
		invoice, err = model.GetInvoiceById(id)
	} else {
		invoice, err = model.GetUserInvoice(c.GetInt("id"), id)
		if err == nil && invoice.Status != model.InvoiceStatusIssued {
			err = model.ErrInvoiceNotFound
		}
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if invoice.FileKey == "" {
		common.ApiError(c, model.ErrInvoiceFileMissing)
		return
	}
	file, size, err := service.OpenInvoiceFile(invoice.FileKey)
	if err != nil {
		common.SysError(common.LogText("failed to open invoice file of application %d: %s", invoice.Id, err.Error()))
		common.ApiErrorT(c, "The invoice file is not available")
		return
	}
	defer file.Close()
	name := invoice.FileName
	if name == "" {
		name = invoice.FileKey
	}
	disposition := mime.FormatMediaType("attachment", map[string]string{"filename": name})
	if disposition == "" {
		disposition = "attachment"
	}
	c.Header("Content-Disposition", disposition)
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cache-Control", "private, no-store")
	c.DataFromReader(http.StatusOK, size, invoice.FileMime, file, nil)
}

func InvoiceEpayNotify(c *gin.Context) {
	handleInvoiceEpayNotify(c, operation_setting.EpayGatewayPrimary)
}

func InvoiceEpayNotifyByGateway(c *gin.Context) {
	handleInvoiceEpayNotify(c, c.Param("id"))
}

// handleInvoiceEpayNotify verifies the callback with the key of the gateway
// in the route, then settles the tax order. Epay retries until it reads
// "success", so a mismatch answers "fail" and is left to an administrator.
func handleInvoiceEpayNotify(c *gin.Context, gateway string) {
	var params map[string]string
	if c.Request.Method == http.MethodPost {
		if err := c.Request.ParseForm(); err != nil {
			_, _ = c.Writer.Write([]byte("fail"))
			return
		}
		params = lo.Reduce(lo.Keys(c.Request.PostForm), func(r map[string]string, t string, i int) map[string]string {
			r[t] = c.Request.PostForm.Get(t)
			return r
		}, map[string]string{})
	} else {
		params = lo.Reduce(lo.Keys(c.Request.URL.Query()), func(r map[string]string, t string, i int) map[string]string {
			r[t] = c.Request.URL.Query().Get(t)
			return r
		}, map[string]string{})
	}
	if len(params) == 0 {
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	client := GetEpayClientFor(gateway)
	if client == nil {
		logger.LogError(c.Request.Context(), common.LogText("Epay invoice callback rejected: gateway %s is not configured", gateway))
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	verifyInfo, err := client.Verify(params)
	if err != nil || !verifyInfo.VerifyStatus {
		logger.LogWarn(c.Request.Context(), common.LogText("Epay invoice callback signature verification failed gateway=%s client_ip=%s", gateway, c.ClientIP()))
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	if verifyInfo.TradeStatus != epay.StatusTradeSuccess {
		_, _ = c.Writer.Write([]byte("success"))
		return
	}

	LockOrder(verifyInfo.ServiceTradeNo)
	defer UnlockOrder(verifyInfo.ServiceTradeNo)
	result, err := model.CompleteInvoiceTaxPayment(verifyInfo.ServiceTradeNo, verifyInfo.Money, gateway)
	if err != nil {
		switch {
		case errors.Is(err, model.ErrInvoiceNotFound):
			logger.LogWarn(c.Request.Context(), common.LogText("Epay invoice callback order not found trade_no=%s gateway=%s", verifyInfo.ServiceTradeNo, gateway))
		case errors.Is(err, model.ErrInvoiceCallbackMismatch):
			logger.LogError(c.Request.Context(), common.LogText("Epay invoice callback does not match the application trade_no=%s paid_money=%s gateway=%s", verifyInfo.ServiceTradeNo, verifyInfo.Money, gateway))
		default:
			logger.LogError(c.Request.Context(), common.LogText("Epay invoice callback processing failed trade_no=%s error=%q", verifyInfo.ServiceTradeNo, err.Error()))
		}
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	switch {
	case result.Refunded:
		logger.LogWarn(c.Request.Context(), common.LogText("Epay invoice tax arrived after the application was cancelled; refunded trade_no=%s invoice_id=%d quota=%d", verifyInfo.ServiceTradeNo, result.Invoice.Id, result.RefundQuota))
	case result.AlreadyDone:
		logger.LogInfo(c.Request.Context(), common.LogText("Epay invoice duplicate callback ignored trade_no=%s", verifyInfo.ServiceTradeNo))
	default:
		logger.LogInfo(c.Request.Context(), common.LogText("Epay invoice tax paid trade_no=%s invoice_id=%d", verifyInfo.ServiceTradeNo, result.Invoice.Id))
	}
	_, _ = c.Writer.Write([]byte("success"))
}

func AdminListInvoices(c *gin.Context) {
	model.ExpireStaleInvoices()
	pageInfo := common.GetPageQuery(c)
	query := model.InvoiceQuery{Status: c.Query("status"), Keyword: c.Query("keyword")}
	invoices, total, err := model.ListInvoices(query, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(invoices)
	common.ApiSuccess(c, pageInfo)
}

func AdminGetInvoice(c *gin.Context) {
	id, ok := invoiceIdParam(c)
	if !ok {
		return
	}
	invoice, err := model.GetInvoiceById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items, err := model.GetInvoiceItems(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	username, _ := model.GetUsernameById(invoice.UserId, false)
	common.ApiSuccess(c, gin.H{"invoice": invoice, "items": items, "username": username})
}

// invoiceUploadOverhead leaves room for multipart headers and boundaries on
// top of the file size limit.
const invoiceUploadOverhead = 16 << 10

// AdminUploadInvoiceFile stores or replaces the invoice file of an application
// under review. The body is cut off at the configured size while it is read.
func AdminUploadInvoiceFile(c *gin.Context) {
	id, ok := invoiceIdParam(c)
	if !ok {
		return
	}
	maxBytes := int64(operation_setting.InvoiceFileMaxKB()) << 10
	tooLarge := common.NewMessage("The file cannot be larger than {{max}} KB", map[string]any{"max": operation_setting.InvoiceFileMaxKB()})
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes+invoiceUploadOverhead)
	header, err := c.FormFile("file")
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) || c.Request.ContentLength > maxBytes+invoiceUploadOverhead {
			common.ApiError(c, tooLarge)
			return
		}
		common.ApiErrorT(c, "Select a file to upload")
		return
	}
	if header.Size > maxBytes {
		common.ApiError(c, tooLarge)
		return
	}
	upload, err := header.Open()
	if err != nil {
		common.ApiErrorT(c, "Select a file to upload")
		return
	}
	content, err := io.ReadAll(io.LimitReader(upload, maxBytes+1))
	_ = upload.Close()
	if err != nil {
		common.ApiErrorT(c, "Select a file to upload")
		return
	}
	if int64(len(content)) > maxBytes {
		common.ApiError(c, tooLarge)
		return
	}

	invoice, err := model.GetInvoiceById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if invoice.Status != model.InvoiceStatusPendingReview {
		common.ApiErrorT(c, "Invoice files can only be uploaded while the application is under review")
		return
	}
	stored, err := service.SaveInvoiceFile(header.Filename, content)
	if err != nil {
		var message *common.Message
		if !errors.As(err, &message) {
			common.SysError(common.LogText("failed to save invoice file of application %d: %s", id, err.Error()))
			common.ApiErrorT(c, "Failed to save the invoice file")
			return
		}
		common.ApiError(c, err)
		return
	}
	oldKey, err := model.SetInvoiceFile(id, stored)
	if err != nil {
		service.RemoveInvoiceFile(stored.Key)
		common.ApiError(c, err)
		return
	}
	service.RemoveInvoiceFile(oldKey)
	common.ApiSuccess(c, gin.H{"file_name": stored.Name, "file_size": stored.Size, "file_mime": stored.Mime})
}

func AdminIssueInvoice(c *gin.Context) {
	id, ok := invoiceIdParam(c)
	if !ok {
		return
	}
	invoice, err := model.IssueInvoice(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.RecordLog(invoice.UserId, model.LogTypeSystem, common.NewMessage("Invoice application {{id}} has been issued", map[string]any{"id": invoice.Id}))
	go service.NotifyInvoiceIssued(model.GetUserLanguage(invoice.UserId), invoice)
	common.ApiSuccess(c, invoice)
}

type invoiceRejectRequest struct {
	Reason string `json:"reason"`
}

func AdminRejectInvoice(c *gin.Context) {
	id, ok := invoiceIdParam(c)
	if !ok {
		return
	}
	var req invoiceRejectRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	result, err := model.RejectInvoice(id, req.Reason)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	service.RemoveInvoiceFile(result.OldFileKey)
	go service.NotifyInvoiceRejected(model.GetUserLanguage(result.Invoice.UserId), result.Invoice)
	common.ApiSuccess(c, gin.H{"invoice": result.Invoice, "refund_quota": result.RefundQuota})
}
