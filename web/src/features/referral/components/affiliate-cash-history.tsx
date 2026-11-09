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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AFFILIATE_CASH_QUERY_KEY,
  cancelAffiliateWithdrawal,
  getAffiliateCashLedger,
  getAffiliateWithdrawals,
  isStaleAffiliateWithdrawal,
} from '@/features/affiliate-cash/api'
import { formatUAmount } from '@/features/affiliate-cash/lib/amount'
import {
  affiliateLedgerKindLabel,
  affiliateWithdrawalStatusLabel,
} from '@/features/affiliate-cash/lib/labels'
import type {
  AffiliateCashLedgerEntry,
  AffiliateWithdrawal,
} from '@/features/affiliate-cash/types'
import { formatQuota, formatTimestamp } from '@/lib/format'
import { getServerErrorMessage } from '@/lib/server-error-message'

export function AffiliateCashHistory() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [tab, setTab] = useState('withdrawals')
  const [page, setPage] = useState(1)
  const [cancelOrder, setCancelOrder] = useState<AffiliateWithdrawal | null>(
    null
  )
  const [cancelError, setCancelError] = useState('')
  const [cancelStale, setCancelStale] = useState(false)
  const cancelID = useRef(new Map<string, string>())
  const withdrawals = useQuery({
    queryKey: [...AFFILIATE_CASH_QUERY_KEY, 'withdrawals', page],
    queryFn: ({ signal }) => getAffiliateWithdrawals(page, signal),
    enabled: tab === 'withdrawals',
  })
  const ledger = useQuery({
    queryKey: [...AFFILIATE_CASH_QUERY_KEY, 'ledger', page],
    queryFn: ({ signal }) => getAffiliateCashLedger(page, signal),
    enabled: tab === 'ledger',
  })
  const cancel = useMutation({
    mutationFn: (order: AffiliateWithdrawal) => {
      const orderVersion = `${order.id}:${order.version}`
      let requestID = cancelID.current.get(orderVersion)
      if (!requestID) {
        requestID = crypto.randomUUID()
        cancelID.current.set(orderVersion, requestID)
      }
      return cancelAffiliateWithdrawal(order.id, requestID, order.version)
    },
    meta: { errorToast: false },
    onSuccess: async (_, order) => {
      cancelID.current.delete(`${order.id}:${order.version}`)
      setCancelOrder(null)
      setCancelError('')
      await Promise.allSettled([
        client.invalidateQueries({ queryKey: AFFILIATE_CASH_QUERY_KEY }),
      ])
    },
    onError: async (cause) => {
      setCancelError(getServerErrorMessage(cause))
      if (isStaleAffiliateWithdrawal(cause)) {
        setCancelStale(true)
        await Promise.allSettled([
          client.invalidateQueries({ queryKey: AFFILIATE_CASH_QUERY_KEY }),
        ])
      }
    },
  })

  const withdrawalColumns: StaticDataTableColumn<AffiliateWithdrawal>[] = [
    {
      id: 'time',
      header: t('Time'),
      cell: (row) => (
        <span className='whitespace-nowrap'>
          {formatTimestamp(row.created_at)}
        </span>
      ),
    },
    {
      id: 'amount',
      header: t('Withdrawal amount'),
      cell: (row) => formatUAmount(row.amount),
    },
    {
      id: 'fee',
      header: t('Fee charged'),
      cell: (row) => formatUAmount(row.actual_fee),
    },
    {
      id: 'net',
      header: t('Expected payout'),
      cell: (row) => formatUAmount(row.net_amount),
    },
    {
      id: 'actual',
      header: t('Actual payout'),
      cell: (row) => formatUAmount(row.actual_amount),
    },
    {
      id: 'returned',
      header: t('Amount returned'),
      cell: (row) => formatUAmount(row.refunded_amount),
    },
    {
      id: 'receiving',
      header: t('Receiving details'),
      cell: (row) => (
        <div className='max-w-56 space-y-1 whitespace-normal'>
          <p>{row.network}</p>
          <p className='font-mono text-xs break-all'>{row.address}</p>
        </div>
      ),
    },
    {
      id: 'status',
      header: t('Status'),
      cell: (row) => (
        <div className='max-w-56 space-y-1 whitespace-normal'>
          <Badge variant='secondary'>
            {affiliateWithdrawalStatusLabel(row.status, t)}
          </Badge>
          {row.reason && <p className='text-xs break-words'>{row.reason}</p>}
          {row.transaction_id && (
            <p className='font-mono text-xs break-all'>{row.transaction_id}</p>
          )}
        </div>
      ),
    },
    {
      id: 'actions',
      header: t('Actions'),
      cell: (row) =>
        row.status === 'pending' ? (
          <Button
            size='sm'
            variant='outline'
            onClick={() => {
              setCancelOrder(row)
              setCancelError('')
              setCancelStale(false)
            }}
          >
            {t('Cancel withdrawal')}
          </Button>
        ) : null,
    },
  ]
  const ledgerColumns: StaticDataTableColumn<AffiliateCashLedgerEntry>[] = [
    {
      id: 'time',
      header: t('Time'),
      cell: (row) => formatTimestamp(row.created_at),
    },
    {
      id: 'kind',
      header: t('Type'),
      cell: (row) => affiliateLedgerKindLabel(row.kind, t),
    },
    {
      id: 'quota',
      header: t('Rebate amount'),
      cell: (row) => formatQuota(row.quota),
    },
    {
      id: 'rate',
      header: t('U conversion rate'),
      cell: (row) =>
        row.kind === 'claim_u' ? formatUAmount(row.exchange_rate) : '—',
    },
    {
      id: 'u',
      header: t('U amount'),
      cell: (row) =>
        row.kind === 'claim_u' ? formatUAmount(row.u_amount) : '—',
    },
    {
      id: 'reference',
      header: t('Reference'),
      cell: (row) => (
        <span className='font-mono text-xs break-all'>
          {row.request_id || '—'}
        </span>
      ),
    },
    { id: 'reason', header: t('Note'), cell: (row) => row.reason || '—' },
  ]
  const active = tab === 'withdrawals' ? withdrawals : ledger
  const total = active.data?.total ?? 0
  const pageSize = active.data?.page_size || 10

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Referral account history')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(String(value))
            setPage(1)
          }}
        >
          <TabsList>
            <TabsTrigger value='withdrawals'>{t('U withdrawals')}</TabsTrigger>
            <TabsTrigger value='ledger'>{t('Rebate ledger')}</TabsTrigger>
          </TabsList>
        </Tabs>
        {active.isError && (
          <ErrorState
            className='min-h-32'
            description={getServerErrorMessage(active.error)}
            onRetry={() => {
              void active.refetch()
            }}
          />
        )}
        {!active.isError && active.isLoading && (
          <Skeleton className='h-32 w-full' />
        )}
        {!active.isError && !active.isLoading && tab === 'withdrawals' && (
          <StaticDataTable
            columns={withdrawalColumns}
            data={withdrawals.data?.items ?? []}
            getRowKey={(row) => row.id}
            emptyContent={
              <EmptyState
                className='min-h-32'
                title={t('No withdrawal requests yet')}
              />
            }
          />
        )}
        {!active.isError && !active.isLoading && tab === 'ledger' && (
          <StaticDataTable
            columns={ledgerColumns}
            data={ledger.data?.items ?? []}
            getRowKey={(row) => row.id}
            emptyContent={
              <EmptyState
                className='min-h-32'
                title={t('No rebate records yet')}
              />
            }
          />
        )}
        <div className='flex items-center justify-between gap-3'>
          <p className='text-muted-foreground text-xs'>
            {t('{{count}} records', { count: total })}
          </p>
          <div className='flex gap-2'>
            <Button
              size='sm'
              variant='outline'
              disabled={page <= 1 || active.isFetching}
              onClick={() => setPage((value) => value - 1)}
            >
              {t('Previous')}
            </Button>
            <Button
              size='sm'
              variant='outline'
              disabled={page * pageSize >= total || active.isFetching}
              onClick={() => setPage((value) => value + 1)}
            >
              {t('Next')}
            </Button>
          </div>
        </div>
        <ConfirmDialog
          open={cancelOrder !== null}
          onOpenChange={(open) => {
            if (!open && !cancel.isPending) setCancelOrder(null)
          }}
          title={t('Cancel withdrawal')}
          desc={t(
            'Only a pending withdrawal can be cancelled. Returned funds stay in your U balance and cannot be transferred to platform balance.'
          )}
          confirmText={t('Confirm cancellation')}
          isLoading={cancel.isPending}
          disabled={cancelStale}
          handleConfirm={() => {
            if (cancelOrder && !cancelStale && !cancel.isPending) {
              cancel.mutate(cancelOrder)
            }
          }}
        >
          {cancelOrder && (
            <div className='space-y-2 text-sm'>
              <p>
                {t('Frozen amount')}: {formatUAmount(cancelOrder.amount)}
              </p>
              <p>
                {t('Amount returned')}:{' '}
                {formatUAmount(
                  cancelOrder.cancel_fee_policy === 'retain'
                    ? cancelOrder.net_amount
                    : cancelOrder.amount
                )}
              </p>
              <p>
                {cancelOrder.cancel_fee_policy === 'retain'
                  ? t(
                      'Cancellation returns the requested amount minus the locked fee.'
                    )
                  : t('Cancellation returns the full frozen amount.')}
              </p>
            </div>
          )}
          {cancelError && (
            <p role='alert' className='text-destructive text-sm'>
              {cancelError}
            </p>
          )}
        </ConfirmDialog>
      </CardContent>
    </Card>
  )
}
