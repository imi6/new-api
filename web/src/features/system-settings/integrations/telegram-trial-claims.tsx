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
import { Link } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTablePage,
  DataTableToolbar,
  useDataTable,
} from '@/components/data-table'
import { DatePicker } from '@/components/date-picker'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { getTelegramTrialClaims } from '@/features/telegram-bot/api'
import type { TelegramTrialClaim } from '@/features/telegram-bot/types'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import dayjs from '@/lib/dayjs'
import { formatTimestampToDate } from '@/lib/format'
import { useSystemConfigStore } from '@/stores/system-config-store'

const EMPTY_CLAIMS: TelegramTrialClaim[] = []
const EMPTY_FILTERS = { keyword: '', start_time: 0, end_time: 0 }

export function TelegramTrialClaims() {
  const { t, i18n } = useTranslation()
  useSystemConfigStore((state) => state.config.currency)
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [keyword, setKeyword] = useState('')
  const [start, setStart] = useState<Date>()
  const [end, setEnd] = useState<Date>()
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 })
  const invalidRange = Boolean(start && end && start.getTime() > end.getTime())
  const query = useQuery({
    queryKey: ['telegram-bot', 'trial-claims', filters, pagination],
    queryFn: ({ signal }) =>
      getTelegramTrialClaims(
        {
          p: pagination.pageIndex + 1,
          page_size: pagination.pageSize,
          ...filters,
        },
        signal
      ),
  })
  const columns: ColumnDef<TelegramTrialClaim>[] = [
    {
      id: 'user',
      header: t('Current username'),
      meta: { mobileTitle: true },
      size: 190,
      cell: ({ row }) => (
        <div className='flex min-w-0 flex-col gap-1'>
          <span className='max-w-52 truncate font-medium'>
            {row.original.user_deleted
              ? t('Deleted user')
              : row.original.username || '-'}
          </span>
          {row.original.user_deleted ? (
            <span className='text-muted-foreground text-xs'>
              ID {row.original.user_id}
            </span>
          ) : (
            <Link
              to='/users'
              search={{ filter: String(row.original.user_id) }}
              className='text-primary text-xs hover:underline'
            >
              ID {row.original.user_id}
            </Link>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'telegram_id',
      header: t('Telegram ID'),
      size: 160,
    },
    {
      accessorKey: 'email_masked',
      header: t('Current bound email'),
      size: 200,
      cell: ({ row }) => (
        <span className='break-all'>{row.original.email_masked || '-'}</span>
      ),
    },
    {
      accessorKey: 'user_created_at',
      header: t('Registration time'),
      size: 180,
      cell: ({ row }) =>
        row.original.user_created_at > 0
          ? formatTimestampToDate(row.original.user_created_at)
          : t('Historical value not recorded'),
    },
    {
      accessorKey: 'claimed_at',
      header: t('Claimed at'),
      size: 180,
      cell: ({ row }) => formatTimestampToDate(row.original.claimed_at),
    },
    {
      accessorKey: 'quota',
      header: t('Claimed quota'),
      size: 140,
      cell: ({ row }) => (
        <span className='font-medium tabular-nums'>
          {formatQuotaWithCurrency(row.original.quota, {
            abbreviate: false,
            locale,
          })}
        </span>
      ),
    },
  ]
  const { table } = useDataTable({
    data: query.data?.items ?? EMPTY_CLAIMS,
    columns,
    getRowId: (row) => String(row.id),
    totalCount: query.data?.total ?? 0,
    manualPagination: true,
    manualFiltering: true,
    enableSorting: false,
    pagination,
    onPaginationChange: setPagination,
    globalFilter: keyword,
    onGlobalFilterChange: setKeyword,
    columnFilters: [],
    columnVisibilityStorageKey: false,
    columnSizingStorageKey: false,
    ensurePageInRange: (pageCount) => {
      if (
        query.isSuccess &&
        !query.isFetching &&
        pagination.pageIndex >= Math.max(1, pageCount)
      ) {
        setPagination((previous) => ({
          ...previous,
          pageIndex: Math.max(0, pageCount - 1),
        }))
      }
    },
  })

  return (
    <section
      className='space-y-3 border-t pt-6'
      aria-label={t('Trial claim records')}
    >
      <div>
        <h4 className='font-semibold'>{t('Trial claim records')}</h4>
        <p className='text-muted-foreground mt-1 text-xs'>
          {t(
            'Usernames and email addresses reflect current account details. Deleted accounts retain their claim records.'
          )}
        </p>
      </div>
      <DataTableToolbar
        table={table}
        hideViewOptions
        searchPlaceholder={t('Search user ID, username or Telegram ID')}
        hasAdditionalFilters={Boolean(
          start ||
          end ||
          filters.start_time ||
          filters.end_time ||
          filters.keyword
        )}
        onReset={() => {
          setKeyword('')
          setStart(undefined)
          setEnd(undefined)
          setFilters(EMPTY_FILTERS)
          setPagination((previous) => ({ ...previous, pageIndex: 0 }))
        }}
        onSearch={() => {
          if (invalidRange) return
          setFilters({
            keyword: keyword.trim(),
            start_time: start ? dayjs(start).startOf('day').unix() : 0,
            end_time: end ? dayjs(end).endOf('day').unix() : 0,
          })
          setPagination((previous) => ({ ...previous, pageIndex: 0 }))
        }}
        searchLoading={query.isFetching}
        additionalSearch={
          <>
            <div role='group' aria-label={t('Start date')}>
              <DatePicker
                selected={start}
                onSelect={setStart}
                placeholder={t('Start date')}
              />
            </div>
            <div role='group' aria-label={t('End date')}>
              <DatePicker
                selected={end}
                onSelect={setEnd}
                placeholder={t('End date')}
              />
            </div>
          </>
        }
        preActions={
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw
              className={query.isFetching ? 'animate-spin' : undefined}
              aria-hidden='true'
            />
            {t('Refresh')}
          </Button>
        }
      />
      {invalidRange && (
        <p role='alert' className='text-destructive text-sm'>
          {t('End date must be on or after start date.')}
        </p>
      )}
      {query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <DataTablePage
          table={table}
          columns={columns}
          toolbarProps={null}
          fixedHeight={false}
          paginationInFooter={false}
          isLoading={query.isLoading}
          isFetching={query.isFetching}
          emptyTitle={t('No claims yet')}
          applyHeaderSize
        />
      )}
    </section>
  )
}
