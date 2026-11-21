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
import {
  getCoreRowModel,
  useReactTable,
  type RowSelectionState,
} from '@tanstack/react-table'
import { LifeBuoy, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  DataTableBulkActions,
  DataTablePagination,
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatDateTimeStr } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { getTickets, submitTicket } from './api'
import { ticketCategoryLabel, ticketStatusLabel } from './labels'
import { useTicketReminderStore } from './reminder-store'
import { TicketComposer } from './ticket-composer'
import { TicketDeleteDialog } from './ticket-delete-dialog'
import { TicketStatusBadge } from './ticket-status-badge'
import {
  TICKET_CATEGORIES,
  type SupportTicket,
  type TicketCategory,
  type TicketFilters,
  type TicketStatus,
} from './types'

const EMPTY_TICKETS: SupportTicket[] = []
const STATUS_OPTIONS: TicketStatus[] = ['open', 'waiting_user', 'closed']

export function SupportTickets() {
  const userId = useAuthStore((state) => state.auth.user?.id)
  if (!userId) return null
  return <TicketWorkspace key={userId} userId={userId} admin={false} />
}

export function SupportTicketManagement() {
  const userId = useAuthStore((state) => state.auth.user?.id)
  if (!userId) return null
  return <TicketWorkspace key={userId} userId={userId} admin />
}

