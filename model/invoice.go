package model

import (
	"cmp"
	"errors"
	"fmt"
	"net/mail"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

const (
	InvoiceStatusPendingPayment = "pending_payment"
	InvoiceStatusPendingReview  = "pending_review"
	InvoiceStatusIssued         = "issued"
	InvoiceStatusRejected       = "rejected"
	InvoiceStatusCancelled      = "cancelled"

	InvoiceTypeNormal  = "normal"
	InvoiceTypeSpecial = "special"

	InvoiceTitleCompany  = "company"
	InvoiceTitlePersonal = "personal"

	InvoiceOrderTopUp        = "topup"
	InvoiceOrderSubscription = "subscription"
	InvoiceOrderRedemption   = "redemption"

	// InvoiceMaxOrders is the most orders one application may include.
	InvoiceMaxOrders = 100
)

var (
	ErrInvoiceNotFound         error = common.NewMessage("Invoice application not found")
	ErrInvoiceAlreadyProcessed error = common.NewMessage("This invoice application has already been processed")
	ErrInvoiceOrderUnavailable error = common.NewMessage("Some orders are not available for invoicing")
	ErrInvoiceOrderExpired     error = common.NewMessage("Some orders are outside the invoicing period")
	ErrInvoiceOrderTaken       error = common.NewMessage("Some orders are already used by another invoice application")
	ErrInvoiceFileMissing      error = common.NewMessage("Upload the invoice file first")
	ErrInvoiceCallbackMismatch       = errors.New("invoice tax callback does not match the application")
)

// Invoice is one invoice application. Money columns hold decimal text with two
// places, so no database float rounding touches them.
type Invoice struct {
	Id               int     `json:"id"`
	UserId           int     `json:"user_id" gorm:"index"`
	Status           string  `json:"status" gorm:"type:varchar(32);index"`
	InvoiceType      string  `json:"invoice_type" gorm:"type:varchar(16)"`
	TitleType        string  `json:"title_type" gorm:"type:varchar(16)"`
	Title            string  `json:"title" gorm:"type:varchar(255)"`
	TaxNo            string  `json:"tax_no" gorm:"type:varchar(64)"`
	RegAddress       string  `json:"reg_address" gorm:"type:varchar(512)"`
	RegPhone         string  `json:"reg_phone" gorm:"type:varchar(64)"`
	BankName         string  `json:"bank_name" gorm:"type:varchar(255)"`
	BankAccount      string  `json:"bank_account" gorm:"type:varchar(128)"`
	Category         string  `json:"category" gorm:"type:varchar(255)"`
	Email            string  `json:"email" gorm:"type:varchar(255)"`
	OrderAmount      string  `json:"order_amount" gorm:"type:varchar(32)"`
	TaxRate          string  `json:"tax_rate" gorm:"type:varchar(16)"`
	TaxAmount        string  `json:"tax_amount" gorm:"type:varchar(32)"`
	InvoiceAmount    string  `json:"invoice_amount" gorm:"type:varchar(32)"`
	TaxTradeNo       *string `json:"tax_trade_no" gorm:"type:varchar(128);uniqueIndex"` // NULL when no tax is due
	TaxPaymentMethod string  `json:"tax_payment_method" gorm:"type:varchar(50)"`
	TaxGateway       string  `json:"tax_gateway" gorm:"type:varchar(64)"`
	TaxPaidTime      int64   `json:"tax_paid_time"`
	RejectReason     string  `json:"reject_reason" gorm:"type:varchar(1024)"`
	FileName         string  `json:"file_name" gorm:"type:varchar(255)"`
	FileKey          string  `json:"-" gorm:"type:varchar(64)"`
	FileSize         int64   `json:"file_size"`
	FileMime         string  `json:"file_mime" gorm:"type:varchar(64)"`
	AdminRemark      string  `json:"admin_remark,omitempty" gorm:"type:varchar(1024)"`
	CreateTime       int64   `json:"create_time" gorm:"index"`
	UpdateTime       int64   `json:"update_time"`
	IssuedTime       int64   `json:"issued_time"`
}

// InvoiceItem is the snapshot of one order included in an application.
type InvoiceItem struct {
	Id        int    `json:"id"`
	InvoiceId int    `json:"invoice_id" gorm:"index"`
	OrderType string `json:"order_type" gorm:"type:varchar(16)"`
	OrderId   int    `json:"order_id"`
	TradeNo   string `json:"trade_no" gorm:"type:varchar(255)"`
	Amount    string `json:"amount" gorm:"type:varchar(32)"`
	OrderTime int64  `json:"order_time"`
}

// InvoiceOrderLock holds an order for one live application. The unique index
// lets only one application claim an order on every supported database.
type InvoiceOrderLock struct {
	Id        int    `json:"id"`
	OrderType string `json:"order_type" gorm:"type:varchar(16);uniqueIndex:idx_invoice_order_lock"`
	OrderId   int    `json:"order_id" gorm:"uniqueIndex:idx_invoice_order_lock"`
	InvoiceId int    `json:"invoice_id" gorm:"index"`
}

// InvoiceOrder is an order the user can include in an application.
type InvoiceOrder struct {
	OrderType string `json:"order_type"`
	OrderId   int    `json:"order_id"`
	TradeNo   string `json:"trade_no"`
	Amount    string `json:"amount"`
	OrderTime int64  `json:"order_time"`
}

// InvoiceOrderRef names one order in a submit request.
type InvoiceOrderRef struct {
	OrderType string `json:"order_type"`
	OrderId   int    `json:"order_id"`
}

// InvoiceAmounts is the money of one application, two decimal places.
type InvoiceAmounts struct {
	OrderAmount   decimal.Decimal
	TaxRate       decimal.Decimal
	TaxAmount     decimal.Decimal
	InvoiceAmount decimal.Decimal
}

// CalculateInvoiceAmounts applies a percent tax rate to the order total.
// Every amount is rounded half away from zero to two decimal places.
func CalculateInvoiceAmounts(orderAmounts []decimal.Decimal, taxRatePercent decimal.Decimal) InvoiceAmounts {
	total := decimal.Zero
	for _, amount := range orderAmounts {
		total = total.Add(amount)
	}
	total = total.Round(2)
	tax := total.Mul(taxRatePercent).Div(decimal.NewFromInt(100)).Round(2)
	return InvoiceAmounts{
		OrderAmount:   total,
		TaxRate:       taxRatePercent,
		TaxAmount:     tax,
		InvoiceAmount: total.Add(tax),
	}
}

func invoiceMoney(value float64) decimal.Decimal {
	return decimal.NewFromFloat(value).Round(2)
}

func redemptionInvoiceMoney(quota int) decimal.Decimal {
	if common.QuotaPerUnit <= 0 {
		return decimal.Zero
	}
	return decimal.NewFromInt(int64(quota)).Div(decimal.NewFromFloat(common.QuotaPerUnit)).Round(2)
}

// ExpireStaleInvoices cancels pending-payment applications older than the
// current timeout setting and releases their orders. There is no background
// job; callers run it before reading or creating applications.
func ExpireStaleInvoices() {
	cutoff := common.GetTimestamp() - int64(operation_setting.InvoicePaymentTimeoutMinutes())*60
	var ids []int
	if err := DB.Model(&Invoice{}).
		Where("status = ? AND create_time < ?", InvoiceStatusPendingPayment, cutoff).
		Pluck("id", &ids).Error; err != nil {
		common.SysError(common.LogText("failed to find stale invoice applications: %s", err.Error()))
		return
	}
	for _, id := range ids {
		err := DB.Transaction(func(tx *gorm.DB) error {
			return cancelPendingInvoice(tx, id, 0)
		})
		if err != nil && !errors.Is(err, ErrInvoiceAlreadyProcessed) {
			common.SysError(common.LogText("failed to cancel stale invoice application %d: %s", id, err.Error()))
		}
	}
}

// cancelPendingInvoice moves a pending-payment application to cancelled and
// releases its orders. userId 0 skips the owner check.
func cancelPendingInvoice(tx *gorm.DB, id int, userId int) error {
	query := tx.Model(&Invoice{}).Where("id = ? AND status = ?", id, InvoiceStatusPendingPayment)
	if userId > 0 {
		query = query.Where("user_id = ?", userId)
	}
	result := query.Updates(map[string]any{
		"status":      InvoiceStatusCancelled,
		"update_time": common.GetTimestamp(),
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrInvoiceAlreadyProcessed
	}
	return tx.Where("invoice_id = ?", id).Delete(&InvoiceOrderLock{}).Error
}

// CancelInvoice lets the owner cancel an application that is not paid yet.
func CancelInvoice(userId int, id int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		return cancelPendingInvoice(tx, id, userId)
	})
}

