package controller

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

const invoiceTestCategory = "*软件服务*软件开发服务"

func setupInvoiceTest(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	// Reject and issue send mail from a goroutine that translates text.
	require.NoError(t, i18n.Init())
	sqlDB, err := db.DB()
	require.NoError(t, err)
	// Every connection to :memory: is a new database, so keep one.
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Log{}, &model.TopUp{}, &model.SubscriptionOrder{},
		&model.Redemption{}, &model.Invoice{}, &model.InvoiceItem{}, &model.InvoiceOrderLock{}))

	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
	previousRedis, previousQuotaPerUnit := common.RedisEnabled, common.QuotaPerUnit
	previousSetting := *operation_setting.GetInvoiceSetting()
	model.DB, model.LOG_DB = db, db
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	common.QuotaPerUnit = 500000
	*operation_setting.GetInvoiceSetting() = operation_setting.InvoiceSetting{
		Enabled:               true,
		TaxRate:               6,
		OrderDays:             30,
		Categories:            invoiceTestCategory,
		SpecialEnabled:        true,
		PaymentTimeoutMinutes: 30,
		FileMaxKB:             100,
	}
	t.Setenv("INVOICE_FILE_DIR", t.TempDir())
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousMain, previousLog)
		common.RedisEnabled, common.QuotaPerUnit = previousRedis, previousQuotaPerUnit
		*operation_setting.GetInvoiceSetting() = previousSetting
	})
	return db
}

func createInvoiceUser(t *testing.T, db *gorm.DB, name string, quota int) *model.User {
	t.Helper()
	user := &model.User{Username: name, Password: "placeholder", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AffCode: name, Quota: quota}
	require.NoError(t, db.Create(user).Error)
	return user
}

func createInvoiceTopUp(t *testing.T, db *gorm.DB, userId int, tradeNo string, money float64, provider string, status string, completed int64) *model.TopUp {
	t.Helper()
	topUp := &model.TopUp{UserId: userId, Money: money, TradeNo: tradeNo, PaymentMethod: "alipay", PaymentProvider: provider, Status: status, CreateTime: completed, CompleteTime: completed}
	require.NoError(t, db.Create(topUp).Error)
	return topUp
}

func invoiceTestInput(refs ...model.InvoiceOrderRef) *model.InvoiceInput {
	return &model.InvoiceInput{
		InvoiceType:      model.InvoiceTypeNormal,
		TitleType:        model.InvoiceTitleCompany,
		Title:            "Example Ltd",
		TaxNo:            "91310000000000000X",
		Category:         invoiceTestCategory,
		Email:            "finance@example.com",
		Orders:           refs,
		TaxPaymentMethod: "alipay",
		TaxGateway:       operation_setting.EpayGatewayPrimary,
	}
}

func invoiceUserQuota(t *testing.T, db *gorm.DB, userId int) (quota int, unpaid int) {
	t.Helper()
	var user model.User
	require.NoError(t, db.Select("quota", "unpaid_quota_balance").Where("id = ?", userId).First(&user).Error)
	return user.Quota, user.UnpaidQuotaBalance
}

func invoiceStatus(t *testing.T, db *gorm.DB, id int) string {
	t.Helper()
	var invoice model.Invoice
	require.NoError(t, db.Select("status").Where("id = ?", id).First(&invoice).Error)
	return invoice.Status
}

func TestCalculateInvoiceAmounts(t *testing.T) {
	for _, tc := range []struct {
		name                         string
		orders                       []string
		rate                         string
		wantOrder, wantTax, wantInvo string
	}{
		{"spec example", []string{"100", "50"}, "6", "150.00", "9.00", "159.00"},
		{"tax rounds half up", []string{"33.33"}, "6", "33.33", "2.00", "35.33"},
		{"tiny tax rounds to zero", []string{"0.05"}, "6", "0.05", "0.00", "0.05"},
		{"zero rate", []string{"10.10", "0.90"}, "0", "11.00", "0.00", "11.00"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			amounts := make([]decimal.Decimal, 0, len(tc.orders))
			for _, order := range tc.orders {
				amounts = append(amounts, decimal.RequireFromString(order))
			}
			got := model.CalculateInvoiceAmounts(amounts, decimal.RequireFromString(tc.rate))
			assert.Equal(t, tc.wantOrder, got.OrderAmount.StringFixed(2))
			assert.Equal(t, tc.wantTax, got.TaxAmount.StringFixed(2))
			assert.Equal(t, tc.wantInvo, got.InvoiceAmount.StringFixed(2))
		})
	}
}

