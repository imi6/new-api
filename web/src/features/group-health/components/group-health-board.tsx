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
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ChannelTypeLogo } from '@/features/channels/components/channel-type-badge'
import {
  apiKeyGroupPlatform,
  apiKeyPlatformLabel,
  OTHER_PLATFORM,
  rankGroupPlatforms,
} from '@/features/keys/lib/api-key-group-platforms'

import { useGroupHealth } from '../hooks/use-group-health'
import {
  GROUP_HEALTH_RANGE_LABEL_KEYS,
  GROUP_HEALTH_REFRESH_OPTIONS,
} from '../lib/group-health'
import { GroupHealthCard } from './group-health-card'
import { GroupHealthDetailDialog } from './group-health-detail-dialog'
import { IntelligenceCheckDialog } from './intelligence-check-dialog'
import { RefreshCountdown } from './refresh-countdown'

const REFRESH_STORAGE_KEY = 'group-health-refresh-seconds'
const SKELETON_KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const ALL_PLATFORMS = 'all'

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

interface GroupHealthBoardProps {
  /** Page heading, shown on the public page; the console has its own. */
  title?: ReactNode
}

/** Summary, refresh controls, group cards and details, shared by both pages. */
export function GroupHealthBoard(props: GroupHealthBoardProps) {
  const { t } = useTranslation()
  const [refreshSeconds, setRefreshSeconds] = useState(readRefreshSeconds)
  const [detailGroup, setDetailGroup] = useState<string | null>(null)
  const [checkGroup, setCheckGroup] = useState<string | null>(null)
  const [platform, setPlatform] = useState(ALL_PLATFORMS)
  const query = useGroupHealth('hour')
  const data = query.data
  const allGroups = useMemo(() => data?.groups ?? [], [data?.groups])
  // The platform of each group, as its card resolves it, and how many groups
  // each platform has: other last, then the largest first.
  const platformOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const group of allGroups) {
      map.set(
        group.name,
        apiKeyGroupPlatform(
          group.name,
          group.platform ? { [group.name]: group.platform } : undefined
        )
      )
    }
    return map
  }, [allGroups])
  const platforms = useMemo(
    () => rankGroupPlatforms(platformOf.values(), t),
    [platformOf, t]
  )
  // A platform whose groups all left falls back to every platform.
  const activePlatform = platforms.some((entry) => entry[0] === platform)
    ? platform
    : ALL_PLATFORMS
  const groups =
    activePlatform === ALL_PLATFORMS
      ? allGroups
      : allGroups.filter((group) => platformOf.get(group.name) === platform)
  const anyDown = groups.some((group) => group.status === 'down')
  const rangeLabel = t(GROUP_HEALTH_RANGE_LABEL_KEYS.hour)

  const refetch = query.refetch
  const refresh = useCallback(() => void refetch(), [refetch])

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
          title={t('Unable to load channel status')}
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
            cacheHitRateMinutes={
              data.cache_hit_rate_enabled ? data.cache_hit_rate_minutes : null
            }
            onOpen={(item) => setDetailGroup(item.name)}
            onOpenIntelligenceCheck={(item) => setCheckGroup(item.name)}
          />
        ))}
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-4'>
      {/* Title and refresh on one row; the platforms below on their own. */}
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='flex flex-col gap-1'>
          {props.title}
          <p className='text-muted-foreground text-sm'>
            {t(
              'Only an overview of service health is shown. Site request counts, individual requests and internal channel details are not published.'
            )}
          </p>
        </div>
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
            onClick={refresh}
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
            <RefreshCountdown
              lastFetchedAt={Math.max(
                query.dataUpdatedAt,
                query.errorUpdatedAt
              )}
              intervalSeconds={refreshSeconds}
              fetching={query.isFetching}
              onRefresh={refresh}
            />
          </span>
        </div>
      </div>

      {platforms.length > 1 && (
        <ToggleGroup
          value={[activePlatform]}
          onValueChange={(values) => {
            const next = values.find((value) => value !== activePlatform)
            if (next) setPlatform(next)
          }}
          aria-label={t('Platform')}
          variant='outline'
          size='sm'
          spacing={2}
          className='w-full flex-wrap'
        >
          <ToggleGroupItem value={ALL_PLATFORMS}>
            {t('All platforms')}
            <span className='text-muted-foreground tabular-nums'>
              {allGroups.length}
            </span>
          </ToggleGroupItem>
          {platforms.map(([name, count]) => (
            <ToggleGroupItem key={name} value={name}>
              {name !== OTHER_PLATFORM && (
                <ChannelTypeLogo type={Number(name)} size={14} />
              )}
              {apiKeyPlatformLabel(name, t)}
              <span className='text-muted-foreground tabular-nums'>
                {count}
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}

      {renderBody()}

      <GroupHealthDetailDialog
        groupName={detailGroup}
        onOpenChange={(open) => {
          if (!open) setDetailGroup(null)
        }}
      />
      <IntelligenceCheckDialog
        group={checkGroup}
        onOpenChange={(open) => {
          if (!open) setCheckGroup(null)
        }}
      />
    </div>
  )
}
