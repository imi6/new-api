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

import { Dialog } from '@/components/dialog'
import { StatusBadge } from '@/components/status-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  formatLatency,
  formatUptimePct,
} from '@/features/performance-metrics/lib/format'

import { useGroupHealth } from '../hooks/use-group-health'
import {
  formatGroupHealthBarTime,
  GROUP_HEALTH_LATENCY_LABEL_KEYS,
  GROUP_HEALTH_RANGE_LABEL_KEYS,
  GROUP_HEALTH_STATUS_META,
} from '../lib/group-health'
import type { GroupHealthRange } from '../types'
import { GroupHealthBars } from './group-health-bars'

const RANGES: GroupHealthRange[] = ['hour', 'day', 'week']

interface GroupHealthDetailDialogProps {
  groupName: string | null
  onOpenChange: (open: boolean) => void
}

export function GroupHealthDetailDialog(props: GroupHealthDetailDialogProps) {
  const { t } = useTranslation()
  const [range, setRange] = useState<GroupHealthRange>('hour')
  const query = useGroupHealth(range, props.groupName !== null)
  const group = query.data?.groups.find((item) => item.name === props.groupName)
  const rows = (group?.bars ?? []).filter((bar) => bar.has_data).reverse()

  return (
    <Dialog
      open={props.groupName !== null}
      onOpenChange={(open) => {
        if (!open) setRange('hour')
        props.onOpenChange(open)
      }}
      title={
        <span className='flex min-w-0 items-center gap-2'>
          <span className='truncate'>{props.groupName}</span>
          {group && (
            <StatusBadge
              label={t(GROUP_HEALTH_STATUS_META[group.status].labelKey)}
              variant={GROUP_HEALTH_STATUS_META[group.status].variant}
              copyable={false}
              showDot
              size='sm'
            />
          )}
        </span>
      }
      description={group?.desc ? t(group.desc) : undefined}
      contentClassName='sm:max-w-2xl'
    >
      <div className='flex flex-col gap-4'>
        <ToggleGroup
          value={[range]}
          onValueChange={(values) => {
            const next = values.find((value) => value !== range)
            if (next) setRange(next as GroupHealthRange)
          }}
          aria-label={t('Time range')}
          variant='outline'
          size='sm'
          spacing={2}
        >
          {RANGES.map((value) => (
            <ToggleGroupItem key={value} value={value}>
              {t(GROUP_HEALTH_RANGE_LABEL_KEYS[value])}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {query.isLoading && <Skeleton className='h-40 w-full' />}
        {!query.isLoading && group && (
          <>
            <GroupHealthBars bars={group.bars} range={range} />
            {rows.length === 0 && (
              <p className='text-muted-foreground py-6 text-center text-sm'>
                {t('No data in this period')}
              </p>
            )}
            {rows.length > 0 && (
              <div className='max-h-72 overflow-y-auto rounded-lg border'>
                <table className='w-full text-sm'>
                  <thead className='bg-muted/50 text-muted-foreground sticky top-0 text-xs'>
                    <tr>
                      <th className='px-3 py-2 text-left font-medium'>
                        {t('Period')}
                      </th>
                      <th className='px-3 py-2 text-right font-medium'>
                        {t('User requests')}
                      </th>
                      <th className='px-3 py-2 text-right font-medium'>
                        {t('Channel checks')}
                      </th>
                      <th className='px-3 py-2 text-right font-medium'>
                        {t('Success rate')}
                      </th>
                      <th className='px-3 py-2 text-right font-medium'>
                        {t('Avg latency')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className='divide-y tabular-nums'>
                    {rows.map((bar) => (
                      <tr key={bar.start}>
                        <td className='px-3 py-2 whitespace-nowrap'>
                          {formatGroupHealthBarTime(bar.start, range)}
                        </td>
                        <td className='px-3 py-2 text-right'>
                          {bar.real_requests}
                        </td>
                        <td className='px-3 py-2 text-right'>
                          {bar.probe_samples}
                        </td>
                        <td
                          className={
                            bar.success_rate > 0
                              ? 'text-success px-3 py-2 text-right'
                              : 'text-destructive px-3 py-2 text-right'
                          }
                        >
                          {formatUptimePct(bar.success_rate)}
                        </td>
                        <td className='px-3 py-2 text-right whitespace-nowrap'>
                          {formatLatency(bar.avg_latency_ms)}
                          {bar.latency_source !== '' && (
                            <span className='text-muted-foreground ml-1 text-xs'>
                              (
                              {t(
                                GROUP_HEALTH_LATENCY_LABEL_KEYS[
                                  bar.latency_source
                                ]
                              )}
                              )
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}
