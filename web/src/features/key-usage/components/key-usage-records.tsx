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
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table'
import { Download } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePagination, DataTableView } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { LoadingState } from '@/components/loading-state'
import { StatusBadge } from '@/components/status-badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import { LOG_TYPE_ENUM } from '@/features/usage-logs/constants'
import { downloadCsv, toCsvLine } from '@/features/usage-logs/lib/export'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber, formatTimestampToDate } from '@/lib/format'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { useSystemConfigStore } from '@/stores/system-config-store'

import type { KeyUsageEntry, KeyUsageFilters, KeyUsageResult } from '../api'

interface KeyUsageRecordsProps {
  data: KeyUsageResult
  filters: KeyUsageFilters
  busy: boolean
  onQuery: (filters: KeyUsageFilters, page: number) => void
  onExport: (signal: AbortSignal) => Promise<KeyUsageEntry[]>
}

const quotaFormat = { abbreviate: false, digitsLarge: 4, digitsSmall: 6 }

export function KeyUsageRecords(props: KeyUsageRecordsProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  useSystemConfigStore((state) => state.config?.currency)
  const [draft, setDraft] = useState<{
    applied: KeyUsageFilters
    range: { start?: Date; end?: Date }
    model: string
    error: string
  }>()
  const fields =
    draft?.applied === props.filters
      ? draft
      : {
          applied: props.filters,
          range: {
            start: new Date(props.data.start_timestamp * 1000),
            end: new Date(props.data.end_timestamp * 1000),
          },
          model: props.filters.model_name ?? '',
          error: '',
        }
  const [exportError, setExportError] = useState<unknown>(null)
  const [exporting, setExporting] = useState(false)
  const exportController = useRef<AbortController | null>(null)

  useEffect(() => () => exportController.current?.abort(), [])

  const columns = useMemo<ColumnDef<KeyUsageEntry>[]>(
    () => [
      {
        header: t('Time'),
        accessorKey: 'created_at',
        cell: ({ row }) => formatTimestampToDate(row.original.created_at),
      },
      { header: t('Model'), accessorKey: 'model_name' },
      {
        header: t('Input Tokens'),
        accessorKey: 'prompt_tokens',
        cell: ({ row }) => formatNumber(row.original.prompt_tokens, locale),
      },
      {
        header: t('Output Tokens'),
        accessorKey: 'completion_tokens',
        cell: ({ row }) => formatNumber(row.original.completion_tokens, locale),
      },
      {
        header: t('Type'),
        accessorKey: 'type',
        cell: ({ row }) => {
          const refund = row.original.type === LOG_TYPE_ENUM.REFUND
          return (
            <StatusBadge
              label={refund ? t('Refund') : t('Consume')}
              variant={refund ? 'info' : 'neutral'}
            />
          )
        },
      },
      {
        header: t('Cost'),
        accessorKey: 'quota',
        cell: ({ row }) =>
          formatQuotaWithCurrency(
            row.original.type === LOG_TYPE_ENUM.REFUND
              ? -row.original.quota
              : row.original.quota,
            { ...quotaFormat, locale }
          ),
      },
    ],
    [locale, t]
  )
  const table = useReactTable({
    data: props.data.items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    rowCount: props.data.total,
    state: {
      pagination: {
        pageIndex: props.data.p - 1,
        pageSize: props.data.page_size,
      },
    },
    onPaginationChange: (updater) => {
      if (props.busy || exporting) return
      const current = table.getState().pagination
      const next = typeof updater === 'function' ? updater(current) : updater
      if (next.pageIndex !== current.pageIndex) {
        props.onQuery(props.filters, next.pageIndex + 1)
      }
    },
  })

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const { start, end } = fields.range
    const now = Math.floor(Date.now() / 1000)
    const startTimestamp = Math.floor((start?.getTime() ?? 0) / 1000)
    const endTimestamp = Math.min(Math.floor((end?.getTime() ?? 0) / 1000), now)
    if (startTimestamp <= 0 || startTimestamp > endTimestamp) {
      setDraft({ ...fields, error: t('Please select a valid time range') })
      return
    }
    if (endTimestamp - startTimestamp > props.data.max_range_days * 86400) {
      setDraft({
        ...fields,
        error: t('The time range cannot exceed {{days}} days', {
          days: props.data.max_range_days,
        }),
      })
      return
    }
    setDraft({ ...fields, error: '' })
    setExportError(null)
    props.onQuery(
      {
        start_timestamp: startTimestamp,
        end_timestamp: endTimestamp,
        model_name: fields.model.trim(),
      },
      1
    )
  }

  async function exportCsv() {
    const controller = new AbortController()
    exportController.current = controller
    setExporting(true)
    setExportError(null)
    try {
      const rows = await props.onExport(controller.signal)
      if (controller.signal.aborted) return
      const lines = [
        toCsvLine([
          t('Time'),
          t('Model'),
          t('Input Tokens'),
          t('Output Tokens'),
          t('Type'),
          t('Cost'),
        ]),
        ...rows.map((row) => {
          const refund = row.type === LOG_TYPE_ENUM.REFUND
          return toCsvLine([
            formatTimestampToDate(row.created_at),
            row.model_name,
            String(row.prompt_tokens),
            String(row.completion_tokens),
            refund ? t('Refund') : t('Consume'),
            formatQuotaWithCurrency(
              refund ? -row.quota : row.quota,
              quotaFormat
            ),
          ])
        }),
      ]
      downloadCsv('api-key-usage.csv', lines)
    } catch (failure) {
      if (!controller.signal.aborted) setExportError(failure)
    } finally {
      if (!controller.signal.aborted) setExporting(false)
    }
  }

  let rows = <DataTableView table={table} tableClassName='min-w-160' />
  if (props.busy) {
    rows = <LoadingState className='min-h-40' />
  } else if (props.data.items.length === 0) {
    rows = (
      <EmptyState
        className='min-h-40'
        title={t('No usage records')}
        description={t('Usage records are limited to retained logs.')}
      />
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('API usage records')}</h2>
        </CardTitle>
        {props.data.export_enabled && (
          <CardAction>
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={props.busy || exporting || props.data.total === 0}
              onClick={() => void exportCsv()}
            >
              <Download aria-hidden='true' />
              {exporting ? t('Exporting...') : t('Export CSV')}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className='space-y-3' aria-busy={props.busy}>
        <form
          onSubmit={applyFilters}
          className='flex flex-wrap items-center gap-2'
        >
          <div className='w-full sm:w-88'>
            <CompactDateTimeRangePicker
              start={fields.range.start}
              end={fields.range.end}
              onChange={(range) => setDraft({ ...fields, range, error: '' })}
            />
          </div>
          <Input
            aria-label={t('Exact model name')}
            placeholder={t('Exact model name')}
            maxLength={255}
            value={fields.model}
            onChange={(event) =>
              setDraft({ ...fields, model: event.target.value })
            }
            className='min-w-44 flex-1'
          />
          <Button
            type='submit'
            variant='outline'
            disabled={props.busy || exporting}
          >
            {t('Search')}
          </Button>
        </form>
        {fields.error && (
          <Alert variant='destructive'>
            <AlertDescription>{fields.error}</AlertDescription>
          </Alert>
        )}
        {exportError !== null && (
          <Alert variant='destructive'>
            <AlertDescription>
              {getServerErrorMessage(exportError, t('Failed to export logs'))}
            </AlertDescription>
          </Alert>
        )}
        {!props.data.consume_log_enabled && (
          <p className='text-muted-foreground text-sm'>
            {t('New consumption logs are disabled')}
          </p>
        )}
        {props.data.total_is_capped && (
          <p className='text-muted-foreground text-sm'>
            {t(
              'Only the latest {{count}} records are shown. Narrow the date range to see earlier records.',
              { count: props.data.total }
            )}
          </p>
        )}
        {rows}
        {props.data.total > 0 && (
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <span className='text-muted-foreground text-xs'>
              {t('Usage records are limited to retained logs.')}
            </span>
            <DataTablePagination table={table} compact />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