func invoiceOrderCutoff() int64 {
	return common.GetTimestamp() - int64(operation_setting.InvoiceOrderDays())*86400
}

// loadInvoiceOrders returns the user's completed Epay top-ups, Epay
// subscription orders, and used redemption codes with a positive amount.
// cutoff > 0 keeps only orders completed at or after it; ids limits each type.
func loadInvoiceOrders(tx *gorm.DB, userId int, cutoff int64, ids map[string][]int) ([]InvoiceOrder, error) {
	orders := make([]InvoiceOrder, 0)
	wantType := func(orderType string) bool {
		return ids == nil || len(ids[orderType]) > 0
	}

	if wantType(InvoiceOrderTopUp) {
		var topUps []TopUp
		query := tx.Where("user_id = ? AND payment_provider = ? AND status = ? AND complete_time >= ?",
			userId, PaymentProviderEpay, common.TopUpStatusSuccess, cutoff)
		if ids != nil {
			query = query.Where("id IN ?", ids[InvoiceOrderTopUp])
		}
		if err := query.Find(&topUps).Error; err != nil {
			return nil, err
		}
		for _, topUp := range topUps {
			orders = append(orders, InvoiceOrder{InvoiceOrderTopUp, topUp.Id, topUp.TradeNo, invoiceMoney(topUp.Money).StringFixed(2), topUp.CompleteTime})
		}
	}

	if wantType(InvoiceOrderSubscription) {
		var subscriptionOrders []SubscriptionOrder
		query := tx.Where("user_id = ? AND payment_provider = ? AND status = ? AND complete_time >= ?",
			userId, PaymentProviderEpay, common.TopUpStatusSuccess, cutoff)
		if ids != nil {
			query = query.Where("id IN ?", ids[InvoiceOrderSubscription])
		}
		if err := query.Find(&subscriptionOrders).Error; err != nil {
			return nil, err
		}
		for _, order := range subscriptionOrders {
			orders = append(orders, InvoiceOrder{InvoiceOrderSubscription, order.Id, order.TradeNo, invoiceMoney(order.Money).StringFixed(2), order.CompleteTime})
		}
	}

	if wantType(InvoiceOrderRedemption) {
		var redemptions []Redemption
		// Unscoped: a code deleted after it was redeemed still counts.
		query := tx.Unscoped().Where("used_user_id = ? AND status = ? AND redeemed_time >= ?",
			userId, common.RedemptionCodeStatusUsed, cutoff)
		if ids != nil {
			query = query.Where("id IN ?", ids[InvoiceOrderRedemption])
		}
		if err := query.Find(&redemptions).Error; err != nil {
			return nil, err
		}
		for _, redemption := range redemptions {
			orders = append(orders, InvoiceOrder{InvoiceOrderRedemption, redemption.Id, fmt.Sprintf("RDM%d", redemption.Id), redemptionInvoiceMoney(redemption.Quota).StringFixed(2), redemption.RedeemedTime})
		}
	}

	positive := orders[:0]
	for _, order := range orders {
		if amount, err := decimal.NewFromString(order.Amount); err == nil && amount.IsPositive() {
			positive = append(positive, order)
		}
	}
	return positive, nil
}

