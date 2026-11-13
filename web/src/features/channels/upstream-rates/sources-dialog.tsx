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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { SettingsSwitchField } from '@/features/system-settings/components/settings-form-layout'
import { hasPermission } from '@/lib/admin-permissions'
import { formatTimestampToDate } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { deleteUpstreamRateSource, upstreamRateQueryKey } from './api'
import { UpstreamRateConversionRules } from './conversion-rules'
import {
  useUpstreamRateConfig,
  useUpstreamRateGuard,
  useUpstreamRateRefresh,
} from './hooks'
import { UpstreamRateSourceForm } from './source-form'
import { upstreamRateErrorKeys } from './status'
import type { UpstreamRateSource } from './types'

export function UpstreamRateSourcesDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const canWrite = hasPermission(user, 'channel', 'sensitive_write')
  const canOperate = hasPermission(user, 'channel', 'operate')
  const config = useUpstreamRateConfig(props.open)
  const data = config.data
  const client = useQueryClient()
  const refresh = useUpstreamRateRefresh()
  const guard = useUpstreamRateGuard(props.open)
  const [editing, setEditing] = useState<UpstreamRateSource | 'new' | null>(
    null
  )
  const [deleting, setDeleting] = useState<UpstreamRateSource | null>(null)
  const remove = useMutation({
    mutationFn: deleteUpstreamRateSource,
    onSuccess: () => {
      setDeleting(null)
      void client.invalidateQueries({ queryKey: upstreamRateQueryKey })
      toast.success(t('Upstream rate source deleted'))
    },
  })
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Upstream rate sources')}
      description={t(
        'Configure API access once. Channel keys automatically match upstream channels and groups.'
      )}
    >
      {config.isPending && <LoadingState />}
      {config.isError && <ErrorState onRetry={() => void config.refetch()} />}
      {data && (
        <div className='space-y-4'>
          <SettingsSwitchField
            className='rounded-lg border p-3'
            controlId='upstream-rate-guard'
            checked={guard.enabled}
            onCheckedChange={(value) => guard.save(value)}
            disabled={!canWrite || guard.loading || guard.saving}
            label={t('Disable channels that cost more than they earn')}
            description={t(
              'After each upstream sync, a channel is disabled when its upstream rate is higher than the lowest ratio of its groups, and enabled again when the rate drops back. Channels disabled by hand or by request errors are left alone.'
            )}
          />
          <UpstreamRateConversionRules
            rules={data.conversion_rules ?? []}
            sites={data.conversion_sites ?? []}
            canWrite={canWrite}
          />
          {editing === null && canWrite && (
            <Button type='button' onClick={() => setEditing('new')}>
              {t('Add source')}
            </Button>
          )}
          {editing !== null && canWrite && (
            <UpstreamRateSourceForm
              key={editing === 'new' ? 'new' : editing.id}
              source={editing === 'new' ? undefined : editing}
              encryptionReady={data.encryption_ready}
              onDone={() => setEditing(null)}
            />
          )}
          {data.sources.length === 0 && editing === null && (
            <EmptyState
              title={t('No upstream rate sources')}
              description={t(
                'Add a source and read its snapshot. Existing channel keys are matched automatically.'
              )}
            />
          )}
          {data.sources.map((source) => {
            return (
              <section
                key={source.id}
                className='space-y-2 rounded-lg border p-3'
              >
                <h3 className='text-sm font-medium break-all'>{source.name}</h3>
                <p className='text-muted-foreground text-xs break-all'>
                  {source.base_url}
                </p>
                <p className='text-muted-foreground text-xs'>
                  {source.enabled ? t('Enabled') : t('Disabled')} ·{' '}
                  {source.token_configured
                    ? t('Token configured')
                    : t('Token not configured')}
                </p>
                <p className='text-muted-foreground text-xs'>
                  {t('Local snapshot read')}:{' '}
                  {source.read_at ? formatTimestampToDate(source.read_at) : '—'}
                </p>
                {source.error && (
                  <p className='text-destructive text-xs'>
                    {t(
                      upstreamRateErrorKeys[source.error] ??
                        'Upstream data unavailable'
                    )}
                  </p>
                )}
                {!source.complete && source.read_at > 0 && (
                  <p className='text-warning text-xs'>
                    {t('Partial upstream synchronization')}
                  </p>
                )}
                <div className='flex flex-wrap gap-2'>
                  <Button
                    type='button'
                    size='sm'
                    variant='outline'
                    disabled={!canOperate || !source.enabled || refresh.busy}
                    onClick={() => refresh.refresh({ source_id: source.id })}
                  >
                    {refresh.busy ? t('Refreshing...') : t('Update display')}
                  </Button>
                  {canWrite && (
                    <Button
                      type='button'
                      size='sm'
                      variant='outline'
                      onClick={() => setEditing(source)}
                    >
                      {t('Edit')}
                    </Button>
                  )}
                  {canWrite && (
                    <Button
                      type='button'
                      size='sm'
                      variant='destructive'
                      disabled={remove.isPending}
                      onClick={() => setDeleting(source)}
                    >
                      {t('Delete')}
                    </Button>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={t('Delete upstream rate source')}
        desc={t('Delete source "{{name}}"?', { name: deleting?.name })}
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => {
          if (deleting) remove.mutate(deleting.id)
        }}
      />
    </Dialog>
  )
}
