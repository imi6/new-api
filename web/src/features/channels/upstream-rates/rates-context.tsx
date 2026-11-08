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
import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'

import { GroupMultiplierBadge } from '@/components/group-badge'
import { RatioChangeBadge } from '@/components/ratio-change-badge'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatTimestampToDate } from '@/lib/format'

import { isTagAggregateRow } from '../lib/channel-utils'
import type { Channel } from '../types'
import { getUpstreamRates, upstreamRateQueryKey } from './api'
import { upstreamRateStatusKeys } from './status'
import { summarizeUpstreamRate } from './summary'
import type { UpstreamRate } from './types'

type RateContext = {
  rates: Map<number, UpstreamRate>
  loading: boolean
  error: boolean
  select: (channel: Channel) => void
}
const Context = createContext<RateContext | null>(null)
const UpstreamRateDetailsDialog = lazy(() =>
  import('./details-dialog').then((module) => ({
    default: module.UpstreamRateDetailsDialog,
  }))
)

export function UpstreamRatesProvider(props: {
  channels: Channel[]
  visible: boolean
  children: ReactNode
}) {
  const [selected, setSelected] = useState<Channel | null>(null)
  const ids = useMemo(
    () =>
      [
        ...new Set(
          props.channels.flatMap((channel) =>
            isTagAggregateRow(channel)
              ? channel.children.map((child) => child.id)
              : [channel.id]
          )
        ),
      ].sort((a, b) => a - b),
    [props.channels]
  )
  const query = useQuery({
    queryKey: [...upstreamRateQueryKey, 'list', ids],
    queryFn: ({ signal }) => getUpstreamRates(ids, signal),
    enabled: ids.length > 0,
    refetchInterval: 60_000,
    staleTime: 15_000,
    meta: { errorToast: false },
  })
  const rates = useMemo(
    () =>
      new Map(
        (query.data ?? []).map((rate) => {
          if (!query.isError) return [rate.channel_id, rate] as const
          return [
            rate.channel_id,
            {
              ...rate,
              status: 'read_failed',
              matched_keys: 0,
              keys: rate.keys.map((key) =>
                key.status === 'matched'
                  ? { ...key, status: 'read_failed' }
                  : key
              ),
            },
          ] as const
        })
      ),
    [query.data, query.isError]
  )
  const value = useMemo(
    () => ({
      rates,
      loading: query.isPending,
      error: query.isError,
      select: setSelected,
    }),
    [rates, query.isPending, query.isError]
  )
  return (
    <Context.Provider value={value}>
      {props.children}
      {selected && props.visible && (
        <Suspense fallback={null}>
          <UpstreamRateDetailsDialog
            key={selected.id}
            channel={selected}
            rate={rates.get(selected.id)}
            loading={query.isPending}
            error={query.isError}
            onClose={() => setSelected(null)}
            onRetry={() => void query.refetch()}
          />
        </Suspense>
      )}
    </Context.Provider>
  )
}

export function UpstreamRateCell(props: {
  channel: Channel
  visible: boolean
}) {
  const { t, i18n } = useTranslation()
  const context = useContext(Context)
  if (!props.visible) return <span className='text-muted-foreground'>••••</span>
  if (isTagAggregateRow(props.channel)) {
    return (
      <span className='text-muted-foreground text-xs'>
        {t('Expand channels to view rates')}
      </span>
    )
  }
  if (!context || context.loading) {
    return (
      <span className='text-muted-foreground text-xs'>{t('Loading...')}</span>
    )
  }
  const rate = context.rates.get(props.channel.id)
  let status = rate?.status ?? 'unavailable'
  if (context.error) status = 'read_failed'
  const summary = rate ? summarizeUpstreamRate(rate) : undefined
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const format = new Intl.NumberFormat(locale, { maximumSignificantDigits: 15 })
    .format
  let label: string | undefined
  if (summary?.min !== undefined && summary.max !== undefined) {
    label =
      summary.min === summary.max
        ? `${format(summary.min)}×`
        : `${format(summary.min)}–${format(summary.max)}×`
  }
  return (
    <Button
      type='button'
      variant='ghost'
      size='sm'
      className='h-auto max-w-full flex-col items-start gap-1 px-1 py-1 text-start'
      onClick={() => context.select(props.channel)}
      aria-label={t('View upstream rates for {{name}}', {
        name: props.channel.name,
      })}
    >
      {label && <GroupMultiplierBadge ratio={summary?.min} label={label} />}
      {summary && summary.groupCount > 1 && (
        <span className='text-muted-foreground text-xs'>
          {t('{{count}} upstream groups', { count: summary.groupCount })}
        </span>
      )}
      {(status !== 'matched' || !label) && (
        <StatusBadge
          copyable={false}
          size='sm'
          label={t(
            upstreamRateStatusKeys[status] ?? 'Upstream data unavailable'
          )}
          variant='neutral'
        />
      )}
      {rate && rate.enabled_keys > 1 && (
        <span className='text-muted-foreground text-xs'>
          {t('Key coverage {{matched}}/{{total}}', {
            matched: rate.matched_keys,
            total: rate.enabled_keys,
          })}
        </span>
      )}
      {(summary?.historical || (context.error && label)) && (
        <span className='text-warning text-xs'>{t('Historical value')}</span>
      )}
      {summary?.change && (
        <RatioChangeBadge
          change={summary.change}
          formatValue={format}
          tooltip={t(
            'Observed ratio change: {{from}}× → {{to}}×. Local detection: {{date}}',
            {
              from: format(summary.change.from),
              to: format(summary.change.to),
              date: formatTimestampToDate(summary.change.at),
            }
          )}
        />
      )}
      {summary?.changed && !summary.change && (
        <span className='text-warning text-xs'>
          {t('Recent upstream ratio change')}
        </span>
      )}
      {summary?.moved && (
        <span className='text-warning text-xs'>{t('Key group changed')}</span>
      )}
    </Button>
  )
}