// InvoiceInput is a submitted application. TaxPaymentMethod and TaxGateway
// are filled by the controller after it resolves the chosen payment method.
type InvoiceInput struct {
	InvoiceType      string            `json:"invoice_type"`
	TitleType        string            `json:"title_type"`
	Title            string            `json:"title"`
	TaxNo            string            `json:"tax_no"`
	RegAddress       string            `json:"reg_address"`
	RegPhone         string            `json:"reg_phone"`
	BankName         string            `json:"bank_name"`
	BankAccount      string            `json:"bank_account"`
	Category         string            `json:"category"`
	Email            string            `json:"email"`
	Orders           []InvoiceOrderRef `json:"orders"`
	PaymentMethod    string            `json:"payment_method"`
	Gateway          string            `json:"gateway"`
	TaxPaymentMethod string            `json:"-"`
	TaxGateway       string            `json:"-"`
}

func invoiceTextTooLong(value string, max int) bool {
	return utf8.RuneCountInString(value) > max
}

// Normalize trims the text fields and checks them against the invoice rules.
// It does not look at orders or payment.
func (input *InvoiceInput) Normalize() error {
	for _, field := range []*string{&input.InvoiceType, &input.TitleType, &input.Title, &input.TaxNo, &input.RegAddress, &input.RegPhone, &input.BankName, &input.BankAccount, &input.Category, &input.Email} {
		*field = strings.TrimSpace(*field)
	}
	switch input.InvoiceType {
	case InvoiceTypeNormal:
	case InvoiceTypeSpecial:
		if !operation_setting.GetInvoiceSetting().SpecialEnabled {
			return common.NewMessage("Special VAT invoices are not available")
		}
		// A special invoice is always issued to a company.
		input.TitleType = InvoiceTitleCompany
	default:
		return common.NewMessage("Invalid invoice type")
	}
	if input.TitleType != InvoiceTitleCompany && input.TitleType != InvoiceTitlePersonal {
		return common.NewMessage("Invalid invoice title type")
	}
	if input.Title == "" || invoiceTextTooLong(input.Title, 100) {
		return common.NewMessage("Enter an invoice title of at most {{max}} characters", map[string]any{"max": 100})
	}
	if input.TitleType == InvoiceTitleCompany && input.TaxNo == "" {
		return common.NewMessage("Enter the taxpayer identification number")
	}
	if invoiceTextTooLong(input.TaxNo, 30) {
		return common.NewMessage("The taxpayer identification number can have at most {{max}} characters", map[string]any{"max": 30})
	}
	if input.InvoiceType == InvoiceTypeSpecial {
		if input.RegAddress == "" || input.RegPhone == "" || input.BankName == "" || input.BankAccount == "" {
			return common.NewMessage("A special VAT invoice requires the registered address, registered phone, bank name, and bank account")
		}
	} else {
		input.RegAddress, input.RegPhone, input.BankName, input.BankAccount = "", "", "", ""
	}
	if invoiceTextTooLong(input.RegAddress, 200) || invoiceTextTooLong(input.RegPhone, 30) ||
		invoiceTextTooLong(input.BankName, 100) || invoiceTextTooLong(input.BankAccount, 50) {
		return common.NewMessage("Some invoice details are too long")
	}
	if !slices.Contains(operation_setting.InvoiceCategories(), input.Category) {
		return common.NewMessage("Select a product category")
	}
	address, err := mail.ParseAddress(input.Email)
	if err != nil || address.Address != input.Email || invoiceTextTooLong(input.Email, 100) {
		return common.NewMessage("Invalid email address")
	}
	return nil
}

