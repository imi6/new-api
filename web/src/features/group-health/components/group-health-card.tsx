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
import { Activity, Clock } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { ChannelTypeLogo } from '@/features/channels/components/channel-type-badge'
import {
  apiKeyGroupPlatform,
  apiKeyPlatformLabel,
  OTHER_PLATFORM,
} from '@/features/keys/lib/api-key-group-platforms'
import {
  formatLatency,
  formatUptimePct,
} from '@/features/performance-metrics/lib/format'
import { formatTimestampToDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import { GROUP_HEALTH_STATUS_META } from '../lib/group-health'
import type { GroupHealthGroup, GroupHealthRange } from '../types'
import { GroupHealthBars } from './group-health-bars'

interface GroupHealthCardProps {
  group: GroupHealthGroup
  range: GroupHealthRange
  rangeLabel: string
  onOpen: (group: GroupHealthGroup) => void
}

function MetricBox(props: {
  icon: ReactNode
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div className='bg-muted/30 flex min-w-0 flex-col gap-1 rounded-xl border px-3 py-2.5'>
      <span className='text-muted-foreground flex items-center gap-1.5 text-xs'>
        {props.icon}
        <span className='truncate'>{props.label}</span>
      </span>
      <span
        className={cn(
          'truncate text-xl font-semibold tabular-nums',
          props.valueClassName
        )}
      >
        {props.value}
      </span>
    </div>
  )
}

export function GroupHealthCard(props: GroupHealthCardProps) {
  const { t } = useTranslation()
  const group = props.group
  const platform = apiKeyGroupPlatform(
    group.name,
    group.platform ? { [group.name]: group.platform } : undefined
  )
  const status = GROUP_HEALTH_STATUS_META[group.status]
  const total = group.total
  let rateClass = 'text-muted-foreground'
  if (total.has_data) {
    rateClass = total.success_rate > 0 ? 'text-success' : 'text-destructive'
  }

  return (
    <div className='bg-card text-card-foreground ring-foreground/10 has-[>button:hover]:ring-foreground/20 has-[>button:focus-visible]:ring-ring relative flex min-w-0 flex-col gap-4 rounded-2xl p-4 ring-1 transition-shadow has-[>button:focus-visible]:ring-2 has-[>button:hover]:shadow-sm'>
      {/* Covers the card so a click anywhere opens the details; the bars sit
          above it to keep their tooltips. */}
      <button
        type='button'
        onClick={() => props.onOpen(group)}
        aria-label={t('View details of {{name}}', { name: group.name })}
        className='absolute inset-0 rounded-2xl outline-none'
      />
      <div className='pointer-events-none flex min-w-0 items-start gap-3'>
        <span className='bg-muted/60 flex size-11 shrink-0 items-center justify-center rounded-full'>
          {platform !== OTHER_PLATFORM && (
            <ChannelTypeLogo type={Number(platform)} size={24} />
          )}
        </span>
        <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
          <div className='flex min-w-0 items-start justify-between gap-2'>
            <span className='truncate text-base font-semibold'>
              {group.name}
            </span>
            <StatusBadge
              label={t(status.labelKey)}
              variant={status.variant}
              copyable={false}
              showDot
              size='sm'
              className='shrink-0'
            />
          </div>
          <div className='flex min-w-0 flex-wrap items-center gap-1.5'>
            {platform !== OTHER_PLATFORM && (
              <Badge variant='secondary' className='shrink-0'>
                {apiKeyPlatformLabel(platform, t)}
              </Badge>
            )}
            {group.top_model && (
              <Badge
                variant='outline'
                className='max-w-full min-w-0 truncate font-mono'
              >
                {group.top_model}
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className='pointer-events-none grid grid-cols-2 gap-2'>
        <MetricBox
          icon={<Clock className='size-3.5' aria-hidden='true' />}
          label={t('Avg latency · {{range}}', { range: props.rangeLabel })}
          value={formatLatency(total.avg_latency_ms)}
        />
        <MetricBox
          icon={<Activity className='size-3.5' aria-hidden='true' />}
          label={t('Success rate · {{range}}', { range: props.rangeLabel })}
          value={total.has_data ? formatUptimePct(total.success_rate) : '—'}
          valueClassName={rateClass}
        />
      </div>

      <div className='flex flex-col gap-2 border-t pt-3'>
        <div className='text-muted-foreground pointer-events-none flex flex-col text-xs'>
          <span>{props.rangeLabel}</span>
          <span className='tabular-nums'>
            {group.last_sample_at > 0
              ? formatTimestampToDate(group.last_sample_at)
              : t('No data')}
          </span>
        </div>
        <GroupHealthBars
          bars={group.bars}
          range={props.range}
          className='relative'
        />
      </div>
    </div>
  )
}
