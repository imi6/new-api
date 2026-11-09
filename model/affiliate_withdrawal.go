package model

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

var affiliateTransactionPattern = regexp.MustCompile(`^(0x)?[0-9a-fA-F]{64}$`)

type AffiliateWithdrawal struct {
	ID              int64  `json:"id" gorm:"primaryKey"`
	UserID          int    `json:"user_id" gorm:"not null;index;uniqueIndex:idx_aff_withdraw_request,priority:1"`
	RequestID       string `json:"request_id" gorm:"size:64;not null;uniqueIndex:idx_aff_withdraw_request,priority:2"`
	RequestHash     string `json:"-" gorm:"size:64;not null"`
	AmountUnits     int64  `json:"-" gorm:"type:bigint;not null"`
	FeeUnits        int64  `json:"-" gorm:"type:bigint;not null"`
	NetUnits        int64  `json:"-" gorm:"type:bigint;not null"`
	Amount          string `json:"amount" gorm:"-"`
	Fee             string `json:"fee" gorm:"-"`
	NetAmount       string `json:"net_amount" gorm:"-"`
	ActualAmount    string `json:"actual_amount" gorm:"-"`
	ActualFee       string `json:"actual_fee" gorm:"-"`
	RefundedAmount  string `json:"refunded_amount" gorm:"-"`
	Network         string `json:"network" gorm:"size:32;not null"`
	Address         string `json:"address" gorm:"size:128;not null"`
	Status          string `json:"status" gorm:"size:16;not null;index"`
	Version         int64  `json:"version" gorm:"not null;default:1"`
	ConfigVersion   string `json:"config_version" gorm:"size:64;not null"`
	ConfigSnapshot  string `json:"-" gorm:"type:text;not null"`
	CancelFeePolicy string `json:"cancel_fee_policy" gorm:"size:16;not null"`
	FailedFeePolicy string `json:"failed_fee_policy" gorm:"size:16;not null"`
	TransactionID   string `json:"transaction_id" gorm:"size:66"`
	Reason          string `json:"reason" gorm:"type:text"`
	CreatedAt       int64  `json:"created_at" gorm:"not null;autoCreateTime:false;index"`
	UpdatedAt       int64  `json:"updated_at" gorm:"not null;autoUpdateTime:false"`
	PaidAt          int64  `json:"paid_at"`
}

func (order *AffiliateWithdrawal) amountsForDisplay() {
	order.Amount = formatAffiliateCashAmount(order.AmountUnits)
	order.Fee = formatAffiliateCashAmount(order.FeeUnits)
	order.NetAmount = formatAffiliateCashAmount(order.NetUnits)
	order.ActualAmount, order.ActualFee, order.RefundedAmount = "0", "0", "0"
	switch order.Status {
	case "completed":
		order.ActualAmount = order.NetAmount
		order.ActualFee = order.Fee
	case "rejected":
		order.RefundedAmount = order.Amount
	case "cancelled", "failed":
		policy := order.CancelFeePolicy
		if order.Status == "failed" {
			policy = order.FailedFeePolicy
		}
		order.RefundedAmount = order.Amount
		if policy == "retain" {
			order.ActualFee, order.RefundedAmount = order.Fee, order.NetAmount
		}
	}
}

// 记录每次状态操作和纠错，完成单不回退；业务号与输入摘要共同防重。
type AffiliateWithdrawalEvent struct {
	ID            int64  `json:"id" gorm:"primaryKey"`
	WithdrawalID  int64  `json:"withdrawal_id" gorm:"not null;uniqueIndex:idx_aff_withdraw_event,priority:1"`
	RequestID     string `json:"-" gorm:"size:64;not null;uniqueIndex:idx_aff_withdraw_event,priority:2"`
	RequestHash   string `json:"-" gorm:"size:64;not null"`
	OperatorID    int    `json:"operator_id" gorm:"not null"`
	Action        string `json:"action" gorm:"size:24;not null"`
	Status        string `json:"status" gorm:"size:16;not null"`
	OrderVersion  int64  `json:"order_version" gorm:"not null;default:0"`
	Reason        string `json:"reason" gorm:"type:text"`
	TransactionID string `json:"transaction_id" gorm:"size:66"`
	ActualAmount  string `json:"actual_amount" gorm:"size:32"`
	Network       string `json:"network" gorm:"size:32"`
	Address       string `json:"address" gorm:"size:128"`
	CreatedAt     int64  `json:"created_at" gorm:"not null;autoCreateTime:false"`
}