// UniqueInvoiceOrderRefs removes duplicate and malformed order references
// and checks the count limit.
func UniqueInvoiceOrderRefs(refs []InvoiceOrderRef) ([]InvoiceOrderRef, error) {
	unique := make([]InvoiceOrderRef, 0, len(refs))
	seen := make(map[InvoiceOrderRef]struct{}, len(refs))
	for _, ref := range refs {
		switch ref.OrderType {
		case InvoiceOrderTopUp, InvoiceOrderSubscription, InvoiceOrderRedemption:
		default:
			return nil, ErrInvoiceOrderUnavailable
		}
		if ref.OrderId <= 0 {
			return nil, ErrInvoiceOrderUnavailable
		}
		if _, duplicate := seen[ref]; duplicate {
			continue
		}
		seen[ref] = struct{}{}
		unique = append(unique, ref)
	}
	if len(unique) == 0 {
		return nil, common.NewMessage("Select at least one order")
	}
	if len(unique) > InvoiceMaxOrders {
		return nil, common.NewMessage("An application can include at most {{max}} orders", map[string]any{"max": InvoiceMaxOrders})
	}
	return unique, nil
}

// QuoteInvoice recomputes the amounts of the selected orders the way
// CreateInvoice does, without claiming them.
func QuoteInvoice(userId int, refs []InvoiceOrderRef) (InvoiceAmounts, error) {
	refs, err := UniqueInvoiceOrderRefs(refs)
	if err != nil {
		return InvoiceAmounts{}, err
	}
	orders, err := resolveInvoiceOrders(DB, userId, refs)
	if err != nil {
		return InvoiceAmounts{}, err
	}
	return invoiceAmountsOf(orders), nil
}

// resolveInvoiceOrders loads exactly the referenced orders and checks the
// invoicing period. It does not check the order locks.
func resolveInvoiceOrders(tx *gorm.DB, userId int, refs []InvoiceOrderRef) ([]InvoiceOrder, error) {
	ids := make(map[string][]int)
	for _, ref := range refs {
		ids[ref.OrderType] = append(ids[ref.OrderType], ref.OrderId)
	}
	orders, err := loadInvoiceOrders(tx, userId, 0, ids)
	if err != nil {
		return nil, err
	}
	if len(orders) != len(refs) {
		return nil, ErrInvoiceOrderUnavailable
	}
	cutoff := invoiceOrderCutoff()
	for _, order := range orders {
		if order.OrderTime < cutoff {
			return nil, ErrInvoiceOrderExpired
		}
	}
	slices.SortFunc(orders, func(a, b InvoiceOrder) int {
		return cmp.Or(cmp.Compare(b.OrderTime, a.OrderTime), cmp.Compare(a.OrderType, b.OrderType), cmp.Compare(a.OrderId, b.OrderId))
	})
	return orders, nil
}

func invoiceAmountsOf(orders []InvoiceOrder) InvoiceAmounts {
	amounts := make([]decimal.Decimal, 0, len(orders))
	for _, order := range orders {
		amounts = append(amounts, decimal.RequireFromString(order.Amount))
	}
	return CalculateInvoiceAmounts(amounts, decimal.NewFromFloat(operation_setting.InvoiceTaxRate()))
}

