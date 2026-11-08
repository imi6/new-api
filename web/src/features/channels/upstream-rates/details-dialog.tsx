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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { LoadingState } from '@/components/loading-state'
import { RatioChangeBadge } from '@/components/ratio-change-badge'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { hasPermission } from '@/lib/admin-permissions'
import { formatNumber, formatTimestampToDate } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import type { Channel } from '../types'
import { useUpstreamRateRefresh } from './hooks'
import { upstreamRateErrorKeys, upstreamRateStatusKeys } from './status'
import type { UpstreamRate, UpstreamRateKey } from './types'

function UpstreamRateKeyItem(props: { item: UpstreamRateKey }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const format = new Intl.NumberFormat(locale, { maximumSignificantDigits: 15 })
    .format
  const item = props.item
  const historical = item.ratio !== undefined && item.status !== 'matched'
  return (
    <article className='space-y-2 rounded-lg border p-3'>
      <div className='flex flex-wrap items-center gap-2 text-sm'>
        <span>{t('Key #{{index}}', { index: item.index })}</span>
        {!item.enabled && (
          <StatusBadge
            copyable={false}
            label={t('Disabled')}
            variant='neutral'
          />
        )}
        <StatusBadge
          copyable={false}
          label={t(
            upstreamRateStatusKeys[item.status] ?? 'Upstream data unavailable'
          )}
          variant={item.status === 'matched' ? 'success' : 'warning'}
        />
        {historical && (
          <StatusBadge
            copyable={false}
            label={t('Historical value')}
            variant='warning'
          />
        )}
      </div>
      {item.source_id && (
        <p className='text-muted-foreground text-xs break-all'>
          {item.source_name} / #{item.upstream_channel_id}{' '}
          {item.upstream_channel_name}
        </p>
      )}
      {item.site_url && (
        <p className='text-muted-foreground text-xs break-all'>
          {item.site_url}
        </p>
      )}
      {item.error && (
        <p className='text-destructive text-xs'>
          {t(upstreamRateErrorKeys[item.error] ?? 'Upstream data unavailable')}
        </p>
      )}
      <p className='text-sm break-all'>
        {item.group_name ?? '—'} ·{' '}
        {item.ratio === undefined ? '—' : format(item.ratio)}
      </p>
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
      <dl className='text-muted-foreground space-y-1 text-xs'>
        <div>
          <dt className='inline'>{t('Rate collection time')}: </dt>
          <dd className='inline'>
            {item.collected_at ? formatTimestampToDate(item.collected_at) : '—'}
          </dd>
        </div>
        <div>
          <dt className='inline'>{t('Key synchronization time')}: </dt>
          <dd className='inline'>
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
    >
      <div className='space-y-4'>
        <p className='text-muted-foreground text-xs'>
          {t(
            'Read upstream snapshots without changing local prices, priorities, or weights.'
          )}
        </p>
        {props.loading && <LoadingState inline />}
        {props.error && (
          <Button type='button' variant='outline' onClick={props.onRetry}>
            {t('Retry')}
          </Button>
        )}
        {rate && (
          <section className='space-y-2 text-sm'>
            <StatusBadge
              copyable={false}
              label={t(
                upstreamRateStatusKeys[status] ?? 'Upstream data unavailable'
              )}
              variant={status === 'matched' ? 'success' : 'warning'}
            />
            <p className='break-all'>
              {rate.source_name}{' '}
              {rate.upstream_channel_id
                ? ` / #${rate.upstream_channel_id} ${rate.upstream_channel_name ?? ''}`
                : ''}
            </p>
            {rate.site_url && (
              <p className='text-muted-foreground text-xs break-all'>
                {rate.site_url}
              </p>
            )}
            <p className='text-muted-foreground text-xs break-all'>
              {t('Base URL')}: {props.channel.base_url || t('Default')}
            </p>
            <p>
              {t('Enabled key coverage: {{matched}}/{{total}}', {
                matched: rate.matched_keys,
                total: rate.enabled_keys,
              })}
            </p>
            {rate.error && (
              <p className='text-destructive text-xs'>
                {t(
                  upstreamRateErrorKeys[rate.error] ??
                    'Upstream data unavailable'
                )}
              </p>
            )}
            <p className='text-muted-foreground text-xs'>
              {t('Local snapshot read')}:{' '}
              {rate.read_at ? formatTimestampToDate(rate.read_at) : '—'}
            </p>
            <p className='text-muted-foreground text-xs'>
              {t('Groups with keys only')}: {groupsWithKeysOnly}
            </p>
            {rate.refresh_available && (
              <div className='flex flex-wrap gap-2'>
                <Button
                  type='button'
                  variant='outline'
                  disabled={!canOperate || refresh.busy}
                  onClick={() =>
                    refresh.refresh({ channel_id: props.channel.id })
                  }
                >
                  {refresh.busy ? t('Refreshing...') : t('Update display')}
                </Button>
                <Button
                  type='button'
                  variant='outline'
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
              </div>
            )}
          </section>
        )}
        {enabled.map((item) => (
          <UpstreamRateKeyItem key={item.index} item={item} />
        ))}
        {disabled.length > 0 && (
          <section className='space-y-2'>
            <h3 className='text-muted-foreground text-sm'>
              {t('Disabled keys (excluded from range)')}
            </h3>
            {disabled.map((item) => (
              <UpstreamRateKeyItem key={item.index} item={item} />
            ))}
          </section>
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
