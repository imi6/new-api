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
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { StaticDataTable } from '@/components/data-table/static/static-data-table'
import { StaticRowActions } from '@/components/data-table/static/static-row-actions'
import { SectionPageLayout } from '@/components/layout'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SettingsSwitchField } from '@/features/system-settings/components/settings-form-layout'
import { formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'

import { deleteBulletin, getManagedBulletins, setBulletinGuestPopup } from './api'
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

  const query = useQuery({
    queryKey: MANAGED_BULLETINS_QUERY_KEY,
    queryFn: getManagedBulletins,
  })
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: BULLETINS_QUERY_KEY })

  const remove = useMutation({
    mutationFn: (id: number) => deleteBulletin(id),
    onSuccess: () => {
      toast.success(t('Deleted'))
      setDeleting(null)
      refresh()
    },
    onError: (error) => handleServerError(error),
    meta: { errorToast: false },
  })

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
    setEditing(item)
    setFormOpen(true)
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Announcement management')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button size='sm' onClick={() => openForm(null)}>
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
          {query.isLoading ? (
            <Skeleton className='h-48 w-full' />
          ) : (
            <StaticDataTable
              data={query.data?.items ?? []}
              getRowKey={(item) => item.id}
              emptyContent={t(
                'No announcements yet. Click "New announcement" to create one.'
              )}
              columns={[
                {
                  id: 'title',
                  header: t('Title'),
                  cellClassName: 'max-w-xs truncate font-medium',
                  cell: (item) => item.title,
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
                  cell: (item) => t(BULLETIN_NOTIFY_LABEL_KEYS[item.notify_mode]),
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
                    />
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
            if (!open) setDeleting(null)
          }}
          title={t('Delete announcement')}
          desc={t(
            'The announcement is deleted for everyone. To only take it down, set it to Archived instead.'
          )}
          handleConfirm={() => {
            if (deleting) remove.mutate(deleting.id)
          }}
          isLoading={remove.isPending}
          destructive
          confirmText={t('Delete')}
        />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
