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
import {
  Search,
  RefreshCw,
  Receipt,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import {
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCurrencyFromUSD } from '@/lib/currency'
import { formatNumber } from '@/lib/format'

import { useBillingHistory } from '../hooks/use-billing-history'
import {
  getStatusConfig,
  getPaymentMethodName,
  formatTimestamp,
} from '../lib/billing'
import type { TopupRecord } from '../types'

interface BillingHistoryContentProps {
  enabled?: boolean
  paymentMethods?: string[]
  refreshKey?: number
}

export function BillingHistoryContent(props: BillingHistoryContentProps) {
  const { t } = useTranslation()
  const history = useBillingHistory({
    enabled: props.enabled,
    refreshKey: props.refreshKey,
  })
  const [confirmTradeNo, setConfirmTradeNo] = useState<string | null>(null)
  const totalPages = Math.max(1, Math.ceil(history.total / history.pageSize))
  const methodOptions = useMemo(() => {
    const methods = new Set([
      ...(props.paymentMethods ?? []),
      ...history.knownMethods,
    ])
    return [...methods]
      .filter(Boolean)
      .sort((left, right) =>
        getPaymentMethodName(left, t).localeCompare(
          getPaymentMethodName(right, t)
        )
      )
  }, [history.knownMethods, props.paymentMethods, t])
  const methodSelectItems = [
    { value: 'all', label: t('All payment methods') },
    ...methodOptions.map((method) => ({
      value: method,
      label: getPaymentMethodName(method, t),
    })),
  ]
  const pageSizeItems = [
    { value: '10', label: t('10 / page') },
    { value: '20', label: t('20 / page') },
    { value: '50', label: t('50 / page') },
    { value: '100', label: t('100 / page') },
  ]

  const columns: StaticDataTableColumn<TopupRecord>[] = [
    {
      id: 'order',
      header: t('Order number'),
      cell: (record) => (
        <div className='space-y-1'>
          <div className='flex items-center gap-1.5'>
            <code className='max-w-52 truncate' title={record.trade_no}>
              {record.trade_no}
            </code>
            <CopyButton
              value={record.trade_no}
              className='size-7'
              iconClassName='size-3.5'
            />
          </div>
          {history.isAdmin && record.user_id != null && (
            <StatusBadge
              label={`${t('User ID')}: ${record.user_id}`}
              variant='neutral'
              size='sm'
              copyText={String(record.user_id)}
            />
          )}
        </div>
      ),
    },
    {
      id: 'method',
      header: t('Payment Method'),
      cell: (record) => getPaymentMethodName(record.payment_method, t),
    },
    {
      id: 'amount',
      header: t('Topup Amount'),
      className: 'text-right',
      cellClassName: 'text-right',
      cell: (record) =>
        formatCurrencyFromUSD(record.amount, {
          digitsLarge: 2,
          digitsSmall: 2,
          abbreviate: false,
        }),
    },
    {
      id: 'payment',
      header: t('Order amount'),
      className: 'text-right',
      cellClassName: 'text-right',
      cell: (record) => formatNumber(record.money),
    },
    {
      id: 'status',
      header: t('Status'),
      cell: (record) => {
        const config = getStatusConfig(record.status)
        return (
          <StatusBadge
            label={t(config.label)}
            variant={config.variant}
            showDot
            copyable={false}
          />
        )
      },
    },
    {
      id: 'created',
      header: t('Created At'),
      cellClassName: 'text-muted-foreground',
      cell: (record) => formatTimestamp(record.create_time),
    },
  ]
  if (history.isAdmin) {
    columns.push({
      id: 'actions',
      header: t('Actions'),
      className: 'text-right',
      cellClassName: 'text-right',
      cell: (record) =>
        record.status === 'pending' ? (
          <Button
            size='sm'
            variant='outline'
            onClick={() => setConfirmTradeNo(record.trade_no)}
            disabled={history.completing}
          >
            {t('Complete Order')}
          </Button>
        ) : null,
    })
  }

  const handleConfirmComplete = async () => {
    if (!confirmTradeNo) return
    if (await history.handleCompleteOrder(confirmTradeNo)) {
      setConfirmTradeNo(null)
    }
  }

  return (
    <div className='min-w-0 space-y-4'>
      <div className='flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center'>
        <div className='relative min-w-0 flex-1 sm:min-w-52'>
          <Search
            className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2'
            aria-hidden='true'
          />
          <Input
            aria-label={t('Search by order number...')}
            placeholder={t('Search by order number...')}
            value={history.keyword}
            onChange={(event) => history.handleSearch(event.target.value)}
            className='h-9 pl-9'
          />
        </div>
        <Select
          items={methodSelectItems}
          value={history.paymentMethod}
          onValueChange={(value) =>
            value !== null && history.handlePaymentMethodChange(value)
          }
        >
          <SelectTrigger
            className='h-9 w-full sm:w-44'
            aria-label={t('Payment Method')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {methodSelectItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button
          variant='outline'
          size='sm'
          onClick={() => history.refresh()}
          disabled={history.loading}
        >
          <RefreshCw className='size-4' aria-hidden='true' />
          {t('Refresh')}
        </Button>
      </div>

      <div aria-busy={history.loading} aria-label={t('Billing history')}>
        {history.loading && (
          <div
            className='space-y-3 rounded-md border p-4'
            role='status'
            aria-label={t('Loading...')}
          >
            {['first', 'second', 'third'].map((key) => (
              <Skeleton key={key} className='h-12 w-full' />
            ))}
          </div>
        )}
        {!history.loading && history.records.length === 0 && (
          <EmptyState
            icon={Receipt}
            title={t('No billing records found')}
            description={
              history.keyword || history.paymentMethod !== 'all'
                ? t('Try adjusting your search')
                : t('Your transaction history will appear here')
            }
            className='min-h-40 rounded-md border py-8'
          />
        )}
        {!history.loading && history.records.length > 0 && (
          <StaticDataTable
            columns={columns}
            data={history.records}
            getRowKey={(record) => record.id}
            tableClassName='min-w-[800px]'
            tableProps={{ 'aria-label': t('Billing history') }}
            headerRowClassName='bg-muted/40 hover:bg-muted/40'
          />
        )}
      </div>

      <div className='flex flex-wrap items-center justify-between gap-3'>
        <span className='text-muted-foreground text-xs sm:text-sm'>
          {t('Showing')}{' '}
          {history.records.length > 0
            ? (history.page - 1) * history.pageSize + 1
            : 0}
          -{Math.min(history.page * history.pageSize, history.total)} {t('of')}{' '}
          {history.total}
        </span>
        <div className='flex items-center gap-3'>
          <Select
            items={pageSizeItems}
            value={String(history.pageSize)}
            onValueChange={(value) =>
              value !== null && history.handlePageSizeChange(Number(value))
            }
          >
            <SelectTrigger className='h-8 w-28' aria-label={t('Rows per page')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {pageSizeItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <nav className='flex items-center gap-2' aria-label={t('Page')}>
            <Button
              variant='outline'
              size='icon'
              className='size-8'
              aria-label={t('Go to previous page')}
              onClick={() => history.handlePageChange(history.page - 1)}
              disabled={history.loading || history.page <= 1}
            >
              <ChevronLeft className='size-4' />
            </Button>
            <span
              className='text-muted-foreground text-sm tabular-nums'
              aria-live='polite'
            >
              {history.page} / {totalPages}
            </span>
            <Button
              variant='outline'
              size='icon'
              className='size-8'
              aria-label={t('Go to next page')}
              onClick={() => history.handlePageChange(history.page + 1)}
              disabled={history.loading || history.page >= totalPages}
            >
              <ChevronRight className='size-4' />
            </Button>
          </nav>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmTradeNo}
        onOpenChange={(open) => !open && setConfirmTradeNo(null)}
        title={t('Complete Order')}
        desc={t(
          'Are you sure you want to manually complete this order? The user will be credited with the corresponding quota.'
        )}
        handleConfirm={handleConfirmComplete}
        isLoading={history.completing}
        confirmText={t('Confirm')}
      />
    </div>
  )
}
