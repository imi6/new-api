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
import { useTranslation } from 'react-i18next'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  formatLatency,
  formatUptimePct,
} from '@/features/performance-metrics/lib/format'
import { cn } from '@/lib/utils'

import {
  formatGroupHealthBarTime,
  GROUP_HEALTH_LATENCY_LABEL_KEYS,
  groupHealthBarClass,
} from '../lib/group-health'
import type { GroupHealthBar, GroupHealthRange } from '../types'

interface GroupHealthBarsProps {
  bars: GroupHealthBar[]
  range: GroupHealthRange
  className?: string
}

/**
 * One bar per hour, day, or week, oldest on the left. The model square's
 * uptime sparkline grades bars by success rate; here only a period with no
 * success at all is an outage, and a period without data is grey.
 */
export function GroupHealthBars(props: GroupHealthBarsProps) {
  const { t } = useTranslation()
  return (
    <div className={cn('flex flex-col gap-1', props.className)}>
      <div className='flex h-6 items-stretch gap-[3px]'>
        {props.bars.map((bar) => (
          <Tooltip key={bar.start}>
            <TooltipTrigger
              render={
                <div
                  className={cn(
                    'min-w-0 flex-1 rounded-full transition-opacity hover:opacity-75',
                    groupHealthBarClass(bar)
                  )}
                />
              }
            />
            <TooltipContent side='top' className='text-xs'>
              <div className='font-medium'>
                {formatGroupHealthBarTime(bar.start, props.range)}
              </div>
              {!bar.has_data && (
                <div className='text-muted-foreground'>{t('No data')}</div>
              )}
              {bar.has_data && (
                <div className='flex flex-col gap-0.5 tabular-nums'>
                  <span>
                    {t('Success rate: {{rate}}', {
                      rate: formatUptimePct(bar.success_rate),
                    })}
                  </span>
                  {bar.latency_source !== '' && (
                    <span>
                      {t(GROUP_HEALTH_LATENCY_LABEL_KEYS[bar.latency_source])}
                      {': '}
                      {formatLatency(bar.avg_latency_ms)}
                    </span>
                  )}
                  {bar.cache_hit_rate >= 0 && (
                    <span>
                      {t('Cache hit rate')}
                      {': '}
                      {formatUptimePct(bar.cache_hit_rate)}
                    </span>
                  )}
                </div>
              )}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className='text-muted-foreground flex justify-between text-[11px]'>
        <span>{t('Past')}</span>
        <span>{t('Now')}</span>
      </div>
    </div>
  )
}
