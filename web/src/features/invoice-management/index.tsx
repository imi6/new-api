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
import { getRouteApi } from '@tanstack/react-router'
import type { RowSelectionState } from '@tanstack/react-table'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import {
  INVOICE_STATUS_FILTERS,
  INVOICE_STATUS_META,
} from '@/features/invoice/lib/invoice'
import type { Invoice, InvoiceStatus } from '@/features/invoice/types'
import { useMediaQuery } from '@/hooks'
import { useTableUrlState } from '@/hooks/use-table-url-state'

import { InvoiceBulkActions } from './components/invoice-bulk-actions'
import { useInvoiceColumns } from './components/invoice-columns'
import { InvoiceDeleteDialog } from './components/invoice-delete-dialog'
import { InvoiceDetailDrawer } from './components/invoice-detail-drawer'
import {
  useAdminInvoices,
  useRefreshAdminInvoices,
} from './hooks/use-admin-invoices'

const route = getRouteApi('/_authenticated/invoice-management/')

export function InvoiceManagement() {
  const { t } = useTranslation()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const refresh = useRefreshAdminInvoices()
  const [detailId, setDetailId] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Invoice | null>(null)
  const [batchDeleteTargets, setBatchDeleteTargets] = useState<
    Invoice[] | null
  >(null)
  const [selection, setSelection] = useState<{
    scope: string
    rows: RowSelectionState
  }>({
    scope: '',
    rows: {},
  })
  const columns = useInvoiceColumns(
    (invoice) => setDetailId(invoice.id),
    setDeleteTarget
  )

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
    columnFilters: [{ columnId: 'status', searchKey: 'status', type: 'array' }],
  })
  const statusFilter =
    (columnFilters.find((filter) => filter.id === 'status')?.value as
      | string[]
      | undefined) ?? []
  const status = statusFilter[0] as InvoiceStatus | undefined
  const selectionScope = JSON.stringify([
    pagination.pageIndex,
    pagination.pageSize,
    status ?? '',
    globalFilter?.trim() ?? '',
  ])
  // 选择仅作用于当前页和当前筛选，切换后不保留隐藏的勾选。
  if (selection.scope !== selectionScope) {
    setSelection({ scope: selectionScope, rows: {} })
  }

  const query = useAdminInvoices({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    status,
    keyword: globalFilter?.trim() ?? '',
  })

  const { table } = useDataTable({
    data: query.isPlaceholderData ? [] : (query.data?.items ?? []),
    columns,
    enableRowSelection: true,
    rowSelection: selection.scope === selectionScope ? selection.rows : {},
    onRowSelectionChange: (updater) => {
      setSelection((previous) => ({
        scope: selectionScope,
        rows: typeof updater === 'function' ? updater(previous.rows) : updater,
      }))
    },
    getRowId: (row) => String(row.id),
    columnFilters,
    globalFilter,
    pagination,
    onPaginationChange,
    onGlobalFilterChange,
    onColumnFiltersChange,
    manualPagination: true,
    manualFiltering: true,
    totalCount: query.data?.total ?? 0,
    ensurePageInRange,
  })

  const statusOptions = INVOICE_STATUS_FILTERS.map((value) => ({
    label: t(INVOICE_STATUS_META[value].labelKey),
    value,
  }))

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>
        {t('Invoice management')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          variant='outline'
          size='sm'
          onClick={() => void refresh()}
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
          isLoading={query.isLoading || query.isPlaceholderData}
          isFetching={query.isFetching}
          emptyTitle={t('No applications found')}
          emptyDescription={t(
            'Invoice applications submitted by users appear here.'
          )}
          skeletonKeyPrefix='invoice-management-skeleton'
          applyHeaderSize
          mobileProps={{ enableRowSelection: true }}
          showMobileBulkActions
          bulkActions={
            <InvoiceBulkActions
              table={table}
              onDelete={setBatchDeleteTargets}
            />
          }
          toolbarProps={{
            searchPlaceholder: t(
              'Search by ID, user ID, title, tax number or tax order number'
            ),
            searchDebounceMs: 500,
            filters: [
              {
                columnId: 'status',
                title: t('Status'),
                options: statusOptions,
                singleSelect: true,
              },
            ],
          }}
        />
        <InvoiceDetailDrawer
          invoiceId={detailId}
          onOpenChange={(open) => {
            if (!open) setDetailId(null)
          }}
          onChanged={() => void refresh()}
          onDelete={setDeleteTarget}
        />
        {deleteTarget && (
          <InvoiceDeleteDialog
            key={deleteTarget.id}
            invoice={deleteTarget}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null)
            }}
            onDeleted={(id) => {
              setDeleteTarget(null)
              setDetailId((current) => (current === id ? null : current))
              table.setRowSelection((previous) => {
                const next = { ...previous }
                delete next[String(id)]
                return next
              })
            }}
          />
        )}
        {batchDeleteTargets && (
          <InvoiceDeleteDialog
            mode='batch'
            invoices={batchDeleteTargets}
            onOpenChange={(open) => {
              if (!open) setBatchDeleteTargets(null)
            }}
            onDeleted={(ids) => {
              const deletedIds = new Set(ids)
              setDetailId((current) =>
                current !== null && deletedIds.has(current) ? null : current
              )
              table.setRowSelection((previous) => {
                const next = { ...previous }
                for (const id of ids) delete next[String(id)]
                return next
              })
              setBatchDeleteTargets((previous) => {
                const remaining =
                  previous?.filter((invoice) => !deletedIds.has(invoice.id)) ??
                  []
                return remaining.length > 0 ? remaining : null
              })
            }}
          />
        )}
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
