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
import {
  getCoreRowModel,
  useReactTable,
  type RowSelectionState,
} from '@tanstack/react-table'
import { Pin, PinOff, Plus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTableBulkActions, StaticDataTable } from '@/components/data-table'
import { StaticRowActions } from '@/components/data-table/static/static-row-actions'
import { SectionPageLayout } from '@/components/layout'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenuItem,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { SettingsSwitchField } from '@/features/system-settings/components/settings-form-layout'
import { formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { getServerErrorMessage } from '@/lib/server-error-message'

import {
  deleteBulletin,
  getManagedBulletins,
  setBulletinGuestPopup,
  setBulletinPinned,
} from './api'
import { BulletinFormDialog } from './components/bulletin-form-dialog'
import {
  BULLETIN_NOTIFY_LABEL_KEYS,
  BULLETIN_STATUS_LABEL_KEYS,
} from './components/labels'
import {
  BULLETINS_QUERY_KEY,
  MANAGED_BULLETINS_QUERY_KEY,
} from './hooks/use-bulletins'
import type { ManagedBulletin } from './types'

const EMPTY_BULLETINS: ManagedBulletin[] = []
const BULLETIN_BATCH_LIMIT = 100

type BulletinBulkInput = {
  action: 'pin' | 'unpin' | 'delete'
  ids: number[]
}

/**
 * The status shown in the table. A published announcement outside its
 * times reads as scheduled or ended, so the table says what users see.
 */
function bulletinState(item: ManagedBulletin): {
  labelKey: string
  variant: StatusVariant
} {
  if (item.status !== 'published') {
    return {
      labelKey: BULLETIN_STATUS_LABEL_KEYS[item.status],
      variant: item.status === 'draft' ? 'neutral' : 'warning',
    }
  }
  const now = Math.floor(Date.now() / 1000)
  if (item.starts_at > 0 && now < item.starts_at) {
    return { labelKey: 'Scheduled', variant: 'info' }
  }
  if (item.ends_at > 0 && now >= item.ends_at) {
    return { labelKey: 'Ended', variant: 'neutral' }
  }
  return { labelKey: 'Published', variant: 'success' }
}

/** The administrator's page for the announcements that pop up. */
export function BulletinManagement() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ManagedBulletin | null>(null)
  const [deleting, setDeleting] = useState<ManagedBulletin | null>(null)
  const [bulkDeleting, setBulkDeleting] = useState<number[] | null>(null)
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const operationInFlight = useRef(false)

  const query = useQuery({
    queryKey: MANAGED_BULLETINS_QUERY_KEY,
    queryFn: getManagedBulletins,
  })
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: BULLETINS_QUERY_KEY })
  const items = query.data?.items ?? EMPTY_BULLETINS
  const table = useReactTable({
    data: items,
    columns: [],
    getRowId: (item) => String(item.id),
    state: { rowSelection },
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    enableRowSelection: true,
  })
  const selectedIds = table
    .getFilteredSelectedRowModel()
    .rows.map((row) => row.original.id)

  const pin = useMutation({
    mutationFn: (input: { id: number; pinned: boolean }) =>
      setBulletinPinned(input.id, input.pinned),
    onSuccess: (_, input) => {
      toast.success(
        input.pinned ? t('Announcement pinned') : t('Announcement unpinned')
      )
      return refresh()
    },
    onError: (error) => handleServerError(error),
    onSettled: () => {
      operationInFlight.current = false
    },
    meta: { errorToast: false },
  })

  const remove = useMutation({
    mutationFn: (id: number) => deleteBulletin(id),
    onSuccess: async (_, id) => {
      toast.success(t('Deleted'))
      setDeleting(null)
      setRowSelection((previous) => {
        const next = { ...previous }
        delete next[String(id)]
        return next
      })
      await refresh()
    },
    onError: (error) => handleServerError(error),
    onSettled: () => {
      operationInFlight.current = false
    },
    meta: { errorToast: false },
  })

  const bulk = useMutation({
    mutationFn: async (input: BulletinBulkInput) => {
      const succeeded: number[] = []
      const failed: { id: number; error: unknown }[] = []
      // 沿用单条接口逐项执行，保留其权限、已读清理和缓存失效规则。
      for (const id of input.ids) {
        try {
          if (input.action === 'delete') await deleteBulletin(id)
          else await setBulletinPinned(id, input.action === 'pin')
          succeeded.push(id)
        } catch (error) {
          failed.push({ id, error })
        }
      }
      return { succeeded, failed }
    },
    onSuccess: async (result, input) => {
      const succeeded = new Set(result.succeeded.map(String))
      setRowSelection((previous) =>
        Object.fromEntries(
          Object.entries(previous).filter(([id]) => !succeeded.has(id))
        )
      )
      setBulkDeleting(null)
      if (result.succeeded.length > 0) {
        toast.success(
          input.action === 'delete'
            ? t('Deleted {{count}} announcements', {
                count: result.succeeded.length,
              })
            : t('Updated {{count}} announcements', {
                count: result.succeeded.length,
              })
        )
      }
      if (result.failed.length > 0) {
        toast.error(
          t(
            'Failed to process {{count}} announcements. Review the errors and retry.',
            { count: result.failed.length }
          )
        )
      }
      // 全部失败也刷新，可能是其他管理员已删除了选中的公告。
      await refresh()
    },
    onError: (error) => handleServerError(error),
    onSettled: () => {
      operationInFlight.current = false
    },
    meta: { errorToast: false },
  })
  const busy = pin.isPending || remove.isPending || bulk.isPending

  const runBulk = (input: BulletinBulkInput) => {
    if (
      operationInFlight.current ||
      input.ids.length === 0 ||
      input.ids.length > BULLETIN_BATCH_LIMIT
    ) {
      return
    }
    operationInFlight.current = true
    bulk.mutate(input)
  }

  const guestPopup = useMutation({
    mutationFn: (value: boolean) => setBulletinGuestPopup(value),
    onSuccess: () => {
      toast.success(t('Saved successfully'))
      refresh()
    },
    onError: (error) => handleServerError(error),
    meta: { errorToast: false },
  })

  const openForm = (item: ManagedBulletin | null) => {
    if (operationInFlight.current) return
    setEditing(item)
    setFormOpen(true)
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Announcement management')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button size='sm' onClick={() => openForm(null)} disabled={busy}>
          <Plus aria-hidden='true' />
          {t('New announcement')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='flex flex-col gap-4'>
          <div className='bg-card rounded-xl border px-4'>
            <SettingsSwitchField
              checked={query.data?.guest_popup ?? true}
              onCheckedChange={(checked) => guestPopup.mutate(checked)}
              disabled={!query.data || guestPopup.isPending}
              label={t('Pop up for visitors too')}
              description={t(
                'Visitors who are not signed in also get the popups. The announcements are public either way.'
              )}
            />
          </div>
          <DataTableBulkActions
            table={table}
            entityName={t('Announcements')}
            placement='inline'
          >
            <Button
              size='sm'
              variant='outline'
              disabled={busy || selectedIds.length > BULLETIN_BATCH_LIMIT}
              onClick={() => runBulk({ action: 'pin', ids: selectedIds })}
            >
              <Pin aria-hidden='true' />
              {t('Pin selected announcements')}
            </Button>
            <Button
              size='sm'
              variant='outline'
              disabled={busy || selectedIds.length > BULLETIN_BATCH_LIMIT}
              onClick={() => runBulk({ action: 'unpin', ids: selectedIds })}
            >
              <PinOff aria-hidden='true' />
              {t('Unpin selected announcements')}
            </Button>
            <Button
              size='sm'
              variant='destructive'
              disabled={busy || selectedIds.length > BULLETIN_BATCH_LIMIT}
              onClick={() => setBulkDeleting(selectedIds)}
            >
              <Trash2 aria-hidden='true' />
              {t('Delete selected announcements')}
            </Button>
            {selectedIds.length > BULLETIN_BATCH_LIMIT && (
              <span className='text-muted-foreground text-xs'>
                {t('Select at most {{count}} announcements per operation.', {
                  count: BULLETIN_BATCH_LIMIT,
                })}
              </span>
            )}
          </DataTableBulkActions>
          {!bulk.isPending && (bulk.data?.failed.length ?? 0) > 0 && (
            <div
              role='alert'
              className='bg-destructive/10 text-destructive max-h-40 overflow-auto rounded-xl p-3 text-sm'
            >
              <ul className='space-y-1'>
                {bulk.data?.failed.map((item) => (
                  <li key={item.id}>
                    {t('Announcement #{{id}}', { id: item.id })}:{' '}
                    {getServerErrorMessage(item.error)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {query.isLoading ? (
            <Skeleton className='h-48 w-full' />
          ) : (
            <StaticDataTable
              data={items}
              getRowKey={(item) => item.id}
              emptyContent={t(
                'No announcements yet. Click "New announcement" to create one.'
              )}
              columns={[
                {
                  id: 'select',
                  header: (
                    <Checkbox
                      checked={table.getIsAllRowsSelected()}
                      indeterminate={table.getIsSomeRowsSelected()}
                      onCheckedChange={(checked) =>
                        table.toggleAllRowsSelected(checked === true)
                      }
                      disabled={busy || items.length === 0}
                      aria-label={t('Select all')}
                    />
                  ),
                  className: 'w-12',
                  cell: (item) => (
                    <Checkbox
                      checked={table.getRow(String(item.id)).getIsSelected()}
                      onCheckedChange={(checked) =>
                        table
                          .getRow(String(item.id))
                          .toggleSelected(checked === true)
                      }
                      disabled={busy}
                      aria-label={t('Select row {{number}}', {
                        number: item.id,
                      })}
                    />
                  ),
                },
                {
                  id: 'title',
                  header: t('Title'),
                  cellClassName: 'max-w-xs truncate font-medium',
                  cell: (item) => (
                    <div className='flex min-w-0 items-center gap-2'>
                      {item.pinned && (
                        <StatusBadge
                          icon={Pin}
                          label={t('Pinned')}
                          variant='warning'
                          copyable={false}
                          className='shrink-0'
                        />
                      )}
                      <span className='truncate'>{item.title}</span>
                    </div>
                  ),
                },
                {
                  id: 'status',
                  header: t('Status'),
                  cell: (item) => {
                    const state = bulletinState(item)
                    return (
                      <StatusBadge
                        label={t(state.labelKey)}
                        variant={state.variant}
                        copyable={false}
                      />
                    )
                  },
                },
                {
                  id: 'notify',
                  header: t('Notification method'),
                  cell: (item) =>
                    t(BULLETIN_NOTIFY_LABEL_KEYS[item.notify_mode]),
                },
                {
                  id: 'schedule',
                  header: t('Display time'),
                  cellClassName: 'text-muted-foreground text-xs tabular-nums',
                  cell: (item) =>
                    item.starts_at || item.ends_at
                      ? `${item.starts_at ? formatTimestampToDate(item.starts_at) : t('No time limit')} ~ ${item.ends_at ? formatTimestampToDate(item.ends_at) : t('No time limit')}`
                      : t('Always'),
                },
                {
                  id: 'updated',
                  header: t('Updated'),
                  cellClassName: 'text-muted-foreground text-xs tabular-nums',
                  cell: (item) => formatTimestampToDate(item.updated_at),
                },
                {
                  id: 'actions',
                  header: t('Actions'),
                  cell: (item) => (
                    <StaticRowActions
                      editLabel={t('Edit')}
                      deleteLabel={t('Delete')}
                      menuLabel={t('Open menu')}
                      onEdit={() => openForm(item)}
                      onDelete={() => setDeleting(item)}
                      editDisabled={busy}
                      deleteDisabled={busy}
                    >
                      <DropdownMenuItem
                        disabled={busy}
                        onClick={() => {
                          if (operationInFlight.current) return
                          operationInFlight.current = true
                          pin.mutate({ id: item.id, pinned: !item.pinned })
                        }}
                      >
                        {item.pinned
                          ? t('Unpin announcement')
                          : t('Pin announcement')}
                        <DropdownMenuShortcut>
                          {item.pinned ? (
                            <PinOff size={16} aria-hidden='true' />
                          ) : (
                            <Pin size={16} aria-hidden='true' />
                          )}
                        </DropdownMenuShortcut>
                      </DropdownMenuItem>
                    </StaticRowActions>
                  ),
                },
              ]}
            />
          )}
        </div>
        <BulletinFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          editing={editing}
        />
        <ConfirmDialog
          open={deleting !== null}
          onOpenChange={(open) => {
            if (!open && !operationInFlight.current) setDeleting(null)
          }}
          title={t('Delete announcement')}
          desc={t(
            'The announcement is deleted for everyone. To only take it down, set it to Archived instead.'
          )}
          handleConfirm={() => {
            if (!deleting || operationInFlight.current) return
            operationInFlight.current = true
            remove.mutate(deleting.id)
          }}
          isLoading={remove.isPending}
          destructive
          confirmText={t('Delete')}
        />
        <ConfirmDialog
          open={bulkDeleting !== null}
          onOpenChange={(open) => {
            if (!open && !operationInFlight.current) setBulkDeleting(null)
          }}
          title={t('Delete {{count}} announcements?', {
            count: bulkDeleting?.length ?? 0,
          })}
          desc={t(
            '{{count}} announcements will be permanently deleted, including their read records. This cannot be undone.',
            { count: bulkDeleting?.length ?? 0 }
          )}
          handleConfirm={() => {
            if (bulkDeleting) runBulk({ action: 'delete', ids: bulkDeleting })
          }}
          isLoading={bulk.isPending}
          destructive
          confirmText={t('Delete')}
        />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
