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

import { requireServerSuccess } from '@/lib/server-error-message'

import {
  getInvoiceableOrders,
  getInvoiceConfig,
  getInvoiceSummary,
  getMyInvoices,
} from '../api'
import type { InvoiceStatus } from '../types'

export const INVOICE_QUERY_KEY = ['invoice'] as const

export function useInvoiceConfig() {
  return useQuery({
    queryKey: [...INVOICE_QUERY_KEY, 'config'],
    queryFn: async () => requireServerSuccess(await getInvoiceConfig()).data,
  })
}

export function useInvoiceSummary() {
  return useQuery({
    queryKey: [...INVOICE_QUERY_KEY, 'summary'],
    queryFn: async () => requireServerSuccess(await getInvoiceSummary()).data,
  })
}

export function useInvoiceableOrders() {
  return useQuery({
    queryKey: [...INVOICE_QUERY_KEY, 'orders'],
    queryFn: async () =>
      requireServerSuccess(await getInvoiceableOrders()).data ?? [],
  })
}

export function useMyInvoices(params: {
  page: number
  pageSize: number
  status?: InvoiceStatus
}) {
  return useQuery({
    queryKey: [
      ...INVOICE_QUERY_KEY,
      'self',
      params.page,
      params.pageSize,
      params.status ?? 'all',
    ],
    queryFn: async () =>
      requireServerSuccess(await getMyInvoices(params)).data,
    placeholderData: (previous) => previous,
  })
}

/** Refetch every invoice query after an application changes. */
export function useRefreshInvoices() {
  const queryClient = useQueryClient()
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: INVOICE_QUERY_KEY }),
    [queryClient]
  )
}