// NewInvoiceTaxTradeNo returns an Epay order number for an invoice tax
// payment. The INV prefix keeps it apart from top-up and subscription orders.
func NewInvoiceTaxTradeNo(userId int) string {
	return fmt.Sprintf("INVUSR%dNO%s%d", userId, common.GetRandomString(6), common.GetTimestamp())
}

// CreateInvoice stores a new application and claims its orders in one
// transaction. With a positive tax the application waits for payment;
// with no tax it goes straight to review.
func CreateInvoice(userId int, input *InvoiceInput) (*Invoice, []InvoiceItem, error) {
	refs, err := UniqueInvoiceOrderRefs(input.Orders)
	if err != nil {
		return nil, nil, err
	}
	now := common.GetTimestamp()
	invoice := &Invoice{
		UserId:      userId,
		InvoiceType: input.InvoiceType,
		TitleType:   input.TitleType,
		Title:       input.Title,
		TaxNo:       input.TaxNo,
		RegAddress:  input.RegAddress,
		RegPhone:    input.RegPhone,
		BankName:    input.BankName,
		BankAccount: input.BankAccount,
		Category:    input.Category,
		Email:       input.Email,
		CreateTime:  now,
		UpdateTime:  now,
	}
	var items []InvoiceItem
	err = DB.Transaction(func(tx *gorm.DB) error {
		orders, err := resolveInvoiceOrders(tx, userId, refs)
		if err != nil {
			return err
		}
		amounts := invoiceAmountsOf(orders)
		invoice.OrderAmount = amounts.OrderAmount.StringFixed(2)
		invoice.TaxRate = amounts.TaxRate.String()
		invoice.TaxAmount = amounts.TaxAmount.StringFixed(2)
		invoice.InvoiceAmount = amounts.InvoiceAmount.StringFixed(2)
		if amounts.TaxAmount.IsPositive() {
			if input.TaxPaymentMethod == "" {
				return common.NewMessage("Select a payment method")
			}
			tradeNo := NewInvoiceTaxTradeNo(userId)
			invoice.Status = InvoiceStatusPendingPayment
			invoice.TaxTradeNo = &tradeNo
			invoice.TaxPaymentMethod = input.TaxPaymentMethod
			invoice.TaxGateway = operation_setting.NormalizeEpayGateway(input.TaxGateway)
		} else {
			invoice.Status = InvoiceStatusPendingReview
		}
		if err := tx.Create(invoice).Error; err != nil {
			return err
		}
		for _, order := range orders {
			lock := &InvoiceOrderLock{OrderType: order.OrderType, OrderId: order.OrderId, InvoiceId: invoice.Id}
			// The unique index on (order_type, order_id) rejects an order
			// another application already holds.
			if err := tx.Create(lock).Error; err != nil {
				common.SysLog(common.LogText("invoice order lock rejected order_type=%s order_id=%d: %s", order.OrderType, order.OrderId, err.Error()))
				return ErrInvoiceOrderTaken
			}
			items = append(items, InvoiceItem{InvoiceId: invoice.Id, OrderType: order.OrderType, OrderId: order.OrderId, TradeNo: order.TradeNo, Amount: order.Amount, OrderTime: order.OrderTime})
		}
		return tx.Create(&items).Error
	})
	if err != nil {
		return nil, nil, err
	}
	return invoice, items, nil
}

// ListInvoiceableOrders returns the user's orders inside the invoicing period
// that no live application holds, newest first.
func ListInvoiceableOrders(userId int) ([]InvoiceOrder, error) {
	orders, err := loadInvoiceOrders(DB, userId, invoiceOrderCutoff(), nil)
	if err != nil {
		return nil, err
	}
	ids := make(map[string][]int)
	for _, order := range orders {
		ids[order.OrderType] = append(ids[order.OrderType], order.OrderId)
	}
	taken := make(map[InvoiceOrderRef]struct{})
	for orderType, orderIds := range ids {
		var locks []InvoiceOrderLock
		if err := DB.Where("order_type = ? AND order_id IN ?", orderType, orderIds).Find(&locks).Error; err != nil {
			return nil, err
		}
		for _, lock := range locks {
			taken[InvoiceOrderRef{lock.OrderType, lock.OrderId}] = struct{}{}
		}
	}
	free := make([]InvoiceOrder, 0, len(orders))
	for _, order := range orders {
		if _, held := taken[InvoiceOrderRef{order.OrderType, order.OrderId}]; !held {
			free = append(free, order)
		}
	}
	slices.SortFunc(free, func(a, b InvoiceOrder) int {
		return cmp.Or(cmp.Compare(b.OrderTime, a.OrderTime), cmp.Compare(a.OrderType, b.OrderType), cmp.Compare(b.OrderId, a.OrderId))
	})
	return free, nil
}