type AffiliateWithdrawalProof struct {
	TransactionID string `gorm:"size:64;primaryKey"`
	WithdrawalID  int64  `gorm:"not null;uniqueIndex"`
}

type AffiliateWithdrawalRequest struct {
	Amount        string `json:"amount"`
	Network       string `json:"network"`
	Address       string `json:"address"`
	RequestID     string `json:"request_id"`
	ConfigVersion string `json:"config_version"`
}

type AffiliateWithdrawalPreview struct {
	Amount          string `json:"amount"`
	Fee             string `json:"fee"`
	NetAmount       string `json:"net_amount"`
	Network         string `json:"network"`
	Address         string `json:"address"`
	ConfigVersion   string `json:"config_version"`
	CancelFeePolicy string `json:"cancel_fee_policy"`
	FailedFeePolicy string `json:"failed_fee_policy"`
	CanSubmit       bool   `json:"can_submit"`
	Reason          string `json:"reason"`
}

type AffiliateWithdrawalAction struct {
	Action          string `json:"action"`
	UnpaidConfirmed bool   `json:"unpaid_confirmed"`
	RequestID       string `json:"request_id"`
	ExpectedVersion int64  `json:"expected_version"`
	Reason          string `json:"reason"`
	TransactionID   string `json:"transaction_id"`
	ActualAmount    string `json:"actual_amount"`
	Network         string `json:"network"`
	Address         string `json:"address"`
}

func affiliateCashRequestHash(value any) (string, error) {
	encoded, err := common.Marshal(value)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:]), nil
}

func calculateAffiliateWithdrawal(settings AffiliateCashSettings, req AffiliateWithdrawalRequest) (int64, int64, error) {
	if !settings.WithdrawalEnabled || !affiliateCashNetworkAvailable(settings) {
		return 0, 0, common.NewMessage("U withdrawals are currently unavailable")
	}
	if err := validateAffiliateCashSettings(settings); err != nil {
		return 0, 0, err
	}
	if !slices.ContainsFunc(settings.Networks, func(n AffiliateCashNetwork) bool { return n.ID == req.Network && n.Enabled }) {
		return 0, 0, common.NewMessage("Select an available withdrawal network")
	}
	address := strings.TrimSpace(req.Address)
	if address == "" || utf8.RuneCountInString(address) > 128 {
		return 0, 0, common.NewMessage("Enter a withdrawal address with at most 128 characters")
	}
	amount, err := parseAffiliateCashAmount(req.Amount)
	if err != nil || amount <= 0 {
		return 0, 0, common.NewMessage("Enter a positive withdrawal amount")
	}
	fee, err := calculateAffiliateWithdrawalFee(settings, amount)
	if err != nil {
		return 0, 0, err
	}
	minimum, err := parseAffiliateCashAmount(settings.MinimumWithdrawal)
	if err != nil {
		return 0, 0, err
	}
	basis := amount
	if settings.MinimumBasis == "net" {
		basis -= fee
	}
	if basis < minimum {
		return 0, 0, common.NewMessage("The withdrawal amount is below the configured minimum")
	}
	return amount, fee, nil
}

func PreviewAffiliateWithdrawal(userID int, req AffiliateWithdrawalRequest) (*AffiliateWithdrawalPreview, error) {
	req.Address = strings.TrimSpace(req.Address)
	settings, err := GetAffiliateCashSettings()
	if err != nil {
		return nil, err
	}
	amount, fee, err := calculateAffiliateWithdrawal(settings, req)
	if err != nil {
		return nil, err
	}
	var wallet AffiliateCashWallet
	err = DB.First(&wallet, "user_id = ?", userID).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	result := &AffiliateWithdrawalPreview{Amount: formatAffiliateCashAmount(amount), Fee: formatAffiliateCashAmount(fee), NetAmount: formatAffiliateCashAmount(amount - fee), Network: req.Network, Address: req.Address, ConfigVersion: settings.Version, CancelFeePolicy: settings.CancelFeePolicy, FailedFeePolicy: settings.FailedFeePolicy, CanSubmit: amount <= wallet.Available}
	if !result.CanSubmit {
		result.Reason = "Insufficient U balance"
	}
	return result, nil
}