func TestInvoiceableOrdersFilter(t *testing.T) {
	db := setupInvoiceTest(t)
	user := createInvoiceUser(t, db, "invoice-filter", 0)
	other := createInvoiceUser(t, db, "invoice-other", 0)
	now := time.Now().Unix()
	old := now - 31*86400

	paid := createInvoiceTopUp(t, db, user.Id, "USR-PAID", 100, model.PaymentProviderEpay, common.TopUpStatusSuccess, now)
	createInvoiceTopUp(t, db, user.Id, "USR-STRIPE", 100, model.PaymentProviderStripe, common.TopUpStatusSuccess, now)
	createInvoiceTopUp(t, db, user.Id, "USR-PENDING", 100, model.PaymentProviderEpay, common.TopUpStatusPending, now)
	expired := createInvoiceTopUp(t, db, user.Id, "USR-OLD", 100, model.PaymentProviderEpay, common.TopUpStatusSuccess, old)
	createInvoiceTopUp(t, db, user.Id, "USR-ZERO", 0, model.PaymentProviderEpay, common.TopUpStatusSuccess, now)
	createInvoiceTopUp(t, db, other.Id, "USR-OTHER", 100, model.PaymentProviderEpay, common.TopUpStatusSuccess, now)
	subscription := &model.SubscriptionOrder{UserId: user.Id, PlanId: 1, Money: 29.9, TradeNo: "SUB-PAID", PaymentMethod: "alipay", PaymentProvider: model.PaymentProviderEpay, Status: common.TopUpStatusSuccess, CreateTime: now, CompleteTime: now}
	require.NoError(t, db.Create(subscription).Error)
	used := &model.Redemption{Key: strings.Repeat("a", 32), Status: common.RedemptionCodeStatusUsed, Quota: 2500000, UsedUserId: user.Id, RedeemedTime: now}
	deleted := &model.Redemption{Key: strings.Repeat("b", 32), Status: common.RedemptionCodeStatusUsed, Quota: 500000, UsedUserId: user.Id, RedeemedTime: now}
	unused := &model.Redemption{Key: strings.Repeat("c", 32), Status: common.RedemptionCodeStatusEnabled, Quota: 500000}
	require.NoError(t, db.Create([]*model.Redemption{used, deleted, unused}).Error)
	// A code deleted after it was redeemed can still be invoiced.
	require.NoError(t, db.Delete(deleted).Error)

	orders, err := model.ListInvoiceableOrders(user.Id)
	require.NoError(t, err)
	got := map[string]string{}
	for _, order := range orders {
		got[order.OrderType+":"+strconv.Itoa(order.OrderId)] = order.Amount
	}
	assert.Equal(t, map[string]string{
		"topup:" + strconv.Itoa(paid.Id):                "100.00",
		"subscription:" + strconv.Itoa(subscription.Id): "29.90",
		"redemption:" + strconv.Itoa(used.Id):           "5.00",
		"redemption:" + strconv.Itoa(deleted.Id):        "1.00",
	}, got)

	_, _, err = model.CreateInvoice(user.Id, invoiceTestInput(model.InvoiceOrderRef{OrderType: model.InvoiceOrderTopUp, OrderId: paid.Id}))
	require.NoError(t, err)
	orders, err = model.ListInvoiceableOrders(user.Id)
	require.NoError(t, err)
	assert.Len(t, orders, 3, "an order held by an application is no longer offered")

	_, _, err = model.CreateInvoice(user.Id, invoiceTestInput(model.InvoiceOrderRef{OrderType: model.InvoiceOrderTopUp, OrderId: expired.Id}))
	assert.ErrorIs(t, err, model.ErrInvoiceOrderExpired, "an order older than the invoicing period is refused at submit")
}