// InvoiceSummaryCard is one statistics card: an order amount and a count.
type InvoiceSummaryCard struct {
	Amount string `json:"amount"`
	Count  int    `json:"count"`
}

type InvoiceSummary struct {
	Available  InvoiceSummaryCard `json:"available"`
	Processing InvoiceSummaryCard `json:"processing"`
	Issued     InvoiceSummaryCard `json:"issued"`
}

// GetInvoiceSummary totals order amounts: free orders, applications waiting
// for payment or review, and issued applications.
func GetInvoiceSummary(userId int) (*InvoiceSummary, error) {
	orders, err := ListInvoiceableOrders(userId)
	if err != nil {
		return nil, err
	}
	available := decimal.Zero
	for _, order := range orders {
		available = available.Add(decimal.RequireFromString(order.Amount))
	}
	var invoices []Invoice
	if err := DB.Select("status", "order_amount").
		Where("user_id = ? AND status IN ?", userId, []string{InvoiceStatusPendingPayment, InvoiceStatusPendingReview, InvoiceStatusIssued}).
		Find(&invoices).Error; err != nil {
		return nil, err
	}
	processing, issued := decimal.Zero, decimal.Zero
	summary := &InvoiceSummary{Available: InvoiceSummaryCard{Count: len(orders)}}
	for _, invoice := range invoices {
		amount, err := decimal.NewFromString(invoice.OrderAmount)
		if err != nil {
			continue
		}
		if invoice.Status == InvoiceStatusIssued {
			issued = issued.Add(amount)
			summary.Issued.Count++
		} else {
			processing = processing.Add(amount)
			summary.Processing.Count++
		}
	}
	summary.Available.Amount = available.StringFixed(2)
	summary.Processing.Amount = processing.StringFixed(2)
	summary.Issued.Amount = issued.StringFixed(2)
	return summary, nil
}

// creditInvoiceTaxRefund returns paid tax to the wallet at 1 CNY = 1 unit of
// balance. It adds plain quota with no wallet-ceiling predicate, so a refund
// cannot fail because the balance is near the limit, and none of it is marked
// unpaid, so it counts as purchased balance.
func creditInvoiceTaxRefund(tx *gorm.DB, userId int, taxAmount string) (int, error) {
	tax, err := decimal.NewFromString(taxAmount)
	if err != nil {
		return 0, err
	}
	if !tax.IsPositive() {
		return 0, nil
	}
	quota, err := common.WalletQuotaFromDecimalStrict(tax.Mul(decimal.NewFromFloat(common.QuotaPerUnit)))
	if err != nil {
		return 0, err
	}
	if quota <= 0 {
		return 0, nil
	}
	result := tx.Model(&User{}).Where("id = ?", userId).Update("quota", gorm.Expr("quota + ?", quota))
	if result.Error != nil {
		return 0, result.Error
	}
	if result.RowsAffected == 0 {
		return 0, gorm.ErrRecordNotFound
	}
	return quota, nil
}

// InvoiceTaxPaymentResult tells the callback handler what happened.
type InvoiceTaxPaymentResult struct {
	Invoice     *Invoice
	AlreadyDone bool // a duplicate callback; nothing changed
	Refunded    bool // the application was cancelled, so the tax went back to the wallet
	RefundQuota int
}