function TicketWorkspace(props: { userId: number; admin: boolean }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [filters, setFilters] = useState<TicketFilters>({
    page: 1,
    pageSize: 20,
    status: '',
    category: '',
    userId: '',
  })
  const [createOpen, setCreateOpen] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [userIdInput, setUserIdInput] = useState('')
  const [selection, setSelection] = useState<{
    filters: TicketFilters
    rows: RowSelectionState
  } | null>(null)
  const [deleteTargets, setDeleteTargets] = useState<number[] | null>(null)
  const rootKey = ['support-tickets', props.userId, props.admin] as const
  const query = useQuery({
    queryKey: [...rootKey, 'list', filters],
    queryFn: ({ signal }) => getTickets(props.admin, filters, signal),
    staleTime: 15_000,
    refetchInterval: 30_000,
    meta: { errorToast: false, errorRedirect: false },
  })
  const tickets = query.data?.items ?? EMPTY_TICKETS
  // 翻页或切换筛选后立即清空当前选择，批量操作仅作用于本页可见工单。
  const rowSelection = selection?.filters === filters ? selection.rows : {}
  const table = useReactTable({
    data: tickets,
    columns: [],
    getRowId: (ticket) => String(ticket.id),
    getCoreRowModel: getCoreRowModel(),
    enableRowSelection: props.admin,
    onRowSelectionChange: (updater) =>
      setSelection({
        filters,
        rows: typeof updater === 'function' ? updater(rowSelection) : updater,
      }),
    manualPagination: true,
    rowCount: query.data?.total ?? 0,
    state: {
      rowSelection,
      pagination: { pageIndex: filters.page - 1, pageSize: filters.pageSize },
    },
    onPaginationChange: (updater) =>
      setFilters((previous) => {
        const pagination = {
          pageIndex: previous.page - 1,
          pageSize: previous.pageSize,
        }
        const next =
          typeof updater === 'function' ? updater(pagination) : updater
        return {
          ...previous,
          page: next.pageIndex + 1,
          pageSize: next.pageSize,
        }
      }),
  })
  const columns: StaticDataTableColumn<SupportTicket>[] = [
    {
      id: 'id',
      header: t('ID'),
      className: 'w-20',
      cell: (ticket) => <span className='font-mono text-xs'>#{ticket.id}</span>,
    },
    {
      id: 'category',
      header: t('Ticket category'),
      cell: (ticket) => ticketCategoryLabel(ticket.category, t),
    },
    {
      id: 'status',
      header: t('Status'),
      cell: (ticket) => (
        <TicketStatusBadge status={ticket.status} admin={props.admin} />
      ),
    },
    {
      id: 'created_at',
      header: t('Created At'),
      cell: (ticket) => (
        <span className='text-muted-foreground text-xs whitespace-nowrap'>
          {formatDateTimeStr(new Date(ticket.created_at * 1000))}
        </span>
      ),
    },
    {
      id: 'last_reply',
      header: t('Last reply'),
      cell: (ticket) => (
        <span className='text-muted-foreground text-xs whitespace-nowrap'>
          {ticket.last_reply_at
            ? formatDateTimeStr(new Date(ticket.last_reply_at * 1000))
            : '—'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: t('Actions'),
      className: 'w-24',
      cell: (ticket) => (
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() =>
            useTicketReminderStore
              .getState()
              .openDetail(props.userId, ticket.id, props.admin)
          }
        >
          {t('View')}
        </Button>
      ),
    },
  ]
  if (props.admin) {
    columns.splice(1, 0, {
      id: 'user_id',
      header: t('User ID'),
      cell: (ticket) => ticket.user_id,
    })
    columns.unshift({
      id: 'select',
      className: 'w-12',
      header: (
        <Checkbox
          aria-label={t('Select all')}
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={table.getIsSomePageRowsSelected()}
          onCheckedChange={(checked) =>
            table.toggleAllPageRowsSelected(checked)
          }
        />
      ),
      cell: (ticket) => (
        <Checkbox
          aria-label={t('Select ticket #{{id}}', { id: ticket.id })}
          checked={table.getRow(String(ticket.id)).getIsSelected()}
          onCheckedChange={(checked) =>
            table.getRow(String(ticket.id)).toggleSelected(checked)
          }
        />
      ),
    })
  }
  const filterStatusItems = [
    { value: 'all', label: t('All statuses') },
    ...STATUS_OPTIONS.map((status) => ({
      value: status,
      label: ticketStatusLabel(status, t, props.admin),
    })),
  ]
  const filterCategoryItems = [
    { value: 'all', label: t('All categories') },
    ...TICKET_CATEGORIES.map((category) => ({
      value: category,
      label: ticketCategoryLabel(category, t),
    })),
  ]

  let content: ReactNode = <LoadingState />
  if (query.isError) {
    content = (
      <ErrorState
        description={t('Failed to load')}
        onRetry={() => void query.refetch()}
      />
    )
  } else if (query.data) {
    if (!tickets.length) {
      const filtered =
        filters.status !== '' ||
        filters.category !== '' ||
        filters.userId !== '' ||
        filters.page > 1
      content = (
        <EmptyState
          icon={LifeBuoy}
          title={
            filtered ? t('No matching tickets') : t('No support tickets yet')
          }
          description={
            !props.admin && !filtered
              ? t(
                  'Submit a ticket for API errors, missing top-ups, refunds or account issues and track replies here.'
                )
              : undefined
          }
          bordered
          className='min-h-72 rounded-2xl border-dashed'
          action={
            !props.admin ? (
              <Button
                type='button'
                className='rounded-full'
                onClick={() => setCreateOpen(true)}
              >
                {t('Submit a ticket')}
              </Button>
            ) : undefined
          }
        />
      )
    } else {
      content = (
        <div className='space-y-4'>
          <StaticDataTable
            columns={columns}
            data={tickets}
            getRowKey={(ticket) => ticket.id}
          />
        </div>
      )
    }
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {props.admin ? t('Support ticket management') : t('My support tickets')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          type='button'
          size='sm'
          variant='outline'
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw
            className={query.isFetching ? 'animate-spin' : undefined}
            aria-hidden='true'
          />
          {t('Refresh')}
        </Button>
        {!props.admin && (
          <Button type='button' size='sm' onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden='true' />
            {t('Submit a ticket')}
          </Button>
        )}
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='mx-auto w-full max-w-7xl space-y-5'>
          {!props.admin && (
            <p className='text-muted-foreground text-sm'>
              {t('Support hours: 09:00–22:00 daily. Replies will appear here.')}
            </p>
          )}
          <div className='flex flex-wrap items-center gap-3'>
            <Select
              items={filterStatusItems}
              value={filters.status || 'all'}
              onValueChange={(value) =>
                setFilters((previous) => ({
                  ...previous,
                  page: 1,
                  status: value === 'all' ? '' : (value as TicketStatus),
                }))
              }
            >
              <SelectTrigger aria-label={t('Status')} className='min-w-36'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {filterStatusItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {props.admin && (
              <>
                <Select
                  items={filterCategoryItems}
                  value={filters.category || 'all'}
                  onValueChange={(value) =>
                    setFilters((previous) => ({
                      ...previous,
                      page: 1,
                      category:
                        value === 'all' ? '' : (value as TicketCategory),
                    }))
                  }
                >
                  <SelectTrigger
                    aria-label={t('Ticket category')}
                    className='min-w-36'
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {filterCategoryItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <form
                  className='flex items-center gap-2'
                  onSubmit={(event) => {
                    event.preventDefault()
                    setFilters((previous) => ({
                      ...previous,
                      page: 1,
                      userId: userIdInput,
                    }))
                  }}
                >
                  <Input
                    aria-label={t('User ID')}
                    placeholder={t('User ID')}
                    inputMode='numeric'
                    className='w-28'
                    value={userIdInput}
                    onChange={(event) =>
                      setUserIdInput(
                        event.target.value.replaceAll(/\D/g, '').slice(0, 10)
                      )
                    }
                  />
                  <Button type='submit' variant='outline' size='sm'>
                    {t('Search')}
                  </Button>
                </form>
              </>
            )}
          </div>
          {props.admin && (
            <DataTableBulkActions
              table={table}
              placement='inline'
              entityName={t('Support tickets')}
            >
              <Button
                type='button'
                size='sm'
                variant='destructive'
                onClick={() =>
                  setDeleteTargets(
                    table
                      .getFilteredSelectedRowModel()
                      .rows.map((row) => row.original.id)
                  )
                }
              >
                <Trash2 aria-hidden='true' />
                {t('Delete selected tickets')}
              </Button>
            </DataTableBulkActions>
          )}
          {content}
          {query.data && (query.data.total > 0 || filters.page > 1) && (
            <DataTablePagination table={table} />
          )}
        </div>
        {props.admin && deleteTargets && (
          <TicketDeleteDialog
            ids={deleteTargets}
            onOpenChange={(open) => {
              if (!open) setDeleteTargets(null)
            }}
            onDeleted={() => {
              setSelection(null)
              setDeleteTargets(null)
              setFilters((previous) => ({ ...previous, page: 1 }))
            }}
          />
        )}
        {!props.admin && createOpen && (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open && !createBusy) setCreateOpen(false)
            }}
            title={t('Submit a ticket')}
            contentClassName='sm:max-w-xl'
            showCloseButton={!createBusy}
          >
            <TicketComposer
              creating
              submit={submitTicket}
              onBusyChange={setCreateBusy}
              onCancel={() => setCreateOpen(false)}
              onSuccess={async () => {
                await client.invalidateQueries({ queryKey: rootKey })
                setCreateOpen(false)
                setFilters((previous) => ({ ...previous, page: 1, status: '' }))
                toast.success(t('Ticket submitted'))
              }}
            />
          </Dialog>
        )}
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
