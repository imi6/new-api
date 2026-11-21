package model

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

type supportTicketReminderFixture struct {
	db          *gorm.DB
	user        User
	firstAdmin  User
	secondAdmin User
}

func setupSupportTicketReminderTest(t *testing.T, dialect string) supportTicketReminderFixture {
	t.Helper()
	var driver gorm.Dialector
	switch dialect {
	case "sqlite":
		driver = sqlite.Open(filepath.Join(t.TempDir(), "support-reminders.db"))
	case "mysql":
		if os.Getenv("TEST_MYSQL_DSN") == "" {
			t.Skip("TEST_MYSQL_DSN is not configured")
		}
		driver = mysql.Open(os.Getenv("TEST_MYSQL_DSN"))
	case "postgres":
		if os.Getenv("TEST_POSTGRES_DSN") == "" {
			t.Skip("TEST_POSTGRES_DSN is not configured")
		}
		driver = postgres.Open(os.Getenv("TEST_POSTGRES_DSN"))
	}
	prefix := "sr_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:8] + "_"
	db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: prefix}})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	previousDB, previousType := DB, common.MainDatabaseType()
	DB = db
	common.SetMainDatabaseType(common.DatabaseType(dialect))
	initCol()
	t.Cleanup(func() {
		assert.NoError(t, db.Migrator().DropTable(&SupportTicketUserRead{}, &SupportTicketRead{}, &SupportTicketReminderBaseline{}, &SupportTicketAttachment{}, &SupportTicketMessage{}, &SupportTicket{}, &SupportTicketStorageLock{}, &User{}))
		DB = previousDB
		common.SetMainDatabaseType(previousType)
		initCol()
		assert.NoError(t, sqlDB.Close())
	})
	// 先创建既有版本工单表，历史场景再从这份数据升级提醒表。
	require.NoError(t, db.AutoMigrate(&User{}, &SupportTicket{}, &SupportTicketMessage{}, &SupportTicketAttachment{}, &SupportTicketStorageLock{}))
	var version string
	versionQuery := "SELECT version()"
	if dialect == "sqlite" {
		versionQuery = "SELECT sqlite_version()"
	}
	require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
	t.Logf("database version: %s", version)
	users := []User{
		{Username: "reminder-user", Password: "unused-password", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AffCode: "reminder-user"},
		{Username: "reminder-admin-a", Password: "unused-password", Role: common.RoleAdminUser, Status: common.UserStatusEnabled, AffCode: "reminder-admin-a"},
		{Username: "reminder-admin-b", Password: "unused-password", Role: common.RoleAdminUser, Status: common.UserStatusEnabled, AffCode: "reminder-admin-b"},
	}
	require.NoError(t, db.Create(&users).Error)
	return supportTicketReminderFixture{db: db, user: users[0], firstAdmin: users[1], secondAdmin: users[2]}
}

func createSupportTicketReminderTestTicket(t *testing.T, userID int) (*SupportTicket, *SupportTicketMessage) {
	t.Helper()
	ticket, _, err := CreateSupportTicket(userID, "api_error", "调用报错，请帮助处理", nil, uuid.NewString(), strings.Repeat("a", 64))
	require.NoError(t, err)
	var message SupportTicketMessage
	require.NoError(t, DB.Where("ticket_id = ? AND request_kind = ?", ticket.ID, "create").First(&message).Error)
	return ticket, &message
}

func replySupportTicketReminderTestTicket(t *testing.T, ticketID, userID int, admin bool) *SupportTicketMessage {
	t.Helper()
	message, _, err := ReplySupportTicket(ticketID, userID, admin, "补充工单消息", nil, uuid.NewString(), strings.Repeat("b", 64))
	require.NoError(t, err)
	return message
}

func TestSupportTicketRemindersDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			t.Run("历史升级和重启保留离线新消息", func(t *testing.T) {
				fixture := setupSupportTicketReminderTest(t, dialect)
				legacyTicket, legacyMessage := createSupportTicketReminderTestTicket(t, fixture.user.Id)
				tombstone := SupportTicketMessage{RequestKind: "deleted"}
				require.NoError(t, fixture.db.Create(&tombstone).Error)
				require.NoError(t, fixture.db.AutoMigrate(&SupportTicketReminderBaseline{}, &SupportTicketRead{}, &SupportTicketUserRead{}))
				require.NoError(t, InitializeSupportTicketReminders(fixture.db))
				initial, err := GetSupportTicketReminders(fixture.firstAdmin.Id)
				require.NoError(t, err)
				assert.Zero(t, initial.UnreadCount)
				assert.Empty(t, initial.Items)

				offlineReply := replySupportTicketReminderTestTicket(t, legacyTicket.ID, fixture.user.Id, false)
				newTicket, newMessage := createSupportTicketReminderTestTicket(t, fixture.user.Id)
				// 另一管理员首次查询也应看到离线来信，不另设个人起算点。
				otherAdmin, err := GetSupportTicketReminders(fixture.secondAdmin.Id)
				require.NoError(t, err)
				assert.EqualValues(t, 2, otherAdmin.UnreadCount)
				require.NoError(t, MarkSupportTicketRead(newTicket.ID, fixture.firstAdmin.Id, newMessage.ID))
				for range 2 {
					require.NoError(t, fixture.db.AutoMigrate(&SupportTicketReminderBaseline{}, &SupportTicketRead{}, &SupportTicketUserRead{}))
					require.NoError(t, InitializeSupportTicketReminders(fixture.db))
				}
				afterRestart, err := GetSupportTicketReminders(fixture.firstAdmin.Id)
				require.NoError(t, err)
				require.Len(t, afterRestart.Items, 1)
				assert.Equal(t, offlineReply.ID, afterRestart.Items[0].MessageID)
				assert.EqualValues(t, 1, afterRestart.UnreadCount)
				var baseline SupportTicketReminderBaseline
				require.NoError(t, fixture.db.First(&baseline, 1).Error)
				assert.Equal(t, tombstone.ID, baseline.BoundaryMessageID)
				var preserved SupportTicketMessage
				require.NoError(t, fixture.db.First(&preserved, legacyMessage.ID).Error)
				assert.Equal(t, legacyMessage.Content, preserved.Content)
			})

			t.Run("已读独立且旧确认不会清除后到回复", func(t *testing.T) {
				fixture := setupSupportTicketReminderTest(t, dialect)
				require.NoError(t, fixture.db.AutoMigrate(&SupportTicketReminderBaseline{}, &SupportTicketRead{}, &SupportTicketUserRead{}))
				require.NoError(t, InitializeSupportTicketReminders(fixture.db))
				ticket, initialMessage := createSupportTicketReminderTestTicket(t, fixture.user.Id)
				shownReply := replySupportTicketReminderTestTicket(t, ticket.ID, fixture.user.Id, false)
				require.NoError(t, MarkSupportTicketRead(ticket.ID, fixture.firstAdmin.Id, shownReply.ID))
				require.NoError(t, MarkSupportTicketRead(ticket.ID, fixture.firstAdmin.Id, initialMessage.ID))
				first, err := GetSupportTicketReminders(fixture.firstAdmin.Id)
				require.NoError(t, err)
				assert.Zero(t, first.UnreadCount)
				assert.Equal(t, shownReply.ID, first.LatestMessageID)
				second, err := GetSupportTicketReminders(fixture.secondAdmin.Id)
				require.NoError(t, err)
				require.Len(t, second.Items, 1)
				assert.EqualValues(t, 2, second.Items[0].UnreadCount)

				laterReply := replySupportTicketReminderTestTicket(t, ticket.ID, fixture.user.Id, false)
				require.NoError(t, MarkSupportTicketRead(ticket.ID, fixture.firstAdmin.Id, shownReply.ID))
				remaining, err := GetSupportTicketReminders(fixture.firstAdmin.Id)
				require.NoError(t, err)
				require.Len(t, remaining.Items, 1)
				assert.EqualValues(t, 1, remaining.Items[0].UnreadCount)
				assert.Equal(t, laterReply.ID, remaining.Items[0].MessageID)
				otherTicket, foreignMessage := createSupportTicketReminderTestTicket(t, fixture.user.Id)
				assert.Error(t, MarkSupportTicketRead(ticket.ID, fixture.firstAdmin.Id, foreignMessage.ID))
				assert.Error(t, MarkSupportTicketRead(otherTicket.ID, fixture.user.Id, foreignMessage.ID))
				_, err = GetSupportTicketReminders(fixture.user.Id)
				assert.Error(t, err)
			})

			t.Run("回复身份关闭和删除遵循各自语义", func(t *testing.T) {
				fixture := setupSupportTicketReminderTest(t, dialect)
				require.NoError(t, fixture.db.AutoMigrate(&SupportTicketReminderBaseline{}, &SupportTicketRead{}, &SupportTicketUserRead{}))
				require.NoError(t, InitializeSupportTicketReminders(fixture.db))
				ticket, userMessage := createSupportTicketReminderTestTicket(t, fixture.user.Id)
				ownTicket, _ := createSupportTicketReminderTestTicket(t, fixture.firstAdmin.Id)
				lastReply := replySupportTicketReminderTestTicket(t, ticket.ID, fixture.secondAdmin.Id, true)
				_, err := SetSupportTicketStatus(ticket.ID, fixture.secondAdmin.Id, true, SupportTicketClosed)
				require.NoError(t, err)
				summary, err := GetSupportTicketReminders(fixture.firstAdmin.Id)
				require.NoError(t, err)
				require.Len(t, summary.Items, 1)
				assert.Equal(t, ticket.ID, summary.Items[0].TicketID)
				assert.EqualValues(t, 1, summary.Items[0].UnreadCount)
				assert.Equal(t, SupportTicketClosed, summary.Items[0].Status)
				assert.Equal(t, "new_ticket", summary.Items[0].Kind)
				require.NoError(t, MarkSupportTicketRead(ticket.ID, fixture.firstAdmin.Id, userMessage.ID))
				read, err := GetSupportTicketReminders(fixture.firstAdmin.Id)
				require.NoError(t, err)
				assert.Zero(t, read.UnreadCount)
				_, _, err = DeleteSupportTickets([]int{ticket.ID, ownTicket.ID}, fixture.firstAdmin.Id)
				require.NoError(t, err)
				var reads int64
				require.NoError(t, fixture.db.Model(&SupportTicketRead{}).Where("ticket_id = ?", ticket.ID).Count(&reads).Error)
				assert.Zero(t, reads)
				afterDelete, err := GetSupportTicketReminders(fixture.secondAdmin.Id)
				require.NoError(t, err)
				assert.Zero(t, afterDelete.UnreadCount)
				assert.Empty(t, afterDelete.Items)
				assert.ErrorIs(t, MarkSupportTicketRead(ticket.ID, fixture.firstAdmin.Id, userMessage.ID), ErrSupportTicketNotFound)
				var reservedMessage SupportTicketMessage
				require.NoError(t, fixture.db.First(&reservedMessage, lastReply.ID).Error)
				assert.Zero(t, reservedMessage.TicketID)
				assert.Empty(t, reservedMessage.Content)
				assert.Zero(t, reservedMessage.CreatedAt)
				assert.Empty(t, reservedMessage.RequestHash)
				assert.Equal(t, "deleted", reservedMessage.RequestKind)
				_, nextMessage := createSupportTicketReminderTestTicket(t, fixture.user.Id)
				assert.Greater(t, nextMessage.ID, lastReply.ID)
			})

			t.Run("最近五项不截断未读总数且同工单合并", func(t *testing.T) {
				fixture := setupSupportTicketReminderTest(t, dialect)
				require.NoError(t, fixture.db.AutoMigrate(&SupportTicketReminderBaseline{}, &SupportTicketRead{}, &SupportTicketUserRead{}))
				require.NoError(t, InitializeSupportTicketReminders(fixture.db))
				var tickets []*SupportTicket
				for range 7 {
					ticket, _ := createSupportTicketReminderTestTicket(t, fixture.user.Id)
					tickets = append(tickets, ticket)
				}
				latest := replySupportTicketReminderTestTicket(t, tickets[6].ID, fixture.user.Id, false)
				summary, err := GetSupportTicketReminders(fixture.firstAdmin.Id)
				require.NoError(t, err)
				assert.EqualValues(t, 7, summary.UnreadCount)
				require.Len(t, summary.Items, 5)
				assert.Equal(t, latest.ID, summary.LatestMessageID)
				assert.Equal(t, "reply", summary.Items[0].Kind)
				assert.EqualValues(t, 2, summary.Items[0].UnreadCount)
				for i, item := range summary.Items {
					assert.Equal(t, tickets[6-i].ID, item.TicketID, fmt.Sprintf("item %d", i))
				}
			})

			t.Run("本人只接收客服回复且已读与管理员身份独立", func(t *testing.T) {
				fixture := setupSupportTicketReminderTest(t, dialect)
				require.NoError(t, fixture.db.AutoMigrate(&SupportTicketReminderBaseline{}, &SupportTicketRead{}, &SupportTicketUserRead{}))
				require.NoError(t, InitializeSupportTicketReminders(fixture.db))
				ticket, _ := createSupportTicketReminderTestTicket(t, fixture.user.Id)
				ownTicket, _ := createSupportTicketReminderTestTicket(t, fixture.firstAdmin.Id)
				userReply := replySupportTicketReminderTestTicket(t, ticket.ID, fixture.user.Id, false)
				initial, err := GetUserSupportTicketReminders(fixture.user.Id)
				require.NoError(t, err)
				assert.Empty(t, initial.Items)
				shownReply := replySupportTicketReminderTestTicket(t, ticket.ID, fixture.secondAdmin.Id, true)
				adminOwnReply := replySupportTicketReminderTestTicket(t, ownTicket.ID, fixture.secondAdmin.Id, true)
				ownSummary, err := GetUserSupportTicketReminders(fixture.user.Id)
				require.NoError(t, err)
				require.Len(t, ownSummary.Items, 1)
				assert.Equal(t, ticket.ID, ownSummary.Items[0].TicketID)
				assert.Equal(t, shownReply.ID, ownSummary.LatestMessageID)
				assert.Equal(t, "support_reply", ownSummary.Items[0].Kind)
				assert.EqualValues(t, 1, ownSummary.Items[0].UnreadCount)
				assert.ErrorIs(t, MarkUserSupportTicketRead(ticket.ID, fixture.firstAdmin.Id, shownReply.ID), ErrSupportTicketNotFound)
				assert.Error(t, MarkUserSupportTicketRead(ticket.ID, fixture.user.Id, adminOwnReply.ID))
				require.NoError(t, MarkUserSupportTicketRead(ticket.ID, fixture.user.Id, shownReply.ID))
				laterReply := replySupportTicketReminderTestTicket(t, ticket.ID, fixture.secondAdmin.Id, true)
				require.NoError(t, MarkUserSupportTicketRead(ticket.ID, fixture.user.Id, userReply.ID))
				_, err = SetSupportTicketStatus(ticket.ID, fixture.secondAdmin.Id, true, SupportTicketClosed)
				require.NoError(t, err)
				remaining, err := GetUserSupportTicketReminders(fixture.user.Id)
				require.NoError(t, err)
				require.Len(t, remaining.Items, 1)
				assert.Equal(t, laterReply.ID, remaining.Items[0].MessageID)
				assert.EqualValues(t, 1, remaining.Items[0].UnreadCount)
				assert.Equal(t, SupportTicketClosed, remaining.Items[0].Status)

				// 管理员作为本人阅读客服回复，不得清除其管理其他用户工单的未读进度。
				require.NoError(t, MarkUserSupportTicketRead(ownTicket.ID, fixture.firstAdmin.Id, adminOwnReply.ID))
				adminInbox, err := GetSupportTicketReminders(fixture.firstAdmin.Id)
				require.NoError(t, err)
				require.Len(t, adminInbox.Items, 1)
				assert.Equal(t, ticket.ID, adminInbox.Items[0].TicketID)
				assert.EqualValues(t, 2, adminInbox.Items[0].UnreadCount)
				require.NoError(t, MarkSupportTicketRead(ticket.ID, fixture.firstAdmin.Id, userReply.ID))
				stillPersonal, err := GetUserSupportTicketReminders(fixture.user.Id)
				require.NoError(t, err)
				assert.EqualValues(t, 1, stillPersonal.UnreadCount)

				_, _, err = DeleteSupportTickets([]int{ticket.ID, ownTicket.ID}, fixture.secondAdmin.Id)
				require.NoError(t, err)
				var readCount int64
				require.NoError(t, fixture.db.Model(&SupportTicketUserRead{}).Count(&readCount).Error)
				assert.Zero(t, readCount)
				deleted, err := GetUserSupportTicketReminders(fixture.user.Id)
				require.NoError(t, err)
				assert.Zero(t, deleted.UnreadCount)
				assert.Empty(t, deleted.Items)
			})
		})
	}
}
