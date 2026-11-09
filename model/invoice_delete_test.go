package model

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupInvoiceDeletionTest(t *testing.T) User {
	t.Helper()
	setupUserUpdateTestState(t)
	models := []any{&Invoice{}, &InvoiceItem{}, &InvoiceOrderLock{}, &InvoiceTaxPayment{}, &InvoiceDeletion{}, &InvoiceIDReservation{}, &Redemption{}}
	require.NoError(t, DB.AutoMigrate(models...))
	for _, model := range models {
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(model).Error)
	}
	t.Cleanup(func() {
		for _, model := range models {
			assert.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(model).Error)
		}
	})
	settings := operation_setting.GetInvoiceSetting()
	previousSettings, previousQuotaPerUnit := *settings, common.QuotaPerUnit
	settings.TaxRate, settings.SpecialTaxRate, settings.OrderDays = 6, 6, 30
	common.QuotaPerUnit = 100
	t.Cleanup(func() {
		*settings = previousSettings
		common.QuotaPerUnit = previousQuotaPerUnit
	})
	user := User{
		Username: "invoice-delete-test", Password: "unused-password-hash",
		Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default",
		AffCode: "invoice-delete", Quota: 10000, UnpaidQuotaBalance: 200,
	}
	require.NoError(t, DB.Create(&user).Error)
	return user
}

func createInvoiceDeletionApplication(t *testing.T, userID int, amount float64, method string) (*Invoice, InvoiceOrderRef) {
	t.Helper()
	order := TopUp{
		UserId: userID, Money: amount, TradeNo: "invoice-delete-" + common.GetRandomString(16),
		PaymentMethod: "alipay", PaymentProvider: PaymentProviderEpay,
		Status: common.TopUpStatusSuccess, CompleteTime: common.GetTimestamp(),
	}
	require.NoError(t, DB.Create(&order).Error)
	ref := InvoiceOrderRef{OrderType: InvoiceOrderTopUp, OrderId: order.Id}
	invoice, items, err := CreateInvoice(userID, &InvoiceInput{
		InvoiceType: InvoiceTypeNormal, TitleType: InvoiceTitleCompany,
		Title: "待删除开票抬头", TaxNo: "91310000123456789A", Email: "invoice@example.test",
		Orders: []InvoiceOrderRef{ref}, TaxPaymentMethod: method, TaxGateway: "default",
	})
	require.NoError(t, err)
	require.Len(t, items, 1)
	return invoice, ref
}

func issueInvoiceDeletionApplication(t *testing.T, invoiceID int) *Invoice {
	t.Helper()
	_, err := SetInvoiceFile(invoiceID, InvoiceFile{Name: "invoice.pdf", Key: fmt.Sprintf("invoice-%d.pdf", invoiceID), Size: 128, Mime: "application/pdf"})
	require.NoError(t, err)
	invoice, err := IssueInvoice(invoiceID)
	require.NoError(t, err)
	return invoice
}

