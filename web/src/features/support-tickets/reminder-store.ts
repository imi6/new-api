/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const TICKET_REMINDER_STORAGE_KEY = 'support-ticket-reminders-v1'

interface TicketReminderState {
  dismissedByAccount: Record<string, number>
  openedDetail: { userId: number; ticketId: number; admin: boolean } | null
  dismiss: (userId: number, messageId: number, admin?: boolean) => void
  openDetail: (userId: number, ticketId: number, admin?: boolean) => void
  closeDetail: (userId: number) => void
}

// 仅持久化账号各自收起到的消息编号，不保存工单内容、截图或已读状态。
export const useTicketReminderStore = create<TicketReminderState>()(
  persist(
    (set) => ({
      dismissedByAccount: {},
      openedDetail: null,
      dismiss: (userId, messageId, admin = true) =>
        set((state) => ({
          dismissedByAccount: {
            ...state.dismissedByAccount,
            [`${userId}:${admin ? 'admin' : 'owner'}`]: Math.max(
              state.dismissedByAccount[
                `${userId}:${admin ? 'admin' : 'owner'}`
              ] ?? 0,
              messageId
            ),
          },
        })),
      openDetail: (userId, ticketId, admin = true) =>
        set({ openedDetail: { userId, ticketId, admin } }),
      closeDetail: (userId) =>
        set((state) =>
          state.openedDetail?.userId === userId ? { openedDetail: null } : state
        ),
    }),
    {
      name: TICKET_REMINDER_STORAGE_KEY,
      partialize: (state) => ({ dismissedByAccount: state.dismissedByAccount }),
      merge: (persisted, current) => {
        const saved = (persisted as Partial<TicketReminderState> | undefined)
          ?.dismissedByAccount
        const dismissedByAccount = { ...current.dismissedByAccount }
        if (saved && typeof saved === 'object') {
          for (const [userId, messageId] of Object.entries(saved)) {
            if (
              /^[1-9]\d*(?::(?:admin|owner))?$/.test(userId) &&
              Number.isSafeInteger(messageId) &&
              messageId >= 0
            ) {
              const identity = userId.includes(':') ? userId : `${userId}:admin`
              dismissedByAccount[identity] = Math.max(
                dismissedByAccount[identity] ?? 0,
                messageId
              )
            }
          }
        }
        return { ...current, dismissedByAccount }
      },
    }
  )
)
