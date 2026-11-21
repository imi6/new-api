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
import { focusManager, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { getServerErrorStatus } from '@/lib/server-error-message'

import { getTicketReminders } from './api'
import {
  TICKET_REMINDER_STORAGE_KEY,
  useTicketReminderStore,
} from './reminder-store'

export const ticketReminderKey = (userId: number, admin = true) =>
  ['support-tickets', userId, admin, 'reminders'] as const

export function ticketRemindersDenied(error: unknown): boolean {
  return [401, 403].includes(getServerErrorStatus(error) ?? 0)
}

export function useTicketReminders(
  userId: number,
  admin = true,
  enabled = true
) {
  const client = useQueryClient()
  const failures = useRef(0)
  const query = useQuery({
    queryKey: ticketReminderKey(userId, admin),
    queryFn: async ({ signal }) => {
      try {
        const reminders = await getTicketReminders(signal, admin)
        failures.current = 0
        return reminders
      } catch (error) {
        failures.current += 1
        throw error
      }
    },
    staleTime: 0,
    gcTime: 0,
    enabled: (current) =>
      enabled && !ticketRemindersDenied(current.state.error),
    refetchInterval: (current) => {
      if (
        !enabled ||
        !focusManager.isFocused() ||
        ticketRemindersDenied(current.state.error)
      ) {
        return false
      }
      return Math.min(120_000, 15_000 * 2 ** Math.min(failures.current, 3))
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: (current) =>
      ticketRemindersDenied(current.state.error) ? false : 'always',
    retry: false,
    meta: { errorToast: false, errorRedirect: false },
  })

  useEffect(() => {
    const syncDismissed = (event: StorageEvent) => {
      if (event.key !== TICKET_REMINDER_STORAGE_KEY) return
      void useTicketReminderStore.persist.rehydrate()
    }
    window.addEventListener('storage', syncDismissed)
    return () => {
      window.removeEventListener('storage', syncDismissed)
      void client.cancelQueries({ queryKey: ticketReminderKey(userId, admin) })
      client.removeQueries({ queryKey: ticketReminderKey(userId, admin) })
    }
  }, [client, userId, admin])

  return query
}
