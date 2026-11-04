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

import type {
  ApiResponse,
  CreateInvoiceRequest,
  CreateInvoiceResponse,
  InvoiceConfig,
  InvoiceDetail,
  InvoiceOrder,
  InvoicePage,
  InvoicePaymentLaunch,
  InvoiceStatus,
  InvoiceSummary,
} from './types'

export async function getInvoiceConfig(): Promise<ApiResponse<InvoiceConfig>> {
  const res = await api.get('/api/invoice/config')
  return res.data
}

export async function getInvoiceSummary(): Promise<
  ApiResponse<InvoiceSummary>
> {
  const res = await api.get('/api/invoice/summary')
  return res.data
}

export async function getInvoiceableOrders(): Promise<
  ApiResponse<InvoiceOrder[]>
> {
  const res = await api.get('/api/invoice/orders')
  return res.data
}

export async function getMyInvoices(params: {
  page: number
  pageSize: number
  status?: InvoiceStatus
}): Promise<ApiResponse<InvoicePage>> {
  const res = await api.get('/api/invoice/self', {
    params: {
      p: params.page,
      page_size: params.pageSize,
      status: params.status ?? '',
    },
  })
  return res.data
}

export async function getMyInvoice(
  id: number
): Promise<ApiResponse<InvoiceDetail>> {
  const res = await api.get(`/api/invoice/self/${id}`)
  return res.data
}

export async function createInvoice(
  request: CreateInvoiceRequest
): Promise<ApiResponse<CreateInvoiceResponse>> {
  const res = await api.post('/api/invoice', request)
  return res.data
}

export async function payInvoice(
  id: number,
  request: { payment_method: string; gateway: string }
): Promise<ApiResponse<InvoicePaymentLaunch>> {
  const res = await api.post(`/api/invoice/${id}/pay`, request)
  return res.data
}

export async function cancelInvoice(id: number): Promise<ApiResponse> {
  const res = await api.post(`/api/invoice/${id}/cancel`)
  return res.data
}

/**
 * Download an issued invoice file. The route needs the dashboard session, so
 * the file is fetched through the shared client and saved from a blob URL.
 * A failure comes back as JSON, which is read and thrown as a server error.
 */
export async function downloadInvoiceFile(
  id: number,
  fallbackName: string
): Promise<void> {
  const res = await api.get<Blob>(`/api/invoice/${id}/file`, {
    responseType: 'blob',
    disableDuplicate: true,
    skipBusinessError: true,
  })
  const blob = res.data
  if (blob.type.includes('application/json')) {
    const body = JSON.parse(await blob.text()) as ApiResponse
    throw Object.assign(new Error(body.message ?? ''), { cause: body })
  }
  const name =
    parseDispositionFilename(res.headers['content-disposition']) ||
    fallbackName
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/** Reads the file name Go's mime.FormatMediaType writes, plain or RFC 5987. */
function parseDispositionFilename(header: unknown): string {
  if (typeof header !== 'string') return ''
  const extended = /filename\*=(?:UTF-8|utf-8)''([^;]+)/.exec(header)
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim())
    } catch {
      return ''
    }
  }
  const plain = /filename="?([^";]+)"?/.exec(header)
  return plain ? plain[1].trim() : ''
}
