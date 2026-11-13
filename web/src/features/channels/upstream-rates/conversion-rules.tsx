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
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { handleServerError } from '@/lib/handle-server-error'

import { saveUpstreamRateConversionRules } from './api'
import { UpstreamRateConversionForm } from './conversion-rule-form'
import { upstreamRateConversionRuleKey } from './lib/conversion-schema'
import { createUpstreamRateFormatter } from './lib/rate-format'
import type {
  UpstreamRateConversionRule,
  UpstreamRateConversionSite,
} from './types'

export function UpstreamRateConversionRules(props: {
  rules: UpstreamRateConversionRule[]
  sites: UpstreamRateConversionSite[]
  canWrite: boolean
}) {
  const { t, i18n } = useTranslation()
  const client = useQueryClient()
  const [editing, setEditing] = useState<
    UpstreamRateConversionRule | 'new' | null
  >(null)
  const [deleting, setDeleting] = useState<UpstreamRateConversionRule | null>(
    null
  )
  const editingRule = editing && editing !== 'new' ? editing : undefined
  const format = createUpstreamRateFormatter(
    toIntlLocale(i18n.resolvedLanguage || i18n.language)
  )
  const save = useMutation({
    mutationFn: (input: {
      rules: UpstreamRateConversionRule[]
      deleted?: boolean
    }) => saveUpstreamRateConversionRules(input.rules),
    onSuccess: async (result, input) => {
      await client.invalidateQueries({ queryKey: ['channels'] })
      setEditing(null)
      setDeleting(null)
      if (result.guard_rechecked === false) {
        toast.warning(
          t(
            'Conversion rules saved, but channel status could not be refreshed. The next snapshot sync will retry.'
          )
        )
        return
      }
      toast.success(
        t(input.deleted ? 'Conversion rule deleted' : 'Conversion rule saved')
      )
    },
    onError: (error) => handleServerError(error),
  })

  return (
    <section className='space-y-3 rounded-lg border p-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h3 className='text-sm font-medium'>{t('Site rate conversion')}</h3>
        {props.canWrite && (
          <Button
            type='button'
            size='sm'
            variant='outline'
            disabled={save.isPending || props.sites.length === 0}
            onClick={() => setEditing('new')}
          >
            {t('Add conversion rule')}
          </Button>
        )}
      </div>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Unconfigured sites use a factor of 1. Group rules override channel rules, which override site rules.'
        )}
      </p>
      {props.rules.length === 0 && (
        <EmptyState
          title={t('No conversion rules')}
          description={
            props.sites.length === 0
              ? t('Read an upstream snapshot to select a site.')
              : undefined
          }
          className='min-h-32 py-4'
        />
      )}
      {props.rules.map((rule) => {
        const site = props.sites.find(
          (item) =>
            item.source_id === rule.source_id && item.site_url === rule.site_url
        )
        const channel = site?.channels.find(
          (item) => item.id === rule.upstream_channel_id
        )
        let scope = t('All upstream channels')
        if (rule.upstream_channel_id) {
          scope = `#${rule.upstream_channel_id}`
          if (channel?.name) scope += ` ${channel.name}`
          let groupName =
            channel?.groups.find((item) =>
              rule.group_id
                ? item.id === rule.group_id
                : item.name === rule.group_name
            )?.name ?? rule.group_name
          if (!groupName && rule.group_id) groupName = `#${rule.group_id}`
          scope += ` / ${groupName || t('All groups')}`
        }
        return (
          <div
            key={upstreamRateConversionRuleKey(rule)}
            className='bg-muted/30 flex flex-wrap items-center justify-between gap-3 rounded-lg p-3'
          >
            <div className='min-w-0 flex-1 space-y-1'>
              <p className='text-sm font-medium break-all'>
                {site?.source_name ?? rule.source_id} · {rule.site_url}
              </p>
              <p className='text-muted-foreground text-xs break-words'>
                {scope}
              </p>
              <p className='text-xs tabular-nums'>
                {t('Conversion factor')}: {format(rule.factor)}
              </p>
            </div>
            {props.canWrite && (
              <div className='flex gap-2'>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  disabled={save.isPending}
                  onClick={() => setEditing(rule)}
                >
                  {t('Edit')}
                </Button>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  disabled={save.isPending}
                  onClick={() => setDeleting(rule)}
                >
                  {t('Delete')}
                </Button>
              </div>
            )}
          </div>
        )
      })}
      {editing !== null && props.canWrite && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !save.isPending) setEditing(null)
          }}
          title={
            editing === 'new'
              ? t('Add conversion rule')
              : t('Edit conversion rule')
          }
        >
          <UpstreamRateConversionForm
            key={
              editing === 'new' ? 'new' : upstreamRateConversionRuleKey(editing)
            }
            rule={editingRule}
            rules={props.rules}
            sites={props.sites}
            saving={save.isPending}
            onCancel={() => setEditing(null)}
            onSave={(rule) => {
              const previousKey = editingRule
                ? upstreamRateConversionRuleKey(editingRule)
                : null
              save.mutate({
                rules: [
                  ...props.rules.filter(
                    (item) =>
                      upstreamRateConversionRuleKey(item) !== previousKey
                  ),
                  rule,
                ],
              })
            }}
          />
        </Dialog>
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !save.isPending) setDeleting(null)
        }}
        title={t('Delete conversion rule')}
        desc={t(
          'Delete the conversion rule for {{site}}? The next matching rule or the default factor of 1 will apply.',
          { site: deleting?.site_url }
        )}
        destructive
        isLoading={save.isPending}
        disabled={!props.canWrite}
        handleConfirm={() => {
          if (!deleting || !props.canWrite) return
          const key = upstreamRateConversionRuleKey(deleting)
          save.mutate({
            rules: props.rules.filter(
              (item) => upstreamRateConversionRuleKey(item) !== key
            ),
            deleted: true,
          })
        }}
      />
    </section>
  )
}
