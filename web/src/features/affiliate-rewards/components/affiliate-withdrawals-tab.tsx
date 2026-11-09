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
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { TableId } from '@/components/table-id'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatUAmount } from '@/features/affiliate-cash/lib/amount'
import type { AffiliateWithdrawal } from '@/features/affiliate-cash/types'
import { formatTimestampToDate } from '@/lib/format'

import { getAffiliateCashTotals, getAffiliateWithdrawals } from '../cash-api'
import { WithdrawalDetailDialog } from './withdrawal-detail-dialog'
import { WithdrawalStatus } from './withdrawal-status'

export function AffiliateWithdrawalsTab() {
  const { t } = useTranslation()
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [status, setStatus] = useState('all')
  const [selected, setSelected] = useState<number | null>(null)
  const totals = useQuery({
    queryKey: ['affiliate-rewards', 'cash-totals'],
    queryFn: getAffiliateCashTotals,
  })
  const query = useQuery({
    queryKey: ['affiliate-rewards', 'withdrawals', pagination, status],
    queryFn: () =>
      getAffiliateWithdrawals({
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
        status: status === 'all' ? '' : status,
      }),
    placeholderData: (previous) => previous,
  })
  const columns: ColumnDef<AffiliateWithdrawal>[] = [
    {
      accessorKey: 'id',
      header: t('ID'),
      size: 90,
      cell: ({ row }) => <TableId value={row.original.id} />,
    },
    {
      accessorKey: 'user_id',
      header: t('User ID'),
      size: 100,
      meta: { mobileTitle: true },
    },
    {
      accessorKey: 'amount',
      header: t('Requested amount'),
      size: 150,
      cell: ({ row }) => formatUAmount(row.original.amount),
    },
    {
      accessorKey: 'fee',
      header: t('Quoted fee'),
      size: 120,
      cell: ({ row }) => formatUAmount(row.original.fee),
    },
    {
      accessorKey: 'net_amount',
      header: t('Expected payout'),
      size: 150,
      cell: ({ row }) => (
        <span className='font-medium'>
          {formatUAmount(row.original.net_amount)}
        </span>
      ),
    },
    {
      accessorKey: 'actual_fee',
      header: t('Fee charged'),
      size: 120,
      cell: ({ row }) => formatUAmount(row.original.actual_fee),
    },
    {
      accessorKey: 'actual_amount',
      header: t('Actual payout'),
      size: 150,
      cell: ({ row }) => formatUAmount(row.original.actual_amount),
    },
    {
      accessorKey: 'refunded_amount',
      header: t('Amount returned'),
      size: 150,
      cell: ({ row }) => formatUAmount(row.original.refunded_amount),
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      size: 150,
      cell: ({ row }) => <WithdrawalStatus status={row.original.status} />,
    },
    { accessorKey: 'network', header: t('Network'), size: 120 },
    {
      accessorKey: 'created_at',
      header: t('Time'),
      size: 175,
      cell: ({ row }) => formatTimestampToDate(row.original.created_at),
    },
    {
      id: 'actions',
      header: t('Actions'),
      size: 100,
      cell: ({ row }) => (
        <Button
          variant='outline'
          size='sm'
          onClick={() => setSelected(row.original.id)}
        >
          {t('Details')}
        </Button>
      ),
    },
  ]
  const { table } = useDataTable({
    data: query.data?.items ?? [],
    columns,
    getRowId: (row) => String(row.id),
    manualPagination: true,
    manualFiltering: true,
    enableSorting: false,
    pagination,
    onPaginationChange: setPagination,
    totalCount: query.data?.total ?? 0,
  })
  const statuses = [
    { value: 'all', label: t('All statuses') },
    { value: 'pending', label: t('Pending review') },
    { value: 'approved', label: t('Awaiting payment') },
    { value: 'paying', label: t('Payment in progress') },
    { value: 'completed', label: t('Completed') },
    { value: 'rejected', label: t('Rejected') },
    { value: 'cancelled', label: t('Cancelled') },
    { value: 'failed', label: t('Payment failed') },
  ]
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      {totals.data && (
        <dl className='grid shrink-0 grid-cols-2 gap-3 text-sm xl:grid-cols-4'>
          {[
            {
              label: t('Total actual payouts'),
              amount: totals.data.completed_net_amount,
            },
            {
              label: t('Completed withdrawal fees'),
              amount: totals.data.completed_fee,
            },
            {
              label: t('Total available U'),
              amount: totals.data.u_available_total,
            },
            { label: t('Total frozen U'), amount: totals.data.u_frozen_total },
          ].map((item) => (
            <div key={item.label} className='rounded-lg border p-3'>
              <dt className='text-muted-foreground text-xs'>{item.label}</dt>
              <dd className='mt-1 font-semibold tabular-nums'>
                {formatUAmount(item.amount)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={query.isLoading}
        isFetching={query.isFetching}
        emptyTitle={t('No withdrawal applications')}
        emptyDescription={t(
          'User withdrawal requests appear here for review and manual payment.'
        )}
        className='min-h-0 flex-1'
        skeletonKeyPrefix='affiliate-withdrawals'
        applyHeaderSize
        toolbar={
          <div className='flex flex-wrap items-center gap-2'>
            <Select
              items={statuses}
              value={status}
              onValueChange={(value) => {
                setStatus(value ?? 'all')
                setPagination((previous) => ({ ...previous, pageIndex: 0 }))
              }}
            >
              <SelectTrigger aria-label={t('Withdrawal status')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant='outline'
              size='sm'
              disabled={query.isFetching || totals.isFetching}
              onClick={() => {
                void query.refetch()
                void totals.refetch()
              }}
            >
              {t('Refresh')}
            </Button>
          </div>
        }
      />
      {selected !== null && (
        <WithdrawalDetailDialog
          key={selected}
          id={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
