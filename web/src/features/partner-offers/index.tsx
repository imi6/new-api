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
import { getRouteApi } from '@tanstack/react-router'
import type { OnChangeFn, SortingState } from '@tanstack/react-table'
import { RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { ChannelTypeLogo } from '@/features/channels/components/channel-type-badge'
import { PLATFORM_TYPE_OPTIONS } from '@/features/keys/lib/api-key-group-platforms'
import { getPartnerOffers } from '@/features/partner/api'
import {
  PARTNER_STATUSES,
  PARTNER_STATUS_META,
  type PartnerOfferRow,
  type PartnerStatus,
} from '@/features/partner/types'
import { useMediaQuery } from '@/hooks'
import { useTableUrlState } from '@/hooks/use-table-url-state'

import { PartnerMarkDialog } from './components/partner-mark-dialog'
import { usePartnerOfferColumns } from './components/partner-offer-columns'

const route = getRouteApi('/_authenticated/partner-offers/')

/** Every supplier's groups in one table, cheapest ratio first. */
export function PartnerOffers() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'ratio', desc: false },
  ])
  const [marking, setMarking] = useState<PartnerOfferRow | null>(null)

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
    columnFilters: [
      { columnId: 'channel_type', searchKey: 'platform', type: 'array' },
      { columnId: 'admin_status', searchKey: 'status', type: 'array' },
    ],
  })
  const firstValue = (id: string) =>
    (columnFilters.find((filter) => filter.id === id)?.value as
      | string[]
      | undefined)?.[0] ?? ''
  const channelType = Number(firstValue('channel_type')) || 0
  const status = firstValue('admin_status') as PartnerStatus | ''
  const keyword = globalFilter?.trim() ?? ''
  const sortOrder = sorting[0]?.desc ? 'desc' : 'asc'

  const query = useQuery({
    queryKey: [
      'partner',
      'offers',
      pagination.pageIndex,
      pagination.pageSize,
      keyword,
      channelType,
      status,
      sortOrder,
    ],
    queryFn: () =>
      getPartnerOffers({
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
        keyword,
        channelType,
        status,
        sortOrder,
      }),
    placeholderData: (previous) => previous,
  })
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ['partner', 'offers'] })

  // A new sort starts again from the first page.
  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    setSorting(updater)
    if (pagination.pageIndex > 0) {
      onPaginationChange({ ...pagination, pageIndex: 0 })
    }
  }

  const columns = usePartnerOfferColumns(setMarking)
  const { table } = useDataTable({
    data: query.data?.items ?? [],
    columns,
    getRowId: (row) => String(row.offer_id),
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

  const platformOptions = useMemo(
    () =>
      PLATFORM_TYPE_OPTIONS.map((option) => ({
        label: option.label,
        value: String(option.value),
        iconNode: <ChannelTypeLogo type={option.value} size={14} />,
      })),
    []
  )
  const statusOptions = PARTNER_STATUSES.map((value) => ({
    label: PARTNER_STATUS_META[value].labelKey,
    value,
  }))

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('Supplier quotes')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          variant='outline'
          size='sm'
          onClick={refresh}
          disabled={query.isFetching}
        >
          <RefreshCw
            className={query.isFetching ? 'animate-spin' : undefined}
            aria-hidden='true'
          />
          {t('Refresh')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <DataTablePage
          table={table}
          columns={columns}
          isLoading={query.isLoading}
          isFetching={query.isFetching}
          emptyTitle={t('No quotes yet')}
          emptyDescription={t(
            'Groups that suppliers submit on the supplier application page appear here.'
          )}
          skeletonKeyPrefix='partner-offers-skeleton'
          applyHeaderSize
          toolbarProps={{
            searchPlaceholder: t(
              'Search by site, group, model or contact'
            ),
            searchDebounceMs: 500,
            filters: [
              {
                columnId: 'channel_type',
                title: t('Platform'),
                options: platformOptions,
                singleSelect: true,
              },
              {
                columnId: 'admin_status',
                title: t('Mark'),
                options: statusOptions,
                singleSelect: true,
              },
            ],
          }}
        />
        <PartnerMarkDialog
          row={marking}
          onOpenChange={(open) => {
            if (!open) setMarking(null)
          }}
          onChanged={refresh}
        />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