// CompleteInvoiceTaxPayment settles a verified Epay callback for an invoice
// tax order. The order number, the gateway, and the paid amount must all
// match the application. A pending application moves to review; a cancelled
// one gets the tax back once.
func CompleteInvoiceTaxPayment(tradeNo string, paidMoney string, callbackGateway string) (*InvoiceTaxPaymentResult, error) {
	if strings.TrimSpace(tradeNo) == "" {
		return nil, ErrInvoiceNotFound
	}
	result := &InvoiceTaxPaymentResult{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		invoice := &Invoice{}
		if err := lockForUpdate(tx).Where("tax_trade_no = ?", tradeNo).First(invoice).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrInvoiceNotFound
			}
			return err
		}
		result.Invoice = invoice
		if operation_setting.NormalizeEpayGateway(invoice.TaxGateway) != operation_setting.NormalizeEpayGateway(callbackGateway) {
			return ErrInvoiceCallbackMismatch
		}
		paid, err := decimal.NewFromString(strings.TrimSpace(paidMoney))
		if err != nil {
			return ErrInvoiceCallbackMismatch
		}
		expected, err := decimal.NewFromString(invoice.TaxAmount)
		if err != nil || !paid.Round(2).Equal(expected.Round(2)) {
			return ErrInvoiceCallbackMismatch
		}

		now := common.GetTimestamp()
		moved := tx.Model(&Invoice{}).
			Where("id = ? AND status = ?", invoice.Id, InvoiceStatusPendingPayment).
			Updates(map[string]any{"status": InvoiceStatusPendingReview, "tax_paid_time": now, "update_time": now})
		if moved.Error != nil {
			return moved.Error
		}
		if moved.RowsAffected == 1 {
			invoice.Status = InvoiceStatusPendingReview
			invoice.TaxPaidTime = now
			return nil
		}

		// Not pending any more. A cancelled application whose tax was never
		// recorded gets the tax back; tax_paid_time marks the refund as done.
		refundMark := tx.Model(&Invoice{}).
			Where("id = ? AND status = ? AND tax_paid_time = 0", invoice.Id, InvoiceStatusCancelled).
			Updates(map[string]any{"tax_paid_time": now, "update_time": now})
		if refundMark.Error != nil {
			return refundMark.Error
		}
		if refundMark.RowsAffected == 0 {
			result.AlreadyDone = true
			return nil
		}
		quota, err := creditInvoiceTaxRefund(tx, invoice.UserId, invoice.TaxAmount)
		if err != nil {
			return err
		}
		invoice.TaxPaidTime = now
		result.Refunded = true
		result.RefundQuota = quota
		return nil
	})
	if err != nil {
		return result, err
	}
	if result.Refunded {
		syncCreditUserQuotaCache(result.Invoice.UserId, result.RefundQuota, common.LogText("invoice tax refund"))
		RecordLog(result.Invoice.UserId, LogTypeRefund, common.NewMessage(
			"Invoice application {{id}} was already cancelled when its tax payment of ¥{{amount}} arrived, so {{quota}} was returned to your balance",
			map[string]any{"id": result.Invoice.Id, "amount": result.Invoice.TaxAmount, "quota": logger.FormatQuota(result.RefundQuota)}))
	}
	return result, nil
}

// RejectInvoiceResult carries what the caller needs after a rejection.
type RejectInvoiceResult struct {
	Invoice     *Invoice
	OldFileKey  string
	RefundQuota int
}

// RejectInvoice moves an application under review to rejected, releases its
// orders, and returns the paid tax to the wallet, all in one transaction. The
// status compare-and-swap makes a second rejection, or a race with issuing,
// fail without a second refund.
func RejectInvoice(id int, reason string) (*RejectInvoiceResult, error) {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return nil, common.NewMessage("Enter the rejection reason")
	}
	if invoiceTextTooLong(reason, 500) {
		return nil, common.NewMessage("The rejection reason can have at most {{max}} characters", map[string]any{"max": 500})
	}
	result := &RejectInvoiceResult{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		invoice := &Invoice{}
		// The lock keeps a concurrent upload from changing file_key between
		// this read and the update, so the file removed below is the last one.
		if err := lockForUpdate(tx).Where("id = ?", id).First(invoice).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrInvoiceNotFound
			}
			return err
		}
		now := common.GetTimestamp()
		moved := tx.Model(&Invoice{}).
			Where("id = ? AND status = ?", id, InvoiceStatusPendingReview).
			Updates(map[string]any{
				"status":        InvoiceStatusRejected,
				"reject_reason": reason,
				"file_name":     "",
				"file_key":      "",
				"file_size":     0,
				"file_mime":     "",
				"update_time":   now,
			})
		if moved.Error != nil {
			return moved.Error
		}
		if moved.RowsAffected == 0 {
			return ErrInvoiceAlreadyProcessed
		}
		if err := tx.Where("invoice_id = ?", id).Delete(&InvoiceOrderLock{}).Error; err != nil {
			return err
		}
		quota, err := creditInvoiceTaxRefund(tx, invoice.UserId, invoice.TaxAmount)
		if err != nil {
			return err
		}
		result.OldFileKey = invoice.FileKey
		result.RefundQuota = quota
		invoice.Status = InvoiceStatusRejected
		invoice.RejectReason = reason
		invoice.FileName, invoice.FileKey, invoice.FileSize, invoice.FileMime = "", "", 0, ""
		invoice.UpdateTime = now
		result.Invoice = invoice
		return nil
	})
	if err != nil {
		return nil, err
	}
	invoice := result.Invoice
	syncCreditUserQuotaCache(invoice.UserId, result.RefundQuota, common.LogText("invoice tax refund"))
	if result.RefundQuota > 0 {
		RecordLog(invoice.UserId, LogTypeRefund, common.NewMessage(
			"Invoice application {{id}} was rejected and the tax of ¥{{amount}} was returned as {{quota}}",
			map[string]any{"id": invoice.Id, "amount": invoice.TaxAmount, "quota": logger.FormatQuota(result.RefundQuota)}))
	}
	return result, nil
}

