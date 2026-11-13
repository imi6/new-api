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
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { LoadingState } from '@/components/loading-state'
import { RatioChangeBadge } from '@/components/ratio-change-badge'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { toIntlLocale } from '@/i18n/languages'
import { hasPermission } from '@/lib/admin-permissions'
import { formatNumber, formatTimestampToDate } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import type { Channel } from '../types'
import { useUpstreamRateRefresh } from './hooks'
import { createUpstreamRateFormatter } from './lib/rate-format'
import { upstreamRateErrorKeys, upstreamRateStatusKeys } from './status'
import type { UpstreamRate, UpstreamRateKey } from './types'

function UpstreamRateKeyItem(props: {
  item: UpstreamRateKey
  showIndex: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const format = createUpstreamRateFormatter(locale)
  const item = props.item
  const historical = item.ratio !== undefined && item.status !== 'matched'
  const showStatus =
    !item.enabled || item.status !== 'matched' || item.match_method !== 'masked'
  const statusKey =
    upstreamRateStatusKeys[item.status] ?? 'Upstream data unavailable'
  const errorKey = item.error
    ? (upstreamRateErrorKeys[item.error] ?? 'Upstream data unavailable')
    : undefined
  let variant: 'neutral' | 'success' | 'warning' =
    item.status === 'matched' ? 'success' : 'warning'
  if (!item.enabled) variant = 'neutral'
  return (
    <article
      aria-label={t('Key #{{index}}', { index: item.index })}
      className='min-w-0 space-y-4 rounded-xl border p-4'
    >
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <span className='text-muted-foreground text-xs font-medium'>
          {props.showIndex
            ? t('Key #{{index}}', { index: item.index })
            : t('Upstream rates')}
        </span>
        <div className='flex flex-wrap items-center gap-2'>
          {showStatus && (
            <StatusBadge
              copyable={false}
              label={item.enabled ? t(statusKey) : t('Disabled')}
              variant={variant}
              type='text'
            />
          )}
          {historical && (
            <StatusBadge
              copyable={false}
              label={t('Historical value')}
              variant='warning'
              type='text'
            />
          )}
        </div>
      </div>
      <div className='space-y-1'>
        <p className='text-3xl leading-tight font-semibold break-all tabular-nums'>
          {item.ratio === undefined ? '—' : format(item.ratio)}
        </p>
        <p className='text-sm font-medium break-words'>
          {item.group_name ?? '—'}
        </p>
        {item.raw_ratio !== undefined &&
          item.ratio !== undefined &&
          item.conversion_factor !== undefined &&
          item.conversion_factor !== 1 && (
            <p className='text-muted-foreground text-xs break-words tabular-nums'>
              {t('Rate conversion: {{raw}} × {{factor}} = {{effective}}', {
                raw: format(item.raw_ratio),
                factor: format(item.conversion_factor),
                effective: format(item.ratio),
              })}
            </p>
          )}
      </div>
      {(item.source_id || item.site_url) && (
        <div className='text-muted-foreground space-y-1 text-xs'>
          {item.source_id && (
            <p className='break-words'>
              {item.source_name} / #{item.upstream_channel_id}{' '}
              {item.upstream_channel_name}
            </p>
          )}
          {item.site_url && <p className='break-all'>{item.site_url}</p>}
        </div>
      )}
      {errorKey && errorKey !== statusKey && (
        <p className='text-destructive text-xs'>{t(errorKey)}</p>
      )}
      {item.change && item.status === 'matched' && (
        <RatioChangeBadge
          change={item.change}
          formatValue={format}
          tooltip={t(
            'Observed ratio change: {{from}}× → {{to}}×. Local detection: {{date}}',
            {
              from: format(item.change.from),
              to: format(item.change.to),
              date: formatTimestampToDate(item.change.at),
            }
          )}
        />
      )}
      {item.change && item.status === 'matched' && item.change.from > 0 && (
        <p className='text-muted-foreground text-xs'>
          {t('Ratio change: {{percent}}%', {
            percent: formatNumber(
              ((item.change.to - item.change.from) / item.change.from) * 100,
              locale
            ),
          })}
        </p>
      )}
      {item.moved_from && (
        <p className='text-warning text-xs break-all'>
          {t('Key moved from {{group}}; detected locally at {{date}}', {
            group: item.moved_from,
            date: formatTimestampToDate(item.moved_at ?? 0),
          })}
        </p>
      )}
      <dl className='grid grid-cols-1 gap-3 border-t pt-3 text-xs sm:grid-cols-2'>
        <div className='min-w-0 space-y-1'>
          <dt className='text-muted-foreground'>{t('Rate collection time')}</dt>
          <dd className='break-words tabular-nums'>
            {item.collected_at ? formatTimestampToDate(item.collected_at) : '—'}
          </dd>
        </div>
        <div className='min-w-0 space-y-1'>
          <dt className='text-muted-foreground'>
            {t('Key synchronization time')}
          </dt>
          <dd className='break-words tabular-nums'>
            {item.key_synced_at
              ? formatTimestampToDate(item.key_synced_at)
              : '—'}
          </dd>
        </div>
      </dl>
    </article>
  )
}

export function UpstreamRateDetailsDialog(props: {
  channel: Channel
  rate?: UpstreamRate
  loading: boolean
  error: boolean
  onClose: () => void
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const canOperate = hasPermission(user, 'channel', 'operate')
  const refresh = useUpstreamRateRefresh()
  const [confirmForce, setConfirmForce] = useState(false)
  const rate = props.rate
  const enabled = rate?.keys.filter((item) => item.enabled) ?? []
  const disabled = rate?.keys.filter((item) => !item.enabled) ?? []
  const status =
    rate?.status === 'partial' &&
    enabled.length > 0 &&
    enabled.every((item) => item.status === 'matched')
      ? 'matched'
      : (rate?.status ?? 'unavailable')
  let groupsWithKeysOnly = t('Unknown')
  if (
    rate &&
    enabled.length > 0 &&
    enabled.every(
      (item) => Boolean(item.source_id) && (item.upstream_channel_id ?? 0) > 0
    )
  ) {
    groupsWithKeysOnly = rate.only_with_keys ? t('Yes') : t('No')
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t('Upstream rates')}
      description={props.channel.name}
      contentClassName='sm:max-w-xl'
      headerClassName='pr-6'
      descriptionClassName='break-all'
      footerClassName='flex-row flex-wrap justify-end'
      footer={
        (rate?.refresh_available || props.error) && (
          <>
            {rate?.refresh_available && (
              <Button
                type='button'
                variant='outline'
                className='flex-1 sm:flex-none'
                disabled={
                  !canOperate || refresh.busy || !rate.force_refresh_available
                }
                title={
                  !rate.force_refresh_available
                    ? t(
                        'Force refresh requires a uniquely identified upstream account channel.'
                      )
                    : undefined
                }
                onClick={() => setConfirmForce(true)}
              >
                {t('Force refresh upstream')}
              </Button>
            )}
            {props.error ? (
              <Button
                type='button'
                className='flex-1 sm:flex-none'
                onClick={props.onRetry}
              >
                {t('Retry')}
              </Button>
            ) : (
              <Button
                type='button'
                className='flex-1 sm:flex-none'
                disabled={!canOperate || refresh.busy}
                onClick={() =>
                  refresh.refresh({ channel_id: props.channel.id })
                }
              >
                {refresh.busy ? t('Refreshing...') : t('Update display')}
              </Button>
            )}
          </>
        )
      }
    >
      <div className='space-y-3'>
        {props.loading && <LoadingState inline />}
        {!props.loading && enabled.length === 0 && (
          <EmptyState
            title={t(
              upstreamRateStatusKeys[status] ?? 'Upstream data unavailable'
            )}
            className='min-h-32 py-6'
          />
        )}
        {enabled.map((item) => (
          <UpstreamRateKeyItem
            key={item.index}
            item={item}
            showIndex={(rate?.keys.length ?? 0) > 1}
          />
        ))}
        {rate?.error && !enabled.some((item) => item.error === rate.error) && (
          <p className='text-destructive text-xs'>
            {t(
              upstreamRateErrorKeys[rate.error] ?? 'Upstream data unavailable'
            )}
          </p>
        )}
        {rate && (
          <Collapsible className='border-t pt-1'>
            <CollapsibleTrigger
              render={
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  className='group text-muted-foreground w-full justify-between px-0 hover:bg-transparent'
                />
              }
            >
              {t('Details')}
              <ChevronDown
                className='size-4 transition-transform group-aria-expanded:rotate-180'
                aria-hidden
              />
            </CollapsibleTrigger>
            <CollapsibleContent className='space-y-4 pt-3'>
              <dl className='grid gap-4 text-xs sm:grid-cols-2'>
                <div className='min-w-0 space-y-1 sm:col-span-2'>
                  <dt className='text-muted-foreground'>{t('Base URL')}</dt>
                  <dd className='break-all'>
                    {props.channel.base_url || t('Default')}
                  </dd>
                </div>
                <div className='min-w-0 space-y-1'>
                  <dt className='text-muted-foreground'>
                    {t('Local snapshot read')}
                  </dt>
                  <dd className='break-words tabular-nums'>
                    {rate.read_at ? formatTimestampToDate(rate.read_at) : '—'}
                  </dd>
                </div>
                <div className='min-w-0 space-y-1'>
                  <dt className='text-muted-foreground'>
                    {t('Groups with keys only')}
                  </dt>
                  <dd>{groupsWithKeysOnly}</dd>
                </div>
              </dl>
              <p className='text-muted-foreground text-xs'>
                {t('Enabled key coverage: {{matched}}/{{total}}', {
                  matched: rate.matched_keys,
                  total: rate.enabled_keys,
                })}
              </p>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Read upstream snapshots without changing local prices, priorities, or weights.'
                )}
              </p>
              {disabled.length > 0 && (
                <section className='space-y-2'>
                  <h3 className='text-muted-foreground text-sm'>
                    {t('Disabled keys (excluded from range)')}
                  </h3>
                  {disabled.map((item) => (
                    <UpstreamRateKeyItem
                      key={item.index}
                      item={item}
                      showIndex
                    />
                  ))}
                </section>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
      <ConfirmDialog
        open={confirmForce}
        onOpenChange={setConfirmForce}
        title={t('Force refresh upstream')}
        desc={t(
          'This contacts the real upstream for this account channel and may take two minutes. A 60-second cooldown applies. Continue?'
        )}
        isLoading={refresh.busy}
        handleConfirm={() => {
          refresh.refresh({ channel_id: props.channel.id, force: true })
          setConfirmForce(false)
        }}
      />
    </Dialog>
  )
}