func TestInvoiceInputSpecialInvoiceRequiresBankDetails(t *testing.T) {
	setupInvoiceTest(t)
	input := invoiceTestInput()
	input.InvoiceType = model.InvoiceTypeSpecial
	input.TitleType = model.InvoiceTitlePersonal
	require.Error(t, input.Normalize())

	input.RegAddress, input.RegPhone, input.BankName, input.BankAccount = "Road 1", "021-1234", "Bank", "6222"
	require.NoError(t, input.Normalize())
	assert.Equal(t, model.InvoiceTitleCompany, input.TitleType, "a special invoice is always issued to a company")

	operation_setting.GetInvoiceSetting().SpecialEnabled = false
	assert.Error(t, input.Normalize())
}

func TestCreateInvoiceClaimsEachOrderOnce(t *testing.T) {
	db := setupInvoiceTest(t)
	user := createInvoiceUser(t, db, "invoice-dup", 0)
	topUp := createInvoiceTopUp(t, db, user.Id, "USR-DUP", 150, model.PaymentProviderEpay, common.TopUpStatusSuccess, time.Now().Unix())
	ref := model.InvoiceOrderRef{OrderType: model.InvoiceOrderTopUp, OrderId: topUp.Id}

	invoice, items, err := model.CreateInvoice(user.Id, invoiceTestInput(ref, ref))
	require.NoError(t, err)
	assert.Len(t, items, 1)
	assert.Equal(t, model.InvoiceStatusPendingPayment, invoice.Status)
	assert.Equal(t, "150.00", invoice.OrderAmount)
	assert.Equal(t, "9.00", invoice.TaxAmount)
	assert.Equal(t, "159.00", invoice.InvoiceAmount)
	require.NotNil(t, invoice.TaxTradeNo)
	assert.True(t, strings.HasPrefix(*invoice.TaxTradeNo, "INV"))

	_, _, err = model.CreateInvoice(user.Id, invoiceTestInput(ref))
	assert.ErrorIs(t, err, model.ErrInvoiceOrderTaken)
	var count int64
	require.NoError(t, db.Model(&model.Invoice{}).Count(&count).Error)
	assert.EqualValues(t, 1, count, "the refused application is rolled back")

	// No tax due: the application skips payment, and the empty order number
	// stays NULL so several such applications fit the unique index.
	operation_setting.GetInvoiceSetting().TaxRate = 0
	for _, tradeNo := range []string{"USR-FREE-1", "USR-FREE-2"} {
		free := createInvoiceTopUp(t, db, user.Id, tradeNo, 10, model.PaymentProviderEpay, common.TopUpStatusSuccess, time.Now().Unix())
		invoice, _, err := model.CreateInvoice(user.Id, invoiceTestInput(model.InvoiceOrderRef{OrderType: model.InvoiceOrderTopUp, OrderId: free.Id}))
		require.NoError(t, err)
		assert.Equal(t, model.InvoiceStatusPendingReview, invoice.Status)
		assert.Nil(t, invoice.TaxTradeNo)
	}
}

// createPaidInvoice submits a 150.00 order at 6% and settles its 9.00 tax.
func createPaidInvoice(t *testing.T, db *gorm.DB, user *model.User, tradeNo string) *model.Invoice {
	t.Helper()
	topUp := createInvoiceTopUp(t, db, user.Id, tradeNo, 150, model.PaymentProviderEpay, common.TopUpStatusSuccess, time.Now().Unix())
	invoice, _, err := model.CreateInvoice(user.Id, invoiceTestInput(model.InvoiceOrderRef{OrderType: model.InvoiceOrderTopUp, OrderId: topUp.Id}))
	require.NoError(t, err)
	result, err := model.CompleteInvoiceTaxPayment(*invoice.TaxTradeNo, "9.00", operation_setting.EpayGatewayPrimary)
	require.NoError(t, err)
	require.Equal(t, model.InvoiceStatusPendingReview, result.Invoice.Status)
	return result.Invoice
}