func TestInvoiceDeletionPreservesOrderAccounting(t *testing.T) {
	user := setupInvoiceDeletionTest(t)
	invoice, ref := createInvoiceDeletionApplication(t, user.Id, 100, PaymentMethodBalance)
	invoice = issueInvoiceDeletionApplication(t, invoice.Id)
	var walletBefore User
	require.NoError(t, DB.First(&walletBefore, user.Id).Error)
	var paymentBefore InvoiceTaxPayment
	require.NoError(t, DB.Where("invoice_id = ?", invoice.Id).First(&paymentBefore).Error)
	before, err := GetInvoiceSummary(user.Id)
	require.NoError(t, err)
	assert.Equal(t, InvoiceSummaryCard{Amount: "100.00", Count: 1}, before.Issued)

	deletion, err := DeleteIssuedInvoice(invoice.Id, 42, "  清理已交付记录  ")
	require.NoError(t, err)
	assert.Equal(t, invoice.Id, deletion.InvoiceID)
	assert.Equal(t, user.Id, deletion.UserID)
	assert.Equal(t, "100.00", deletion.OrderAmount)
	assert.Equal(t, invoice.IssuedTime, deletion.IssuedTime)
	assert.Equal(t, 42, deletion.DeletedBy)
	assert.Equal(t, "清理已交付记录", deletion.Reason)
	assert.Equal(t, invoice.FileKey, deletion.FileKey)
	assert.Positive(t, deletion.DeletedAt)

	var remaining int64
	require.NoError(t, DB.Unscoped().Model(&Invoice{}).Where("id = ?", invoice.Id).Count(&remaining).Error)
	assert.Zero(t, remaining)
	items, err := GetInvoiceItems(invoice.Id)
	require.NoError(t, err)
	assert.Empty(t, items)
	_, err = GetUserInvoice(user.Id, invoice.Id)
	assert.ErrorIs(t, err, ErrInvoiceNotFound)
	_, err = GetInvoiceById(invoice.Id)
	assert.ErrorIs(t, err, ErrInvoiceNotFound)
	for _, query := range []InvoiceQuery{{UserId: user.Id}, {}} {
		listed, total, err := ListInvoices(query, 0, 10)
		require.NoError(t, err)
		assert.Empty(t, listed)
		assert.Zero(t, total)
	}
	var lock InvoiceOrderLock
	require.NoError(t, DB.Where("order_type = ? AND order_id = ?", ref.OrderType, ref.OrderId).First(&lock).Error)
	assert.Equal(t, invoice.Id, lock.InvoiceId)
	var paymentAfter InvoiceTaxPayment
	require.NoError(t, DB.First(&paymentAfter, paymentBefore.Id).Error)
	assert.Equal(t, paymentBefore, paymentAfter)
	after, err := GetInvoiceSummary(user.Id)
	require.NoError(t, err)
	assert.Equal(t, before, after)
	available, err := ListInvoiceableOrders(user.Id)
	require.NoError(t, err)
	assert.Empty(t, available)

	_, _, err = CreateInvoice(user.Id, &InvoiceInput{InvoiceType: InvoiceTypeNormal, Orders: []InvoiceOrderRef{ref}, TaxPaymentMethod: PaymentMethodBalance})
	assert.ErrorIs(t, err, ErrInvoiceOrderTaken)
	var walletAfter User
	require.NoError(t, DB.First(&walletAfter, user.Id).Error)
	assert.Equal(t, walletBefore.Quota, walletAfter.Quota)
	assert.Equal(t, walletBefore.UnpaidQuotaBalance, walletAfter.UnpaidQuotaBalance)
	_, err = CompleteInvoiceTaxPayment(paymentBefore.TradeNo, paymentBefore.Amount, paymentBefore.Gateway)
	assert.ErrorIs(t, err, ErrInvoiceCallbackMismatch)

	again, err := DeleteIssuedInvoice(invoice.Id, 99, "不能覆盖首次删除原因")
	require.NoError(t, err)
	assert.Equal(t, deletion, again)
	pending, err := ListPendingInvoiceFileDeletions(0, 10)
	require.NoError(t, err)
	require.Len(t, pending, 1)
	assert.Equal(t, invoice.FileKey, pending[0].FileKey)
	later := InvoiceDeletion{InvoiceID: invoice.Id + 100000, UserID: user.Id, OrderAmount: "0.00", FileKey: "later.pdf", Reason: "清理"}
	require.NoError(t, DB.Create(&later).Error)
	nextBatch, err := ListPendingInvoiceFileDeletions(invoice.Id, 1)
	require.NoError(t, err)
	require.Len(t, nextBatch, 1)
	assert.Equal(t, later.InvoiceID, nextBatch[0].InvoiceID)
	require.NoError(t, MarkInvoiceFileDeleted(later.InvoiceID, later.FileKey))
	require.NoError(t, MarkInvoiceFileDeleted(invoice.Id, "other.pdf"))
	pending, err = ListPendingInvoiceFileDeletions(0, 10)
	require.NoError(t, err)
	assert.Len(t, pending, 1)
	require.NoError(t, MarkInvoiceFileDeleted(invoice.Id, invoice.FileKey))
	require.NoError(t, MarkInvoiceFileDeleted(invoice.Id, invoice.FileKey))
	pending, err = ListPendingInvoiceFileDeletions(0, 10)
	require.NoError(t, err)
	assert.Empty(t, pending)
	again, err = DeleteIssuedInvoice(invoice.Id, 99, "再次请求")
	require.NoError(t, err)
	assert.Empty(t, again.FileKey)
	assert.Equal(t, deletion.Reason, again.Reason)
}

