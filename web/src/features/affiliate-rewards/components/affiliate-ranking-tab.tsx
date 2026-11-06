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
import type { OnChangeFn, SortingState } from '@tanstack/react-table'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { useMediaQuery } from '@/hooks'
import { useTableUrlState } from '@/hooks/use-table-url-state'

import { getAffiliateInviters } from '../api'
import type { AffiliateInviter, AffiliateInviterSortBy } from '../types'
import { useAffiliateInviterColumns } from './affiliate-inviter-columns'
import { AffiliateInviterDrawer } from './affiliate-inviter-drawer'

const route = getRouteApi('/_authenticated/affiliate-rewards/')

const SORTABLE: ReadonlySet<string> = new Set<AffiliateInviterSortBy>([
  'accrued',
  'invitees',
  'claimed',
  'unclaimed',
  'paid',
  'signup',
])

/** Inviters ranked by the rebate their invitees earned them, by default. */
export function AffiliateRankingTab() {
  const { t } = useTranslation()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'accrued', desc: true },
  ])
  const [opened, setOpened] = useState<AffiliateInviter | null>(null)

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
    pagination: { defaultPage: 1, defaultPageSize: isMobile ? 10 : 20 },
    globalFilter: { enabled: true, key: 'filter' },
  })

  const activeSort = sorting[0]
  const sortBy: AffiliateInviterSortBy =
    activeSort && SORTABLE.has(activeSort.id)
      ? (activeSort.id as AffiliateInviterSortBy)
      : 'accrued'
  const sortOrder = activeSort && !activeSort.desc ? 'asc' : 'desc'
  const keyword = globalFilter?.trim() ?? ''

  const query = useQuery({
    queryKey: [
      'affiliate-rewards',
      'inviters',
      pagination.pageIndex,
      pagination.pageSize,
      keyword,
      sortBy,
      sortOrder,
    ],
    queryFn: () =>
      getAffiliateInviters({
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
        keyword,
        sortBy,
        sortOrder,
      }),
    placeholderData: (previous) => previous,
  })

  // A new sort starts again from the first page.
  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    setSorting(updater)
    if (pagination.pageIndex > 0) {
      onPaginationChange({ ...pagination, pageIndex: 0 })
    }
  }

  const columns = useAffiliateInviterColumns(
    pagination.pageIndex * pagination.pageSize + 1,
    setOpened
  )
  const { table } = useDataTable({
    data: query.data?.items ?? [],
    columns,
    getRowId: (row) => String(row.user_id),
    // The toolbar reads the column filter state, so it must be set even
    // though this table has no column filters.
    columnFilters,
    globalFilter,
    pagination,
    sorting,
    onPaginationChange,
    onGlobalFilterChange,
    onColumnFiltersChange,
    onSortingChange: handleSortingChange,
    manualPagination: true,
    manualFiltering: true,
    manualSorting: true,
    totalCount: query.data?.total ?? 0,
    ensurePageInRange,
  })

  return (
    <>
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={query.isLoading}
        isFetching={query.isFetching}
        emptyTitle={t('No inviters yet')}
        emptyDescription={t(
          'Users who invited someone or claimed rebate appear here.'
        )}
        skeletonKeyPrefix='affiliate-ranking-skeleton'
        applyHeaderSize
        toolbarProps={{
          searchPlaceholder: t('Search by user ID, username or display name'),
          searchDebounceMs: 500,
        }}
      />
      <AffiliateInviterDrawer
        inviter={opened}
        onOpenChange={(open) => {
          if (!open) setOpened(null)
        }}
      />
    </>
  )
}