func TestInvoiceTaxCallback(t *testing.T) {
	db := setupInvoiceTest(t)
	user := createInvoiceUser(t, db, "invoice-callback", 1000)
	topUp := createInvoiceTopUp(t, db, user.Id, "USR-CB", 150, model.PaymentProviderEpay, common.TopUpStatusSuccess, time.Now().Unix())
	invoice, _, err := model.CreateInvoice(user.Id, invoiceTestInput(model.InvoiceOrderRef{OrderType: model.InvoiceOrderTopUp, OrderId: topUp.Id}))
	require.NoError(t, err)
	tradeNo := *invoice.TaxTradeNo

	_, err = model.CompleteInvoiceTaxPayment(tradeNo, "8.99", operation_setting.EpayGatewayPrimary)
	assert.ErrorIs(t, err, model.ErrInvoiceCallbackMismatch, "a different amount is refused")
	_, err = model.CompleteInvoiceTaxPayment(tradeNo, "9.00", "site-b")
	assert.ErrorIs(t, err, model.ErrInvoiceCallbackMismatch, "a callback from another gateway is refused")
	_, err = model.CompleteInvoiceTaxPayment("INVUNKNOWN", "9.00", operation_setting.EpayGatewayPrimary)
	assert.ErrorIs(t, err, model.ErrInvoiceNotFound)
	assert.Equal(t, model.InvoiceStatusPendingPayment, invoiceStatus(t, db, invoice.Id))

	first, err := model.CompleteInvoiceTaxPayment(tradeNo, "9.00", operation_setting.EpayGatewayPrimary)
	require.NoError(t, err)
	assert.False(t, first.AlreadyDone)
	second, err := model.CompleteInvoiceTaxPayment(tradeNo, "9.00", operation_setting.EpayGatewayPrimary)
	require.NoError(t, err)
	assert.True(t, second.AlreadyDone, "a repeated callback changes nothing")
	assert.Equal(t, model.InvoiceStatusPendingReview, invoiceStatus(t, db, invoice.Id))
	quota, _ := invoiceUserQuota(t, db, user.Id)
	assert.Equal(t, 1000, quota, "tax is never credited as a top-up")
}

func TestInvoiceTaxCallbackAfterCancelRefundsOnce(t *testing.T) {
	db := setupInvoiceTest(t)
	user := createInvoiceUser(t, db, "invoice-late", 0)
	topUp := createInvoiceTopUp(t, db, user.Id, "USR-LATE", 150, model.PaymentProviderEpay, common.TopUpStatusSuccess, time.Now().Unix())
	ref := model.InvoiceOrderRef{OrderType: model.InvoiceOrderTopUp, OrderId: topUp.Id}
	invoice, _, err := model.CreateInvoice(user.Id, invoiceTestInput(ref))
	require.NoError(t, err)
	require.NoError(t, model.CancelInvoice(user.Id, invoice.Id))
	assert.ErrorIs(t, model.CancelInvoice(user.Id, invoice.Id), model.ErrInvoiceAlreadyProcessed)

	result, err := model.CompleteInvoiceTaxPayment(*invoice.TaxTradeNo, "9.00", operation_setting.EpayGatewayPrimary)
	require.NoError(t, err)
	assert.True(t, result.Refunded)
	assert.Equal(t, 4500000, result.RefundQuota)
	again, err := model.CompleteInvoiceTaxPayment(*invoice.TaxTradeNo, "9.00", operation_setting.EpayGatewayPrimary)
	require.NoError(t, err)
	assert.True(t, again.AlreadyDone)

	quota, unpaid := invoiceUserQuota(t, db, user.Id)
	assert.Equal(t, 4500000, quota, "the late tax is refunded exactly once")
	assert.Equal(t, 0, unpaid)
	assert.Equal(t, model.InvoiceStatusCancelled, invoiceStatus(t, db, invoice.Id))
	// The order was released by the cancel and is not claimed again.
	_, _, err = model.CreateInvoice(user.Id, invoiceTestInput(ref))
	assert.NoError(t, err)
}