func CreateAffiliateWithdrawal(userID int, req AffiliateWithdrawalRequest) (*AffiliateWithdrawal, error) {
	if !affiliateCashIdentifierPattern.MatchString(req.RequestID) {
		return nil, common.NewMessage("Provide a valid request ID")
	}
	// 预览、订单快照和幂等摘要统一使用去掉首尾空格后的地址。
	req.Address = strings.TrimSpace(req.Address)
	hash, err := affiliateCashRequestHash(req)
	if err != nil {
		return nil, err
	}
	var order AffiliateWithdrawal
	err = DB.Transaction(func(tx *gorm.DB) error {
		if _, err := lockAffiliateCashUser(tx, userID); err != nil {
			return err
		}
		err := tx.Where("user_id = ? AND request_id = ?", userID, req.RequestID).First(&order).Error
		if err == nil {
			if order.RequestHash != hash {
				return common.NewMessage("This request ID was already used for a different operation")
			}
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		settings, err := readAffiliateCashSettings(lockForUpdate(tx))
		if err != nil {
			return err
		}
		if settings.Version != req.ConfigVersion {
			return common.NewMessage("The configuration changed. Refresh and confirm again")
		}
		amount, fee, err := calculateAffiliateWithdrawal(settings, req)
		if err != nil {
			return err
		}
		wallet, err := lockAffiliateCashWallet(tx, userID)
		if err != nil {
			return err
		}
		if wallet.Available < amount {
			return common.NewMessage("Insufficient U balance")
		}
		snapshot, err := common.Marshal(settings)
		if err != nil {
			return err
		}
		now := common.GetTimestamp()
		order = AffiliateWithdrawal{UserID: userID, RequestID: req.RequestID, RequestHash: hash, AmountUnits: amount, FeeUnits: fee, NetUnits: amount - fee, Network: req.Network, Address: req.Address, Status: "pending", Version: 1, ConfigVersion: settings.Version, ConfigSnapshot: string(snapshot), CancelFeePolicy: settings.CancelFeePolicy, FailedFeePolicy: settings.FailedFeePolicy, CreatedAt: now, UpdatedAt: now}
		if err = tx.Create(&order).Error; err != nil {
			return err
		}
		return changeAffiliateCashWallet(tx, wallet, -amount, amount, "withdrawal_freeze", affiliateWithdrawalBusinessID(order.ID, "freeze"), order.ID)
	})
	if err != nil {
		return nil, err
	}
	order.amountsForDisplay()
	return &order, nil
}

// 资金操作先锁目标用户，再锁订单和钱包；付款结果不明不调用失败结束操作。
func ActOnAffiliateWithdrawal(orderID int64, actorID int, admin bool, req AffiliateWithdrawalAction) (*AffiliateWithdrawal, error) {
	if !affiliateCashIdentifierPattern.MatchString(req.RequestID) || len(req.Reason) > 2000 {
		return nil, common.NewMessage("Provide a valid request ID and reason")
	}
	if !admin && req.Action != "cancel" {
		return nil, common.NewMessage("Unauthorized, insufficient privileges")
	}
	if req.ExpectedVersion <= 0 {
		return nil, common.NewMessage("The withdrawal state changed. Refresh and try again")
	}
	var order AffiliateWithdrawal
	query := DB.Where("id = ?", orderID)
	if !admin {
		query = query.Where("user_id = ?", actorID)
	}
	if err := query.First(&order).Error; err != nil {
		return nil, err
	}
	hash, err := affiliateCashRequestHash(req)
	if err != nil {
		return nil, err
	}
	err = DB.Transaction(func(tx *gorm.DB) error {
		// 管理员仍需处理被禁用用户的旧单；用户自身操作必须保持有效身份。
		// 完成单的纠错只追加审计记录，账户注销后仍允许管理员处理。
		if req.Action != "correct" {
			var user User
			if err := lockForUpdate(tx).First(&user, order.UserID).Error; err != nil {
				return err
			}
			if !admin && (user.Id != actorID || user.Status != common.UserStatusEnabled) {
				return common.NewMessage("Unauthorized, insufficient privileges")
			}
		}
		if err := lockForUpdate(tx).First(&order, orderID).Error; err != nil {
			return err
		}
		var previous AffiliateWithdrawalEvent
		err := tx.Where("withdrawal_id = ? AND request_id = ?", orderID, req.RequestID).First(&previous).Error
		if err == nil {
			if previous.OperatorID != actorID || previous.RequestHash != hash {
				return common.NewMessage("This request ID was already used for a different operation")
			}
			// 旧轮次的 start 回执不能被误当成本轮付款授权。
			if previous.OrderVersion != order.Version {
				return common.NewMessage("The withdrawal state changed. Refresh and try again")
			}
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if req.ExpectedVersion != order.Version || order.Version >= common.MaxWalletQuota {
			return common.NewMessage("The withdrawal state changed. Refresh and try again")
		}
		before := order.Status
		newStatus := before
		availableDelta, frozenDelta := int64(0), int64(0)
		if slices.Contains([]string{"reject", "fail_release", "fail_retry", "correct"}, req.Action) && strings.TrimSpace(req.Reason) == "" {
			return common.NewMessage("A reason or correction record is required")
		}
		switch req.Action {
		case "approve":
			if before != "pending" {
				return common.NewMessage("This action is not allowed in the current withdrawal state")
			}
			newStatus = "approved"
		case "reject", "cancel":
			if (req.Action == "cancel" && before != "pending") || (req.Action == "reject" && before != "pending" && before != "approved") {
				return common.NewMessage("This action is not allowed in the current withdrawal state")
			}
			newStatus = "rejected"
			availableDelta, frozenDelta = order.AmountUnits, -order.AmountUnits
			if req.Action == "cancel" {
				newStatus = "cancelled"
				if order.CancelFeePolicy == "retain" {
					availableDelta -= order.FeeUnits
				}
			}
		case "start":
			if before != "approved" {
				return common.NewMessage("This action is not allowed in the current withdrawal state")
			}
			settings, err := readAffiliateCashSettings(lockForUpdate(tx))
			if err != nil {
				return err
			}
			if !slices.ContainsFunc(settings.Networks, func(n AffiliateCashNetwork) bool { return n.ID == order.Network && n.Enabled }) {
				return common.NewMessage("This withdrawal network is disabled. Reject the unpaid application instead")
			}
			newStatus = "paying"
		case "complete":
			if before != "paying" {
				return common.NewMessage("This action is not allowed in the current withdrawal state")
			}
			actual, err := parseAffiliateCashAmount(req.ActualAmount)
			if err != nil || actual != order.NetUnits || req.Network != order.Network || req.Address != order.Address || !affiliateTransactionPattern.MatchString(req.TransactionID) {
				return common.NewMessage("The payment evidence must match the locked network, address and net amount")
			}
			txID := strings.TrimPrefix(strings.ToLower(req.TransactionID), "0x")
			var used int64
			if err = tx.Model(&AffiliateWithdrawalProof{}).Where("transaction_id = ?", txID).Count(&used).Error; err != nil {
				return err
			}
			if used > 0 {
				return common.NewMessage("This payment transaction was already recorded")
			}
			if err = tx.Create(&AffiliateWithdrawalProof{TransactionID: txID, WithdrawalID: order.ID}).Error; err != nil {
				return err
			}
			newStatus, frozenDelta = "completed", -order.AmountUnits
			order.TransactionID, order.PaidAt = req.TransactionID, common.GetTimestamp()
		case "fail_release", "fail_retry":
			if before != "paying" {
				return common.NewMessage("This action is not allowed in the current withdrawal state")
			}
			if !req.UnpaidConfirmed {
				return common.NewMessage("Confirm that no funds were paid before releasing or retrying")
			}
			if req.Action == "fail_retry" {
				newStatus = "approved"
			} else {
				newStatus, availableDelta, frozenDelta = "failed", order.AmountUnits, -order.AmountUnits
				if order.FailedFeePolicy == "retain" {
					availableDelta -= order.FeeUnits
				}
			}
		case "correct":
			if before != "completed" {
				return common.NewMessage("Only completed withdrawals support a linked correction record")
			}
		default:
			return common.NewMessage("Invalid withdrawal action")
		}
		if frozenDelta != 0 {
			wallet, err := lockAffiliateCashWallet(tx, order.UserID)
			if err != nil {
				return err
			}
			if err = changeAffiliateCashWallet(tx, wallet, availableDelta, frozenDelta, "withdrawal_"+newStatus, affiliateWithdrawalBusinessID(order.ID, "settled"), order.ID); err != nil {
				return err
			}
		}
		updates := map[string]any{"version": order.Version + 1}
		if req.Action != "correct" {
			order.Status, order.UpdatedAt, order.Reason = newStatus, common.GetTimestamp(), req.Reason
			updates["status"], updates["updated_at"], updates["reason"] = newStatus, order.UpdatedAt, order.Reason
			updates["transaction_id"], updates["paid_at"] = order.TransactionID, order.PaidAt
		}
		result := tx.Model(&AffiliateWithdrawal{}).Where("id = ? AND status = ? AND version = ?", order.ID, before, order.Version).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return common.NewMessage("The withdrawal state changed. Refresh and try again")
		}
		order.Version++
		return tx.Create(&AffiliateWithdrawalEvent{WithdrawalID: order.ID, RequestID: req.RequestID, RequestHash: hash, OperatorID: actorID, Action: req.Action, Status: newStatus, OrderVersion: order.Version, Reason: req.Reason, TransactionID: req.TransactionID, ActualAmount: req.ActualAmount, Network: req.Network, Address: req.Address, CreatedAt: common.GetTimestamp()}).Error
	})
	if err != nil {
		return nil, err
	}
	order.amountsForDisplay()
	return &order, nil
}

func ListAffiliateWithdrawals(userID int, status string, page *common.PageInfo) error {
	query := DB.Model(&AffiliateWithdrawal{})
	if userID > 0 {
		query = query.Where("user_id = ?", userID)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return err
	}
	orders := make([]AffiliateWithdrawal, 0)
	if err := query.Order("id DESC").Offset(page.GetStartIdx()).Limit(page.PageSize).Find(&orders).Error; err != nil {
		return err
	}
	for i := range orders {
		orders[i].amountsForDisplay()
	}
	page.SetTotal(int(total))
	page.SetItems(orders)
	return nil
}

type AffiliateWithdrawalDetail struct {
	Withdrawal  AffiliateWithdrawal        `json:"withdrawal"`
	Attempts    []AffiliateWithdrawalEvent `json:"attempts"`
	Corrections []AffiliateWithdrawalEvent `json:"corrections"`
}

func GetAffiliateWithdrawalDetail(id int64) (*AffiliateWithdrawalDetail, error) {
	result := &AffiliateWithdrawalDetail{Attempts: []AffiliateWithdrawalEvent{}, Corrections: []AffiliateWithdrawalEvent{}}
	if err := DB.First(&result.Withdrawal, id).Error; err != nil {
		return nil, err
	}
	result.Withdrawal.amountsForDisplay()
	var events []AffiliateWithdrawalEvent
	if err := DB.Where("withdrawal_id = ?", id).Order("id ASC").Find(&events).Error; err != nil {
		return nil, err
	}
	for _, event := range events {
		if event.Action == "correct" {
			result.Corrections = append(result.Corrections, event)
		} else {
			result.Attempts = append(result.Attempts, event)
		}
	}
	return result, nil
}

type AffiliateCashTotals struct {
	CompletedNetAmount string `json:"completed_net_amount"`
	CompletedFee       string `json:"completed_fee"`
	UAvailableTotal    string `json:"u_available_total"`
	UFrozenTotal       string `json:"u_frozen_total"`
}

func GetAffiliateCashTotals() (*AffiliateCashTotals, error) {
	var wallet struct {
		Available string
		Frozen    string
	}
	if err := DB.Model(&AffiliateCashWallet{}).Select("COALESCE(SUM(available), 0) AS available, COALESCE(SUM(frozen), 0) AS frozen").Scan(&wallet).Error; err != nil {
		return nil, err
	}
	var paid struct {
		Net string
		Fee string
	}
	if err := DB.Model(&AffiliateWithdrawal{}).Where("status = ?", "completed").Select("COALESCE(SUM(net_units), 0) AS net, COALESCE(SUM(fee_units), 0) AS fee").Scan(&paid).Error; err != nil {
		return nil, err
	}
	values := make([]string, 0, 4)
	for _, value := range []string{paid.Net, paid.Fee, wallet.Available, wallet.Frozen} {
		amount, err := decimal.NewFromString(value)
		if err != nil {
			return nil, err
		}
		values = append(values, amount.Div(decimal.NewFromInt(affiliateCashScale)).String())
	}
	return &AffiliateCashTotals{CompletedNetAmount: values[0], CompletedFee: values[1], UAvailableTotal: values[2], UFrozenTotal: values[3]}, nil
}
