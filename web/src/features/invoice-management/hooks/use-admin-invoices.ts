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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import type { InvoiceStatus } from '@/features/invoice/types'
import { requireServerSuccess } from '@/lib/server-error-message'

import { getAdminInvoice, getAdminInvoices } from '../api'

export const ADMIN_INVOICE_QUERY_KEY = ['admin-invoices'] as const

export function useAdminInvoices(params: {
  page: number
  pageSize: number
  status?: InvoiceStatus
  keyword?: string
}) {
  return useQuery({
    queryKey: [
      ...ADMIN_INVOICE_QUERY_KEY,
      'list',
      params.page,
      params.pageSize,
      params.status ?? 'all',
      params.keyword ?? '',
    ],
    queryFn: async () =>
      requireServerSuccess(await getAdminInvoices(params)).data,
    placeholderData: (previous) => previous,
  })
}

export function useAdminInvoice(id: number | null) {
  return useQuery({
    queryKey: [...ADMIN_INVOICE_QUERY_KEY, 'detail', id],
    queryFn: async () =>
      requireServerSuccess(await getAdminInvoice(id ?? 0)).data,
    enabled: id !== null,
  })
}

/** Refetch the list and any open detail after an application changes. */
export function useRefreshAdminInvoices() {
  const queryClient = useQueryClient()
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: ADMIN_INVOICE_QUERY_KEY }),
    [queryClient]
  )
}
