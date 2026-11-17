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
export const TICKET_CATEGORIES = [
  'api_error',
  'topup',
  'refund',
  'account',
  'other',
] as const
export type TicketCategory = (typeof TICKET_CATEGORIES)[number]
export type TicketStatus = 'open' | 'waiting_user' | 'closed'

export interface SupportTicket {
  id: number
  user_id: number
  category: TicketCategory
  status: TicketStatus
  created_at: number
  updated_at: number
  last_reply_at: number
  message_count: number
}

export interface TicketAttachment {
  id: number
  mime: string
  size: number
  width: number
  height: number
}

export interface TicketMessage {
  id: number
  ticket_id: number
  author_id: number
  is_admin: boolean
  content: string
  created_at: number
  attachments: TicketAttachment[]
}

export interface TicketDetail {
  ticket: SupportTicket
  messages: TicketMessage[]
}

export interface TicketPage {
  items: SupportTicket[]
  page: number
  page_size: number
  total: number
}

export interface TicketFilters {
  page: number
  pageSize: number
  status: TicketStatus | ''
  category: TicketCategory | ''
  userId: string
}

export interface TicketSubmission {
  requestId: string
  content: string
  category?: TicketCategory
  images: File[]
}