func TestInvoiceDeletionRejectsInvalidRequests(t *testing.T) {
	user := setupInvoiceDeletionTest(t)
	invoice, _ := createInvoiceDeletionApplication(t, user.Id, 100, PaymentMethodBalance)
	invoice = issueInvoiceDeletionApplication(t, invoice.Id)
	for _, tc := range []struct {
		name   string
		status string
		id     int
		admin  int
		reason string
	}{
		{"pending_payment", InvoiceStatusPendingPayment, invoice.Id, 42, "清理"},
		{"pending_review", InvoiceStatusPendingReview, invoice.Id, 42, "清理"},
		{"rejected", InvoiceStatusRejected, invoice.Id, 42, "清理"},
		{"cancelled", InvoiceStatusCancelled, invoice.Id, 42, "清理"},
		{"empty_reason", InvoiceStatusIssued, invoice.Id, 42, " \t\n"},
		{"long_reason", InvoiceStatusIssued, invoice.Id, 42, strings.Repeat("理", 501)},
		{"invalid_invoice", InvoiceStatusIssued, 0, 42, "清理"},
		{"invalid_operator", InvoiceStatusIssued, invoice.Id, 0, "清理"},
		{"missing_invoice", InvoiceStatusIssued, invoice.Id + 100000, 42, "清理"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			require.NoError(t, DB.Model(&Invoice{}).Where("id = ?", invoice.Id).Update("status", tc.status).Error)
			_, err := DeleteIssuedInvoice(tc.id, tc.admin, tc.reason)
			require.Error(t, err)
			persisted, err := GetInvoiceById(invoice.Id)
			require.NoError(t, err)
			assert.Equal(t, tc.status, persisted.Status)
			items, err := GetInvoiceItems(invoice.Id)
			require.NoError(t, err)
			assert.Len(t, items, 1)
			var count int64
			require.NoError(t, DB.Model(&InvoiceDeletion{}).Count(&count).Error)
			assert.Zero(t, count)
		})
	}
	deletion, err := DeleteIssuedInvoice(invoice.Id, 42, strings.Repeat("理", 500))
	require.NoError(t, err)
	assert.Equal(t, strings.Repeat("理", 500), deletion.Reason)
}

func TestInvoiceDeletionTaxCallbacksRemainIdempotent(t *testing.T) {
	user := setupInvoiceDeletionTest(t)
	invoice, _ := createInvoiceDeletionApplication(t, user.Id, 100, "alipay")
	firstTrade := *invoice.TaxTradeNo
	second, err := NewInvoiceTaxPaymentAttempt(user.Id, invoice.Id, "alipay", "default")
	require.NoError(t, err)
	secondTrade := *second.TaxTradeNo
	paid, err := CompleteInvoiceTaxPayment(firstTrade, "6.00", "default")
	require.NoError(t, err)
	assert.False(t, paid.Refunded)
	assert.Equal(t, InvoiceStatusPendingReview, paid.Invoice.Status)
	issueInvoiceDeletionApplication(t, invoice.Id)
	_, err = DeleteIssuedInvoice(invoice.Id, 42, "清理已交付记录")
	require.NoError(t, err)

	for _, tc := range []struct{ amount, gateway string }{{"6.01", "default"}, {"6.00", "wrong"}} {
		_, err := CompleteInvoiceTaxPayment(secondTrade, tc.amount, tc.gateway)
		assert.ErrorIs(t, err, ErrInvoiceCallbackMismatch)
	}
	duplicate, err := CompleteInvoiceTaxPayment(firstTrade, "6.00", "default")
	require.NoError(t, err)
	assert.True(t, duplicate.AlreadyDone)
	assert.False(t, duplicate.Refunded)
	refunded, err := CompleteInvoiceTaxPayment(secondTrade, "6.00", "default")
	require.NoError(t, err)
	assert.True(t, refunded.Refunded)
	assert.Equal(t, 600, refunded.RefundQuota)
	duplicate, err = CompleteInvoiceTaxPayment(secondTrade, "6.00", "default")
	require.NoError(t, err)
	assert.True(t, duplicate.AlreadyDone)
	assert.False(t, duplicate.Refunded)
	var wallet User
	require.NoError(t, DB.First(&wallet, user.Id).Error)
	assert.Equal(t, user.Quota+600, wallet.Quota)
	assert.Equal(t, user.UnpaidQuotaBalance, wallet.UnpaidQuotaBalance)
	var payments []InvoiceTaxPayment
	require.NoError(t, DB.Where("invoice_id = ?", invoice.Id).Order("id ASC").Find(&payments).Error)
	require.Len(t, payments, 2)
	assert.Equal(t, InvoiceTaxPaymentPaid, payments[0].Status)
	assert.Zero(t, payments[0].RefundQuota)
	assert.Equal(t, InvoiceTaxPaymentRefunded, payments[1].Status)
	assert.Equal(t, 600, payments[1].RefundQuota)
	_, err = GetInvoiceById(invoice.Id)
	assert.ErrorIs(t, err, ErrInvoiceNotFound)
}

