package model

import (
	"database/sql"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// UserIDReservation 永久保留已分配的账号编号，不保存个人资料，也不随账号删除。
// MySQL 5.7 重启后按最大存量编号恢复自增值，因此不能删除登记行。
type UserIDReservation struct {
	ID int `gorm:"primaryKey;autoIncrement"`
}

// CreateWithReservedID 为已完成资料校验的用户分配永久编号，并原子创建账号。
// 普通注册、OAuth、管理员创建和系统初始化均须经过此入口。
func (user *User) CreateWithReservedID(db *gorm.DB) error {
	if user.Id != 0 {
		return errors.New("new user must not supply an existing identity")
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		reservation := UserIDReservation{}
		if err := tx.Create(&reservation).Error; err != nil {
			return err
		}
		user.Id = reservation.ID
		return tx.Create(user).Error
	})
	if err != nil {
		user.Id = 0
	}
	return err
}

// InitializeUserIDReservations 在开放注册之前保留存量及历史引用的最大编号。
// 旧实例须在升级维护窗口停止写入；重复迁移不能回退编号或修改历史账户。
func InitializeUserIDReservations(db *gorm.DB, logDatabases ...*gorm.DB) error {
	mainSQLDB, err := db.DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		statement := &gorm.Statement{DB: tx}
		if err := statement.Parse(&UserIDReservation{}); err != nil {
			return err
		}
		quotedTable := statement.Quote(statement.Table)
		if tx.Dialector.Name() == "postgres" {
			// PostgreSQL 显式插入旧编号不会推进序列；锁表避免与新账号分配交错。
			if err := tx.Exec("LOCK TABLE " + quotedTable + " IN EXCLUSIVE MODE").Error; err != nil {
				return err
			}
		}
		maximum, err := maximumReferencedUserID(tx, []userIDReference{
			{&UserIDReservation{}, []string{"id"}},
			{&User{}, []string{"id", "inviter_id"}},
			{&Token{}, []string{"user_id"}},
			{&UserSession{}, []string{"user_id"}},
			{&AuthFlow{}, []string{"user_id"}},
			{&ExternalIdentityClaim{}, []string{"user_id"}},
			{&PasskeyCredential{}, []string{"user_id"}},
			{&UserAccessToken{}, []string{"user_id"}},
			{&UserOAuthBinding{}, []string{"user_id"}},
			{&TwoFA{}, []string{"user_id"}},
			{&TwoFABackupCode{}, []string{"user_id"}},
			{&AffiliateAccount{}, []string{"user_id"}},
			{&AffiliateLedgerEntry{}, []string{"user_id", "source_user_id", "actor_id"}},
			{&AffiliateSettlementSource{}, []string{"user_id", "inviter_id"}},
			{&AffiliateRebateClaim{}, []string{"user_id"}},
			{&UserPaidConsumptionDay{}, []string{"user_id"}},
			{&AffiliateCashWallet{}, []string{"user_id"}},
			{&AffiliateCashEntry{}, []string{"user_id"}},
			{&AffiliateCashExchange{}, []string{"user_id"}},
			{&AffiliateWithdrawal{}, []string{"user_id"}},
			{&AffiliateWithdrawalEvent{}, []string{"operator_id"}},
			{&TopUp{}, []string{"user_id"}},
			{&SubscriptionOrder{}, []string{"user_id"}},
			{&UserSubscription{}, []string{"user_id"}},
			{&SubscriptionPreConsumeRecord{}, []string{"user_id"}},
			{&Invoice{}, []string{"user_id"}},
			{&InvoiceTaxPayment{}, []string{"user_id"}},
			{&InvoiceDeletion{}, []string{"user_id", "deleted_by"}},
			{&Task{}, []string{"user_id"}},
			{&Midjourney{}, []string{"user_id"}},
			{&Checkin{}, []string{"user_id"}},
			{&Redemption{}, []string{"user_id", "used_user_id"}},
			{&QuotaData{}, []string{"user_id"}},
			{&PartnerSite{}, []string{"user_id"}},
			{&Announcement{}, []string{"created_by", "updated_by"}},
			{&AnnouncementRead{}, []string{"user_id"}},
			{&Log{}, []string{"user_id"}},
			{&AuditLog{}, []string{"user_id"}},
		})
		if err != nil {
			return err
		}
		// 日志可能位于独立数据库；只读其历史引用，不迁移或写入日志表。
		seen := map[*sql.DB]bool{mainSQLDB: true}
		for _, logDB := range logDatabases {
			if logDB == nil {
				continue
			}
			logSQLDB, err := logDB.DB()
			if err != nil {
				return err
			}
			if seen[logSQLDB] {
				continue
			}
			seen[logSQLDB] = true
			logMaximum, err := maximumReferencedUserID(logDB, []userIDReference{{&Log{}, []string{"user_id"}}, {&AuditLog{}, []string{"user_id"}}})
			if err != nil {
				return err
			}
			maximum = max(maximum, logMaximum)
		}
		if maximum == 0 {
			return nil
		}
		if maximum >= int64(^uint(0)>>1) {
			return errors.New("user identity range is exhausted")
		}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&UserIDReservation{ID: int(maximum)}).Error; err != nil {
			return err
		}
		if tx.Dialector.Name() == "postgres" {
			return tx.Exec("SELECT setval(pg_get_serial_sequence(?, 'id'), GREATEST(?, nextval(pg_get_serial_sequence(?, 'id'))), true)", quotedTable, maximum, quotedTable).Error
		}
		return nil
	})
}

type userIDReference struct {
	model   any
	columns []string
}

// 保留软删除及仅剩历史引用的身份，避免新账号继承历史记录。
func maximumReferencedUserID(db *gorm.DB, sources []userIDReference) (int64, error) {
	// 元数据读取失败必须阻止启动，不能当作没有历史表而继续分配旧编号。
	tables, err := db.Migrator().GetTables()
	if err != nil {
		return 0, err
	}
	existing := make(map[string]bool, len(tables))
	for _, table := range tables {
		existing[table] = true
	}
	var maximum int64
	for _, source := range sources {
		statement := &gorm.Statement{DB: db}
		if err := statement.Parse(source.model); err != nil {
			return 0, err
		}
		if !existing[statement.Table] {
			continue
		}
		for _, column := range source.columns {
			var value sql.NullInt64
			if err := db.Unscoped().Model(source.model).Select("MAX(?)", clause.Column{Name: column}).Scan(&value).Error; err != nil {
				return 0, err
			}
			maximum = max(maximum, value.Int64)
		}
	}
	return maximum, nil
}
