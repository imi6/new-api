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
import type { TFunction } from 'i18next'

import type { TicketCategory, TicketStatus } from './types'

export function ticketCategoryLabel(
  category: TicketCategory,
  t: TFunction
): string {
  switch (category) {
    case 'api_error':
      return t('API error')
    case 'topup':
      return t('Top-up not received')
    case 'refund':
      return t('Refund')
    case 'account':
      return t('Account issue')
    default:
      return t('Other')
  }
}

export function ticketStatusLabel(
  status: TicketStatus,
  t: TFunction,
  admin = false
): string {
  switch (status) {
    case 'open':
      return t('Pending support')
    case 'waiting_user':
      return admin ? t('Waiting for user reply') : t('Awaiting your reply')
    case 'closed':
      return t('Closed')
  }
}
