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
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import type {
  SupportTicket,
  TicketDetail,
  TicketFilters,
  TicketMessage,
  TicketPage,
  TicketStatus,
  TicketSubmission,
} from './types'

interface TicketResponse<T> {
  success: boolean
  data: T
  message?: string
}

export const ticketBase = (admin: boolean) =>
  admin ? '/api/support/admin/tickets' : '/api/support/tickets'

export async function getTickets(
  admin: boolean,
  filters: TicketFilters,
  signal?: AbortSignal
): Promise<TicketPage> {
  const response = await api.get<TicketResponse<TicketPage>>(
    ticketBase(admin),
    {
      signal,
      disableDuplicate: true,
      params: {
        p: filters.page,
        page_size: filters.pageSize,
        status: filters.status || undefined,
        category: admin ? filters.category || undefined : undefined,
        user_id: admin ? filters.userId || undefined : undefined,
      },
    }
  )
  return requireServerSuccess(response.data).data
}

export async function getTicket(
  admin: boolean,
  id: number,
  signal?: AbortSignal
): Promise<TicketDetail> {
  const response = await api.get<TicketResponse<TicketDetail>>(
    `${ticketBase(admin)}/${id}`,
    { signal, disableDuplicate: true }
  )
  return requireServerSuccess(response.data).data
}

export async function submitTicket(
  payload: TicketSubmission
): Promise<SupportTicket> {
  const form = new FormData()
  form.append('request_id', payload.requestId)
  form.append('category', payload.category ?? 'other')
  form.append('content', payload.content)
  for (const image of payload.images) form.append('images', image)
  const response = await api.post<TicketResponse<SupportTicket>>(
    ticketBase(false),
    form
  )
  return requireServerSuccess(response.data).data
}

export async function replyToTicket(
  admin: boolean,
  id: number,
  payload: TicketSubmission
): Promise<TicketMessage> {
  const form = new FormData()
  form.append('request_id', payload.requestId)
  form.append('content', payload.content)
  for (const image of payload.images) form.append('images', image)
  const response = await api.post<TicketResponse<TicketMessage>>(
    `${ticketBase(admin)}/${id}/messages`,
    form
  )
  return requireServerSuccess(response.data).data
}

export async function setTicketStatus(
  admin: boolean,
  id: number,
  status: TicketStatus
): Promise<SupportTicket> {
  const response = await api.post<TicketResponse<SupportTicket>>(
    `${ticketBase(admin)}/${id}/${admin ? 'status' : 'close'}`,
    admin ? { status } : {}
  )
  return requireServerSuccess(response.data).data
}

export async function getTicketScreenshot(
  admin: boolean,
  ticketId: number,
  attachmentId: number,
  signal?: AbortSignal
): Promise<Blob> {
  const response = await api.get<Blob>(
    `${ticketBase(admin)}/${ticketId}/attachments/${attachmentId}`,
    {
      signal,
      responseType: 'blob',
      disableDuplicate: true,
      skipBusinessError: true,
    }
  )
  if (!['image/png', 'image/jpeg'].includes(response.data.type)) {
    throw new Error('Failed to load screenshot')
  }
  return response.data
}