func TestInvoiceDeletionRollsBackOnStorageFailure(t *testing.T) {
	user := setupInvoiceDeletionTest(t)
	invoice, _ := createInvoiceDeletionApplication(t, user.Id, 100, PaymentMethodBalance)
	issueInvoiceDeletionApplication(t, invoice.Id)
	failure := errors.New("invoice deletion storage failure")
	const callback = "test:invoice_delete_storage_failure"
	require.NoError(t, DB.Callback().Delete().Before("gorm:delete").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "Invoice" {
			tx.AddError(failure)
		}
	}))
	t.Cleanup(func() { assert.NoError(t, DB.Callback().Delete().Remove(callback)) })
	_, err := DeleteIssuedInvoice(invoice.Id, 42, "清理")
	assert.ErrorIs(t, err, failure)
	stored, err := GetInvoiceById(invoice.Id)
	require.NoError(t, err)
	assert.Equal(t, InvoiceStatusIssued, stored.Status)
	items, err := GetInvoiceItems(invoice.Id)
	require.NoError(t, err)
	assert.Len(t, items, 1)
	var count int64
	require.NoError(t, DB.Model(&InvoiceDeletion{}).Count(&count).Error)
	assert.Zero(t, count)
}

func TestInvoiceIdentityReservationsUpgradeAndPreserveHistory(t *testing.T) {
	user := setupInvoiceDeletionTest(t)
	operation_setting.GetInvoiceSetting().TaxRate = 0
	// 用升级前的四张表建立旧数据，再创建本次新增的凭据和编号表。
	require.NoError(t, DB.Migrator().DropTable(&InvoiceDeletion{}, &InvoiceIDReservation{}))
	legacy := Invoice{Id: 100, UserId: user.Id, Status: InvoiceStatusIssued, OrderAmount: "40.00", Title: "历史开票抬头", TaxNo: "91310000123456789B", Email: "legacy@example.test", FileKey: "legacy.pdf"}
	require.NoError(t, DB.Create(&legacy).Error)
	legacyItem := InvoiceItem{InvoiceId: legacy.Id, OrderType: InvoiceOrderTopUp, OrderId: 9876, Amount: "40.00", TradeNo: "legacy-order"}
	legacyLock := InvoiceOrderLock{InvoiceId: legacy.Id, OrderType: legacyItem.OrderType, OrderId: legacyItem.OrderId}
	legacyPayment := InvoiceTaxPayment{InvoiceId: legacy.Id, UserId: user.Id, TradeNo: "legacy-payment", PaymentMethod: "alipay", Gateway: "default", Status: InvoiceTaxPaymentPaid, Amount: "2.40"}
	require.NoError(t, DB.Create(&legacyItem).Error)
	require.NoError(t, DB.Create(&legacyLock).Error)
	require.NoError(t, DB.Create(&legacyPayment).Error)
	for range 2 {
		require.NoError(t, DB.AutoMigrate(&Invoice{}, &InvoiceItem{}, &InvoiceOrderLock{}, &InvoiceTaxPayment{}, &InvoiceDeletion{}, &InvoiceIDReservation{}))
		require.NoError(t, InitializeInvoiceIDReservations(DB))
	}
	var loadedInvoice Invoice
	var loadedItem InvoiceItem
	var loadedLock InvoiceOrderLock
	var loadedPayment InvoiceTaxPayment
	require.NoError(t, DB.First(&loadedInvoice, legacy.Id).Error)
	require.NoError(t, DB.First(&loadedItem, legacyItem.Id).Error)
	require.NoError(t, DB.First(&loadedLock, legacyLock.Id).Error)
	require.NoError(t, DB.First(&loadedPayment, legacyPayment.Id).Error)
	assert.Equal(t, legacy, loadedInvoice)
	assert.Equal(t, legacyItem, loadedItem)
	assert.Equal(t, legacyLock, loadedLock)
	assert.Equal(t, legacyPayment, loadedPayment)
	assert.Error(t, DB.Create(&InvoiceOrderLock{OrderType: legacyLock.OrderType, OrderId: legacyLock.OrderId, InvoiceId: 999}).Error)
	assert.Error(t, DB.Create(&InvoiceTaxPayment{InvoiceId: 999, TradeNo: legacyPayment.TradeNo}).Error)
	created, _ := createInvoiceDeletionApplication(t, user.Id, 30, "")
	assert.Greater(t, created.Id, legacy.Id)

	// 即使申请已不在主表，任何历史关联中的高编号也不能再分配。
	for _, source := range []struct {
		name  string
		id    int
		model any
	}{
		{"item", 1000, &InvoiceItem{InvoiceId: 1000, OrderId: 1, Amount: "10.00"}},
		{"lock", 2000, &InvoiceOrderLock{InvoiceId: 2000, OrderType: InvoiceOrderTopUp, OrderId: 2000}},
		{"tax_payment", 3000, &InvoiceTaxPayment{InvoiceId: 3000, UserId: user.Id, TradeNo: "historical-tax", Amount: "1.00", Status: InvoiceTaxPaymentPaid}},
		{"deletion", 4000, &InvoiceDeletion{InvoiceID: 4000, UserID: user.Id, OrderAmount: "20.00", DeletedBy: 42, Reason: "历史凭据"}},
		{"reservation", 5000, &InvoiceIDReservation{ID: 5000}},
	} {
		t.Run(source.name, func(t *testing.T) {
			require.NoError(t, DB.Create(source.model).Error)
			for range 2 {
				require.NoError(t, InitializeInvoiceIDReservations(DB))
			}
			created, _ := createInvoiceDeletionApplication(t, user.Id, 30, "")
			assert.Greater(t, created.Id, source.id)
		})
	}
	highest, _ := createInvoiceDeletionApplication(t, user.Id, 50, "")
	issueInvoiceDeletionApplication(t, highest.Id)
	_, err := DeleteIssuedInvoice(highest.Id, 42, "删除当前最大编号")
	require.NoError(t, err)
	for range 2 {
		require.NoError(t, DB.AutoMigrate(&InvoiceDeletion{}, &InvoiceIDReservation{}))
		require.NoError(t, InitializeInvoiceIDReservations(DB))
	}
	next, _ := createInvoiceDeletionApplication(t, user.Id, 50, "")
	assert.Greater(t, next.Id, highest.Id)

	// 账号已删除且仅剩删除凭据时，申请人和操作人的历史身份也不能复用。
	require.NoError(t, InitializeUserIDReservations(DB))
	baseline := UserIDReservation{}
	require.NoError(t, DB.Create(&baseline).Error)
	for i, reference := range []struct {
		name      string
		userID    int
		deletedBy int
	}{
		{"historical_user", baseline.ID + 100, 42},
		{"historical_admin", user.Id, baseline.ID + 200},
	} {
		t.Run(reference.name, func(t *testing.T) {
			historicalID := max(reference.userID, reference.deletedBy)
			var existing int64
			require.NoError(t, DB.Unscoped().Model(&User{}).Where("id = ?", historicalID).Count(&existing).Error)
			require.Zero(t, existing, "历史身份只能保留在删除凭据中")
			receipt := InvoiceDeletion{
				InvoiceID: next.Id + i + 1, UserID: reference.userID,
				DeletedBy: reference.deletedBy, OrderAmount: "10.00", Reason: "历史身份保留",
			}
			require.NoError(t, DB.Create(&receipt).Error)
			for range 2 {
				require.NoError(t, InitializeUserIDReservations(DB))
			}
			createdUser := User{
				Username: reference.name, AffCode: reference.name, Password: "unused-password-hash",
				Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default",
			}
			require.NoError(t, createdUser.CreateWithReservedID(DB))
			assert.Greater(t, createdUser.Id, historicalID)
			var preserved InvoiceDeletion
			require.NoError(t, DB.First(&preserved, receipt.InvoiceID).Error)
			assert.Equal(t, receipt, preserved, "身份初始化不能改写历史删除凭据")
		})
	}
}
