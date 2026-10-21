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
import i18next from 'i18next'
import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'

import { useIsAdmin } from '@/hooks/use-admin'
import { useDebounce } from '@/hooks/use-debounce'
import { handleServerError } from '@/lib/handle-server-error'

import {
  getUserBillingHistory,
  getAllBillingHistory,
  completeOrder,
  isApiSuccess,
} from '../api'
import type { TopupRecord } from '../types'

// ============================================================================
// Billing History Hook
// ============================================================================

interface UseBillingHistoryOptions {
  /** Initial page number */
  initialPage?: number
  /** Initial page size */
  initialPageSize?: number
  /** Fetch only while the history dialog is open */
  enabled?: boolean
}

export function useBillingHistory(options: UseBillingHistoryOptions = {}) {
  const { initialPage = 1, initialPageSize = 10, enabled = true } = options
  const isAdmin = useIsAdmin()

  const [records, setRecords] = useState<TopupRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(initialPage)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [keyword, setKeyword] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('all')
  const [knownMethods, setKnownMethods] = useState<string[]>([])
  const debouncedKeyword = useDebounce(keyword)
  const requestIdRef = useRef(0)
  const scannedRecordsRef = useRef<{ key: string; items: TopupRecord[] } | null>(
    null
  )
  const [loading, setLoading] = useState(false)
  const [completing, setCompleting] = useState(false)

  const rememberMethods = useCallback((items: TopupRecord[]) => {
    setKnownMethods((current) => {
      const next = new Set(current)
      let changed = false
      for (const item of items) {
        if (!item.payment_method || next.has(item.payment_method)) continue
        next.add(item.payment_method)
        changed = true
      }
      return changed ? [...next] : current
    })
  }, [])

  const fetchPage = useCallback(
    async (pageNum: number, size: number, search: string) => {
      const response = isAdmin
        ? await getAllBillingHistory(pageNum, size, search)
        : await getUserBillingHistory(pageNum, size, search)
      if (!isApiSuccess(response) || !response.data) {
        throw response
      }
      return {
        items: response.data.items || [],
        total: response.data.total || 0,
      }
    },
    [isAdmin]
  )

  /**
   * Fetch billing history. Payment-method filtering stays in the browser:
   * the existing list API has no method parameter, so a selected method
   * loads the keyword's pages and filters them here.
   */
  const fetchBillingHistory = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    try {
      if (paymentMethod === 'all') {
        const pageResult = await fetchPage(page, pageSize, debouncedKeyword)
        if (requestId !== requestIdRef.current) return
        rememberMethods(pageResult.items)
        setRecords(pageResult.items)
        setTotal(pageResult.total)
        return
      }

      const scanKey = `${isAdmin}:${debouncedKeyword}`
      let scanned = scannedRecordsRef.current
      if (scanned?.key !== scanKey) {
        const collected: TopupRecord[] = []
        let reportedTotal = 0
        for (let pageNum = 1; pageNum <= 100; pageNum++) {
          const pageResult = await fetchPage(pageNum, 100, debouncedKeyword)
          if (requestId !== requestIdRef.current) return
          collected.push(...pageResult.items)
          reportedTotal = pageResult.total
          if (
            pageResult.items.length === 0 ||
            collected.length >= reportedTotal
          ) {
            break
          }
        }
        scanned = { key: scanKey, items: collected }
        scannedRecordsRef.current = scanned
      }

      if (requestId !== requestIdRef.current || !scanned) return
      rememberMethods(scanned.items)
      const filtered = scanned.items.filter(
        (item) => item.payment_method === paymentMethod
      )
      const start = (page - 1) * pageSize
      setRecords(filtered.slice(start, start + pageSize))
      setTotal(filtered.length)
    } catch (error) {
      if (requestId !== requestIdRef.current) return
      handleServerError(error, i18next.t('Failed to load billing history'))
      setRecords([])
      setTotal(0)
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [
    debouncedKeyword,
    fetchPage,
    isAdmin,
    page,
    pageSize,
    paymentMethod,
    rememberMethods,
  ])

  /**
   * Complete a pending order (admin only)
   */
  const handleCompleteOrder = useCallback(
    async (tradeNo: string) => {
      if (!isAdmin) {
        toast.error(i18next.t('Admin access required'))
        return false
      }

      setCompleting(true)
      try {
        const response = await completeOrder({ trade_no: tradeNo })
        if (isApiSuccess(response)) {
          toast.success(i18next.t('Order completed successfully'))
          scannedRecordsRef.current = null
          await fetchBillingHistory()
          return true
        } else {
          handleServerError(response, i18next.t('Failed to complete order'))
          return false
        }
      } catch (error) {
        handleServerError(error, i18next.t('Failed to complete order'))
        return false
      } finally {
        setCompleting(false)
      }
    },
    [isAdmin, fetchBillingHistory]
  )

  /**
   * Change page
   */
  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage)
  }, [])

  /**
   * Change page size
   */
  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize)
    setPage(1) // Reset to first page when changing page size
  }, [])

  /**
   * Search by keyword
   */
  const handleSearch = useCallback((newKeyword: string) => {
    requestIdRef.current += 1
    setKeyword(newKeyword)
    setPage(1)
  }, [])

  const handlePaymentMethodChange = useCallback((method: string) => {
    requestIdRef.current += 1
    setPaymentMethod(method)
    setPage(1)
  }, [])

  // Fetch data after the search draft has settled.
  useEffect(() => {
    if (!enabled) return
    if (keyword !== debouncedKeyword) return

    fetchBillingHistory()
  }, [debouncedKeyword, enabled, fetchBillingHistory, keyword])

  return {
    records,
    total,
    page,
    pageSize,
    keyword,
    paymentMethod,
    knownMethods,
    loading,
    completing,
    isAdmin,
    handlePageChange,
    handlePageSizeChange,
    handleSearch,
    handlePaymentMethodChange,
    handleCompleteOrder,
    refresh: fetchBillingHistory,
  }
}
