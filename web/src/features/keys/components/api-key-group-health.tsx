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
import { Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { LoadingState } from '@/components/loading-state'
import { StatusBadge } from '@/components/status-badge'
import { getUserGroupHealth } from '@/features/group-health/api'
import { GroupHealthBars } from '@/features/group-health/components/group-health-bars'
import {
  GROUP_HEALTH_LATENCY_LABEL_KEYS,
  GROUP_HEALTH_STATUS_META,
} from '@/features/group-health/lib/group-health'
import {
  formatLatency,
  formatUptimePct,
} from '@/features/performance-metrics/lib/format'
import { formatTimestampToDate, formatTimeStr } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

interface ApiKeyGroupHealthProps {
  group: string
  enabled: boolean
}

/** 组合现有状态徽标和小时状态条，展示所选分组的用户可见摘要。 */
export function ApiKeyGroupHealth(props: ApiKeyGroupHealthProps) {
  const { t } = useTranslation()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const userGroup = useAuthStore((state) => state.auth.user?.group)
  const { data, isLoading, isError } = useQuery({
    queryKey: ['user-group-health', userId, userGroup],
    queryFn: async () => requireServerSuccess(await getUserGroupHealth()).data,
    enabled: props.enabled && userId !== undefined,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
    meta: { errorToast: false, errorRedirect: false },
  })

  // 读取失败时不再展示旧的正常状态；缺失分组也不能当成故障。
  const group = isError
    ? undefined
    : data?.groups.find((item) => item.name === props.group)
  const total = group?.total
  const status = GROUP_HEALTH_STATUS_META[group?.status ?? 'unknown']
  const latencyLabel = total?.latency_source
    ? GROUP_HEALTH_LATENCY_LABEL_KEYS[total.latency_source]
    : 'Time to first token'
  const updatedAt = !isError ? data?.updated_at : undefined

  return (
    <section
      aria-label={t('Current group status')}
      aria-busy={isLoading}
      className='bg-muted/15 min-w-0 rounded-xl border p-3'
    >
      <div className='flex items-start justify-between gap-2'>
        <h4 className='text-xs font-medium'>{t('Current group status')}</h4>
        {isLoading ? (
          <LoadingState inline size='sm' />
        ) : (
          <StatusBadge
            type='text'
            label={t(status.labelKey)}
            variant={status.variant}
            copyable={false}
            showDot
            className='shrink-0 text-xs'
          />
        )}
      </div>

      <dl className='mt-4 grid grid-cols-2 gap-2'>
        <div className='min-w-0'>
          <dt className='text-muted-foreground text-[10px] leading-4'>
            {t('24-hour success rate')}
          </dt>
          <dd className='mt-1 text-xl font-semibold tracking-tight tabular-nums'>
            {total?.has_data ? formatUptimePct(total.success_rate) : '—'}
          </dd>
        </div>
        <div className='min-w-0'>
          <dt className='text-muted-foreground text-[10px] leading-4'>
            {t(latencyLabel)}
          </dt>
          <dd className='mt-1 text-xl font-semibold tracking-tight tabular-nums'>
            {total?.latency_source ? formatLatency(total.avg_latency_ms) : '—'}
          </dd>
        </div>
      </dl>

      <div className='mt-3'>
        <p className='text-muted-foreground mb-2 text-[10px]'>
          {t('Last 24 hours')}
        </p>
        {group ? (
          <GroupHealthBars bars={group.bars} range='hour' />
        ) : (
          <div aria-hidden='true' className='bg-muted h-6 rounded-md' />
        )}
      </div>

      <p className='text-muted-foreground mt-3 flex flex-wrap items-center gap-1 text-[10px]'>
        <Clock aria-hidden='true' className='size-3 shrink-0' />
        <span>{t('Last updated')}</span>
        {updatedAt && updatedAt > 0 ? (
          <time
            dateTime={new Date(updatedAt * 1000).toISOString()}
            title={formatTimestampToDate(updatedAt)}
            className='tabular-nums'
          >
            {formatTimeStr(new Date(updatedAt * 1000))}
          </time>
        ) : (
          <span>—</span>
        )}
      </p>
    </section>
  )
}