func TestRejectInvoiceRefundsTaxOnce(t *testing.T) {
	db := setupInvoiceTest(t)
	nearCeiling := common.MaxWalletQuota - 1000
	user := createInvoiceUser(t, db, "invoice-reject", nearCeiling)
	invoice := createPaidInvoice(t, db, user, "USR-REJECT")

	_, err := model.RejectInvoice(invoice.Id, " ")
	assert.Error(t, err, "a reason is required")

	result, err := model.RejectInvoice(invoice.Id, "Wrong tax number")
	require.NoError(t, err)
	assert.Equal(t, 4500000, result.RefundQuota, "9.00 CNY returns 9 units of balance")
	_, err = model.RejectInvoice(invoice.Id, "again")
	assert.ErrorIs(t, err, model.ErrInvoiceAlreadyProcessed)

	quota, unpaid := invoiceUserQuota(t, db, user.Id)
	assert.Equal(t, nearCeiling+4500000, quota, "the refund skips the wallet ceiling and is applied once")
	assert.Equal(t, 0, unpaid, "the refund counts as purchased balance")

	var locks int64
	require.NoError(t, db.Model(&model.InvoiceOrderLock{}).Where("invoice_id = ?", invoice.Id).Count(&locks).Error)
	assert.Zero(t, locks, "rejection releases the orders")
}

func TestIssueAndRejectOnlyOneWins(t *testing.T) {
	db := setupInvoiceTest(t)
	user := createInvoiceUser(t, db, "invoice-race", 0)
	invoice := createPaidInvoice(t, db, user, "USR-RACE")

	_, err := model.IssueInvoice(invoice.Id)
	assert.ErrorIs(t, err, model.ErrInvoiceFileMissing, "issuing needs an uploaded file")
	_, err = model.SetInvoiceFile(invoice.Id, model.InvoiceFile{Name: "a.pdf", Key: strings.Repeat("k", 32) + ".pdf", Size: 10, Mime: "application/pdf"})
	require.NoError(t, err)

	_, err = model.IssueInvoice(invoice.Id)
	require.NoError(t, err)
	_, err = model.RejectInvoice(invoice.Id, "late reject")
	assert.ErrorIs(t, err, model.ErrInvoiceAlreadyProcessed)
	quota, _ := invoiceUserQuota(t, db, user.Id)
	assert.Zero(t, quota, "an issued invoice is never refunded")
	assert.Equal(t, model.InvoiceStatusIssued, invoiceStatus(t, db, invoice.Id))
}

func TestExpireStaleInvoicesUsesCurrentTimeout(t *testing.T) {
	db := setupInvoiceTest(t)
	user := createInvoiceUser(t, db, "invoice-timeout", 0)
	topUp := createInvoiceTopUp(t, db, user.Id, "USR-TIMEOUT", 150, model.PaymentProviderEpay, common.TopUpStatusSuccess, time.Now().Unix())
	invoice, _, err := model.CreateInvoice(user.Id, invoiceTestInput(model.InvoiceOrderRef{OrderType: model.InvoiceOrderTopUp, OrderId: topUp.Id}))
	require.NoError(t, err)
	require.NoError(t, db.Model(&model.Invoice{}).Where("id = ?", invoice.Id).Update("create_time", time.Now().Unix()-40*60).Error)

	operation_setting.GetInvoiceSetting().PaymentTimeoutMinutes = 60
	model.ExpireStaleInvoices()
	assert.Equal(t, model.InvoiceStatusPendingPayment, invoiceStatus(t, db, invoice.Id))

	operation_setting.GetInvoiceSetting().PaymentTimeoutMinutes = 30
	model.ExpireStaleInvoices()
	assert.Equal(t, model.InvoiceStatusCancelled, invoiceStatus(t, db, invoice.Id))
	orders, err := model.ListInvoiceableOrders(user.Id)
	require.NoError(t, err)
	assert.Len(t, orders, 1, "the timed-out application releases its order")
}

func uploadInvoiceFile(t *testing.T, invoiceId int, name string, content []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", name)
	require.NoError(t, err)
	_, err = part.Write(content)
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/invoice/admin/"+strconv.Itoa(invoiceId)+"/file", &body)
	c.Request.Header.Set("Content-Type", writer.FormDataContentType())
	c.Params = gin.Params{{Key: "id", Value: strconv.Itoa(invoiceId)}}
	AdminUploadInvoiceFile(c)
	return response
}

func downloadInvoiceFile(invoiceId int, userId int, role int) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/invoice/"+strconv.Itoa(invoiceId)+"/file", nil)
	c.Params = gin.Params{{Key: "id", Value: strconv.Itoa(invoiceId)}}
	c.Set("id", userId)
	c.Set("role", role)
	DownloadInvoiceFile(c)
	return response
}

