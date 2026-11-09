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
import type {
  ApiResponse,
  Invoice,
  InvoiceDetail,
  InvoicePage,
  InvoiceStatus,
} from '@/features/invoice/types'
import { api } from '@/lib/api'

export interface AdminInvoiceDetail extends InvoiceDetail {
  username: string
}

export interface InvoiceFileInfo {
  file_name: string
  file_size: number
  file_mime: string
}

export interface DeleteInvoiceResult {
  file_cleanup_pending: boolean
}

export async function getAdminInvoices(params: {
  page: number
  pageSize: number
  status?: InvoiceStatus
  keyword?: string
}): Promise<ApiResponse<InvoicePage>> {
  const res = await api.get('/api/invoice/admin', {
    params: {
      p: params.page,
      page_size: params.pageSize,
      status: params.status ?? '',
      keyword: params.keyword ?? '',
    },
  })
  return res.data
}

export async function getAdminInvoice(
  id: number
): Promise<ApiResponse<AdminInvoiceDetail>> {
  const res = await api.get(`/api/invoice/admin/${id}`)
  return res.data
}

export async function uploadAdminInvoiceFile(
  id: number,
  file: File
): Promise<ApiResponse<InvoiceFileInfo>> {
  const body = new FormData()
  body.append('file', file)
  const res = await api.post(`/api/invoice/admin/${id}/file`, body)
  return res.data
}

export async function issueAdminInvoice(
  id: number
): Promise<ApiResponse<Invoice>> {
  const res = await api.post(`/api/invoice/admin/${id}/issue`)
  return res.data
}

export async function rejectAdminInvoice(
  id: number,
  reason: string
): Promise<ApiResponse<{ invoice: Invoice; refund_quota: number }>> {
  const res = await api.post(`/api/invoice/admin/${id}/reject`, { reason })
  return res.data
}

export async function deleteAdminInvoice(
  id: number,
  reason: string
): Promise<ApiResponse<DeleteInvoiceResult>> {
  const res = await api.post(`/api/invoice/admin/${id}/delete`, { reason })
  return res.data
}
