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
import type { StatusVariant } from '@/components/status-badge'
import dayjs from '@/lib/dayjs'

import type {
  GroupHealthBar,
  GroupHealthLatencySource,
  GroupHealthRange,
  GroupHealthStatus,
} from '../types'

export const GROUP_HEALTH_STATUS_META: Record<
  GroupHealthStatus,
  { labelKey: string; variant: StatusVariant }
> = {
  ok: { labelKey: 'Healthy', variant: 'success' },
  down: { labelKey: 'Abnormal', variant: 'danger' },
  unknown: { labelKey: 'No data', variant: 'neutral' },
}

export const GROUP_HEALTH_RANGE_LABEL_KEYS: Record<GroupHealthRange, string> = {
  hour: 'Last 24 hours',
  day: 'Last 30 days',
  week: 'Last 12 weeks',
}

export const GROUP_HEALTH_LATENCY_LABEL_KEYS: Record<
  Exclude<GroupHealthLatencySource, ''>,
  string
> = {
  ttft: 'Time to first token',
  probe: 'Check latency',
}

/** Auto refresh choices in seconds. The server refreshes every 60 seconds. */
export const GROUP_HEALTH_REFRESH_OPTIONS = [60, 120, 300] as const

/**
 * A bar is green when anything succeeded, red when everything failed, and
 * grey without data. A low success rate alone is not an outage.
 */
export function groupHealthBarClass(bar: GroupHealthBar): string {
  if (!bar.has_data) return 'bg-muted'
  return bar.success_rate > 0 ? 'bg-success' : 'bg-destructive'
}

/** The time a bar covers, as shown in its tooltip. */
export function formatGroupHealthBarTime(
  start: number,
  range: GroupHealthRange
): string {
  const time = dayjs(start * 1000)
  if (range === 'hour') {
    return `${time.format('MM-DD HH:00')} – ${time.add(1, 'hour').format('HH:00')}`
  }
  if (range === 'week') {
    return `${time.format('YYYY-MM-DD')} – ${time.add(6, 'day').format('MM-DD')}`
  }
  return time.format('YYYY-MM-DD')
}
