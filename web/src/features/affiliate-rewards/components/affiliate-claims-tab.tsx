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
import { getRouteApi } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { TableId } from '@/components/table-id'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useMediaQuery } from '@/hooks'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { formatQuota, formatTimestampToDate } from '@/lib/format'

import { getAffiliateClaims } from '../api'
import type { AffiliateClaim } from '../types'

const route = getRouteApi('/_authenticated/affiliate-rewards/')

type ClaimRange = 'all' | '7' | '30' | '90'

const RANGES: Array<{ value: ClaimRange; labelKey: string }> = [
  { value: 'all', labelKey: 'All time' },
  { value: '7', labelKey: 'Last 7 days' },
  { value: '30', labelKey: 'Last 30 days' },
  { value: '90', labelKey: 'Last 90 days' },
]

/** Every rebate claim on the site, newest first. */
export function AffiliateClaimsTab() {
  const { t } = useTranslation()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const [range, setRange] = useState<ClaimRange>('all')

  const {
    globalFilter,
    onGlobalFilterChange,
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: {
      pageKey: 'claimsPage',
      pageSizeKey: 'claimsPageSize',
      defaultPage: 1,
      defaultPageSize: isMobile ? 10 : 20,
    },
    globalFilter: { enabled: true, key: 'claimsFilter' },
  })
  const keyword = globalFilter?.trim() ?? ''
  // The start of the range, fixed for each choice so the query key is stable.
  const startTimestamp = useMemo(
    () =>
      range === 'all'
        ? 0
        : Math.floor(Date.now() / 1000) - Number(range) * 24 * 3600,
    [range]
  )

  const query = useQuery({
    queryKey: [
      'affiliate-rewards',
      'claims',
      pagination.pageIndex,
      pagination.pageSize,
      keyword,
      startTimestamp,
    ],
    queryFn: () =>
      getAffiliateClaims({
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
        keyword,
        startTimestamp,
      }),
    placeholderData: (previous) => previous,
  })

  const columns: ColumnDef<AffiliateClaim>[] = [
    {
      accessorKey: 'id',
      header: t('ID'),
      meta: { mobileHidden: true },
      cell: ({ row }) => <TableId value={row.original.id} />,
      size: 80,
    },
    {
      id: 'user',
      header: t('User'),
      meta: { mobileTitle: true },
      cell: ({ row }) => (
        <span className='flex min-w-0 flex-col'>
          <span className='truncate font-medium'>
            {row.original.username || t('Deleted user')}
          </span>
          <span className='text-muted-foreground text-xs'>
            ID {row.original.user_id}
          </span>
        </span>
      ),
      size: 220,
    },
    {
      accessorKey: 'quota',
      header: t('Rebate deducted'),
      cell: ({ row }) => (
        <span className='font-medium tabular-nums'>
          {formatQuota(row.original.quota)}
        </span>
      ),
      size: 140,
    },
    {
      accessorKey: 'destination',
      header: t('Destination'),
      cell: ({ row }) =>
        row.original.destination === 'u'
          ? t('Withdrawable U')
          : t('Platform balance'),
      size: 140,
    },
    {
      accessorKey: 'created_at',
      header: t('Time'),
      cell: ({ row }) => (
        <span className='text-muted-foreground tabular-nums'>
          {formatTimestampToDate(row.original.created_at)}
        </span>
      ),
      size: 180,
    },
  ]

  const { table } = useDataTable({
    data: query.data?.page.items ?? [],
    columns,
    getRowId: (row) => String(row.id),
    // The toolbar reads the column filter state, so it must be set even
    // though this table has no column filters.
    columnFilters,
    globalFilter,
    pagination,
    onPaginationChange,
    onGlobalFilterChange,
    onColumnFiltersChange,
    manualPagination: true,
    manualFiltering: true,
    totalCount: query.data?.page.total ?? 0,
    ensurePageInRange,
  })

  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      <p className='text-muted-foreground shrink-0 text-sm'>
        {t('{{count}} claims, {{sum}} in total', {
          count: query.data?.page.total ?? 0,
          sum: formatQuota(query.data?.sum ?? 0),
        })}
      </p>
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={query.isLoading}
        isFetching={query.isFetching}
        emptyTitle={t('No claims yet')}
        emptyDescription={t(
          'Referral claims to platform credit or withdrawable U appear here. Amounts show the original rebate deducted.'
        )}
        // The space left under the count line; the table scrolls inside it.
        className='min-h-0 flex-1'
        skeletonKeyPrefix='affiliate-claims-skeleton'
        applyHeaderSize
        toolbarProps={{
          searchPlaceholder: t('Search by user ID, username or display name'),
          searchDebounceMs: 500,
          additionalSearch: (
            <ToggleGroup
              value={[range]}
              onValueChange={(values) => {
                const next = values.find((value) => value !== range)
                if (!next) return
                setRange(next as ClaimRange)
                onPaginationChange({ ...pagination, pageIndex: 0 })
              }}
              aria-label={t('Time range')}
              variant='outline'
              size='sm'
              spacing={2}
            >
              {RANGES.map((item) => (
                <ToggleGroupItem key={item.value} value={item.value}>
                  {t(item.labelKey)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          ),
        }}
      />
    </div>
  )
}
