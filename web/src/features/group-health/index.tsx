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
import { HeartPulse, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { PublicLayout } from '@/components/layout'
import { PageTransition } from '@/components/page-transition'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

import { GroupHealthCard } from './components/group-health-card'
import { GroupHealthDetailDialog } from './components/group-health-detail-dialog'
import { useGroupHealth } from './hooks/use-group-health'
import {
  GROUP_HEALTH_RANGE_LABEL_KEYS,
  GROUP_HEALTH_REFRESH_OPTIONS,
} from './lib/group-health'

const REFRESH_STORAGE_KEY = 'group-health-refresh-seconds'
const SKELETON_KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

function readRefreshSeconds(): number {
  try {
    const stored = Number(window.localStorage.getItem(REFRESH_STORAGE_KEY))
    if ((GROUP_HEALTH_REFRESH_OPTIONS as readonly number[]).includes(stored)) {
      return stored
    }
  } catch {
    /* storage may be unavailable */
  }
  return GROUP_HEALTH_REFRESH_OPTIONS[0]
}

export function GroupHealth() {
  const { t } = useTranslation()
  const [refreshSeconds, setRefreshSeconds] = useState(readRefreshSeconds)
  const [detailGroup, setDetailGroup] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const query = useGroupHealth('hour', {
    refetchIntervalMs: refreshSeconds * 1000,
  })
  const data = query.data
  const groups = data?.groups ?? []
  const healthy = groups.filter((group) => group.status === 'ok').length
  const anyDown = groups.some((group) => group.status === 'down')
  const rangeLabel = t(GROUP_HEALTH_RANGE_LABEL_KEYS.hour)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const secondsLeft = Math.max(
    0,
    Math.ceil((query.dataUpdatedAt + refreshSeconds * 1000 - now) / 1000)
  )

  const changeRefresh = (value: number) => {
    setRefreshSeconds(value)
    try {
      window.localStorage.setItem(REFRESH_STORAGE_KEY, String(value))
    } catch {
      /* storage may be unavailable */
    }
  }

  const renderBody = () => {
    if (query.isLoading) {
      return (
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'>
          {SKELETON_KEYS.map((key) => (
            <Skeleton key={key} className='h-64 rounded-2xl' />
          ))}
        </div>
      )
    }
    if (query.isError || !data) {
      return (
        <EmptyState
          icon={HeartPulse}
          title={t('Unable to load group health')}
          description={t('Try again later.')}
          className='min-h-[320px]'
        />
      )
    }
    if (!data.real_traffic_enabled && !data.probe_enabled) {
      return (
        <EmptyState
          icon={HeartPulse}
          title={t('No health data yet')}
          description={t(
            'The administrator needs to turn on performance metrics or scheduled channel tests.'
          )}
          className='min-h-[320px]'
        />
      )
    }
    if (groups.length === 0) {
      return (
        <EmptyState
          icon={HeartPulse}
          title={t('No groups to show')}
          description={t('Groups that users can choose appear here.')}
          className='min-h-[320px]'
        />
      )
    }
    return (
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'>
        {groups.map((group) => (
          <GroupHealthCard
            key={group.name}
            group={group}
            range='hour'
            rangeLabel={rangeLabel}
            onOpen={(item) => setDetailGroup(item.name)}
          />
        ))}
      </div>
    )
  }

  return (
    <PublicLayout showMainContainer={false}>
      <PageTransition className='mx-auto w-full max-w-[1600px] space-y-4 px-3 pt-20 pb-10 sm:px-6 xl:px-8'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div className='flex flex-col gap-1'>
            <h1 className='text-2xl font-semibold'>{t('Group health')}</h1>
            {groups.length > 0 && (
              <p className='text-muted-foreground text-sm'>
                {t('{{healthy}}/{{total}} groups are healthy', {
                  healthy,
                  total: groups.length,
                })}
              </p>
            )}
          </div>
          <div className='flex flex-col items-end gap-1'>
            <div className='flex items-center gap-2'>
              {groups.length > 0 && (
                <StatusBadge
                  label={anyDown ? t('Partial outage') : t('All healthy')}
                  variant={anyDown ? 'danger' : 'success'}
                  copyable={false}
                  showDot
                />
              )}
              <Button
                variant='outline'
                size='icon-sm'
                onClick={() => void query.refetch()}
                disabled={query.isFetching}
                aria-label={t('Refresh')}
              >
                <RefreshCw
                  className={query.isFetching ? 'animate-spin' : undefined}
                  aria-hidden='true'
                />
              </Button>
              <Select
                items={GROUP_HEALTH_REFRESH_OPTIONS.map((value) => ({
                  value: String(value),
                  label: `${value}s`,
                }))}
                value={String(refreshSeconds)}
                onValueChange={(value) => {
                  if (value !== null) changeRefresh(Number(value))
                }}
              >
                <SelectTrigger
                  className='h-8 w-20'
                  aria-label={t('Auto refresh interval')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {GROUP_HEALTH_REFRESH_OPTIONS.map((value) => (
                      <SelectItem key={value} value={String(value)}>
                        {`${value}s`}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <span className='text-muted-foreground w-9 text-right text-xs tabular-nums'>
                {query.dataUpdatedAt > 0 ? `${secondsLeft}s` : ''}
              </span>
            </div>
            {groups.length > 0 && (
              <span className='text-muted-foreground text-xs'>
                {t('Click a card to see details')}
              </span>
            )}
          </div>
        </div>

        {renderBody()}
      </PageTransition>

      <GroupHealthDetailDialog
        groupName={detailGroup}
        onOpenChange={(open) => {
          if (!open) setDetailGroup(null)
        }}
      />
    </PublicLayout>
  )
}