// IssueInvoice moves an application under review with an uploaded file to
// issued. The orders stay held for good.
func IssueInvoice(id int) (*Invoice, error) {
	invoice, err := GetInvoiceById(id)
	if err != nil {
		return nil, err
	}
	if invoice.Status != InvoiceStatusPendingReview {
		return nil, ErrInvoiceAlreadyProcessed
	}
	if invoice.FileKey == "" {
		return nil, ErrInvoiceFileMissing
	}
	now := common.GetTimestamp()
	result := DB.Model(&Invoice{}).
		Where("id = ? AND status = ? AND file_key <> ''", id, InvoiceStatusPendingReview).
		Updates(map[string]any{"status": InvoiceStatusIssued, "issued_time": now, "update_time": now})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, ErrInvoiceAlreadyProcessed
	}
	invoice.Status = InvoiceStatusIssued
	invoice.IssuedTime = now
	invoice.UpdateTime = now
	return invoice, nil
}

// InvoiceFile describes a stored invoice file.
type InvoiceFile struct {
	Name string
	Key  string
	Size int64
	Mime string
}

// SetInvoiceFile records a new file on an application under review and
// returns the key of the file it replaced, which the caller deletes.
func SetInvoiceFile(id int, file InvoiceFile) (string, error) {
	var oldKey string
	err := DB.Transaction(func(tx *gorm.DB) error {
		invoice := &Invoice{}
		if err := lockForUpdate(tx).Where("id = ?", id).First(invoice).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrInvoiceNotFound
			}
			return err
		}
		result := tx.Model(&Invoice{}).
			Where("id = ? AND status = ? AND file_key = ?", id, InvoiceStatusPendingReview, invoice.FileKey).
			Updates(map[string]any{
				"file_name":   file.Name,
				"file_key":    file.Key,
				"file_size":   file.Size,
				"file_mime":   file.Mime,
				"update_time": common.GetTimestamp(),
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return common.NewMessage("Invoice files can only be uploaded while the application is under review")
		}
		oldKey = invoice.FileKey
		return nil
	})
	return oldKey, err
}

// SetInvoiceTaxPayment records the payment method of a new payment attempt
// for an application that still waits for payment.
func SetInvoiceTaxPayment(userId int, id int, method string, gateway string) (*Invoice, error) {
	result := DB.Model(&Invoice{}).
		Where("id = ? AND user_id = ? AND status = ?", id, userId, InvoiceStatusPendingPayment).
		Updates(map[string]any{
			"tax_payment_method": method,
			"tax_gateway":        operation_setting.NormalizeEpayGateway(gateway),
			"update_time":        common.GetTimestamp(),
		})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, ErrInvoiceAlreadyProcessed
	}
	return GetUserInvoice(userId, id)
}

func GetInvoiceById(id int) (*Invoice, error) {
	invoice := &Invoice{}
	if err := DB.Where("id = ?", id).First(invoice).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvoiceNotFound
		}
		return nil, err
	}
	return invoice, nil
}

// GetUserInvoice returns the application only when it belongs to the user.
// Another user's application reads as not found.
func GetUserInvoice(userId int, id int) (*Invoice, error) {
	invoice := &Invoice{}
	if err := DB.Where("id = ? AND user_id = ?", id, userId).First(invoice).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvoiceNotFound
		}
		return nil, err
	}
	return invoice, nil
}

func GetInvoiceItems(invoiceId int) ([]InvoiceItem, error) {
	var items []InvoiceItem
	err := DB.Where("invoice_id = ?", invoiceId).Order("order_time desc, id asc").Find(&items).Error
	return items, err
}

// InvoiceQuery filters an application list. UserId 0 lists every user.
type InvoiceQuery struct {
	UserId  int
	Status  string
	Keyword string
}

func ListInvoices(query InvoiceQuery, startIdx int, num int) ([]*Invoice, int64, error) {
	tx := DB.Model(&Invoice{})
	if query.UserId > 0 {
		tx = tx.Where("user_id = ?", query.UserId)
	}
	if query.Status != "" {
		tx = tx.Where("status = ?", query.Status)
	}
	if keyword := strings.TrimSpace(query.Keyword); keyword != "" {
		if id, err := strconv.Atoi(keyword); err == nil {
			tx = tx.Where("id = ? OR user_id = ? OR title LIKE ?", id, id, "%"+keyword+"%")
		} else {
			tx = tx.Where("title LIKE ? OR tax_no LIKE ? OR tax_trade_no LIKE ?", "%"+keyword+"%", keyword+"%", keyword+"%")
		}
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var invoices []*Invoice
	if err := tx.Order("id desc").Limit(num).Offset(startIdx).Find(&invoices).Error; err != nil {
		return nil, 0, err
	}
	return invoices, total, nil
}