func TestInvoiceFileUploadAndDownload(t *testing.T) {
	db := setupInvoiceTest(t)
	owner := createInvoiceUser(t, db, "invoice-owner", 0)
	stranger := createInvoiceUser(t, db, "invoice-stranger", 0)
	invoice := createPaidInvoice(t, db, owner, "USR-FILE")
	pdf := []byte("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n")

	for _, tc := range []struct {
		name     string
		fileName string
		content  []byte
	}{
		{"extension outside the whitelist", "invoice.jpeg", []byte("\xff\xd8\xff\xe0")},
		{"svg is refused", "invoice.svg", []byte("<svg></svg>")},
		{"html renamed to pdf", "invoice.pdf", []byte("<html><script>alert(1)</script></html>")},
		{"png renamed to pdf", "invoice.pdf", []byte("\x89PNG\r\n\x1a\n0000")},
		{"larger than the setting", "invoice.pdf", append([]byte("%PDF-1.7\n"), bytes.Repeat([]byte("0"), 11<<10)...)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			operation_setting.GetInvoiceSetting().FileMaxKB = 10
			response := uploadInvoiceFile(t, invoice.Id, tc.fileName, tc.content)
			assert.Contains(t, response.Body.String(), `"success":false`)
		})
	}

	operation_setting.GetInvoiceSetting().FileMaxKB = 100
	response := uploadInvoiceFile(t, invoice.Id, "../../etc/发票.PDF", pdf)
	require.Contains(t, response.Body.String(), `"success":true`, response.Body.String())
	stored, err := model.GetInvoiceById(invoice.Id)
	require.NoError(t, err)
	assert.Equal(t, "发票.PDF", stored.FileName, "the path part of the uploaded name is dropped")
	assert.NotContains(t, stored.FileKey, "/")

	assert.Contains(t, downloadInvoiceFile(invoice.Id, owner.Id, common.RoleCommonUser).Body.String(), `"success":false`,
		"the owner cannot download before the invoice is issued")
	_, err = model.IssueInvoice(invoice.Id)
	require.NoError(t, err)
	assert.Contains(t, downloadInvoiceFile(invoice.Id, stranger.Id, common.RoleCommonUser).Body.String(), `"success":false`,
		"another user cannot download the invoice")

	download := downloadInvoiceFile(invoice.Id, owner.Id, common.RoleCommonUser)
	require.Equal(t, http.StatusOK, download.Code)
	assert.Equal(t, pdf, download.Body.Bytes())
	assert.Contains(t, download.Header().Get("Content-Disposition"), "attachment")
	assert.Equal(t, "nosniff", download.Header().Get("X-Content-Type-Options"))

	assert.Contains(t, uploadInvoiceFile(t, invoice.Id, "again.pdf", pdf).Body.String(), `"success":false`,
		"an issued application takes no new file")
}

func TestRejectInvoiceRemovesUploadedFile(t *testing.T) {
	db := setupInvoiceTest(t)
	user := createInvoiceUser(t, db, "invoice-cleanup", 0)
	invoice := createPaidInvoice(t, db, user, "USR-CLEANUP")
	pdf := []byte("%PDF-1.7\n%%EOF\n")
	require.Contains(t, uploadInvoiceFile(t, invoice.Id, "a.pdf", pdf).Body.String(), `"success":true`)
	stored, err := model.GetInvoiceById(invoice.Id)
	require.NoError(t, err)
	file, _, err := service.OpenInvoiceFile(stored.FileKey)
	require.NoError(t, err)
	require.NoError(t, file.Close())

	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/invoice/admin/"+strconv.Itoa(invoice.Id)+"/reject", strings.NewReader(`{"reason":"Wrong title"}`))
	c.Params = gin.Params{{Key: "id", Value: strconv.Itoa(invoice.Id)}}
	AdminRejectInvoice(c)
	require.Contains(t, response.Body.String(), `"success":true`, response.Body.String())

	_, _, err = service.OpenInvoiceFile(stored.FileKey)
	assert.Error(t, err, "the uploaded file is deleted on rejection")
}
