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
import type { GroupHealthGroup } from '../types'

// The order of the channel status cards. One measure at a time, by the same
// number its card shows; a card without that number always goes last.

export type GroupHealthSortKey =
  | 'ratio'
  | 'success'
  | 'cache'
  | 'latency'
  | 'status'

export type GroupHealthSortDirection = 'asc' | 'desc'

export type GroupHealthSort = {
  key: GroupHealthSortKey
  direction: GroupHealthSortDirection
}

/** Each measure's name, its better direction, and the words of each way. */
export const GROUP_HEALTH_SORT_META: Record<
  GroupHealthSortKey,
  {
    labelKey: string
    better: GroupHealthSortDirection
    ascLabelKey: string
    descLabelKey: string
  }
> = {
  ratio: {
    labelKey: 'Ratio',
    better: 'asc',
    ascLabelKey: 'Low to high',
    descLabelKey: 'High to low',
  },
  success: {
    labelKey: 'Success rate',
    better: 'desc',
    ascLabelKey: 'Low to high',
    descLabelKey: 'High to low',
  },
  cache: {
    labelKey: 'Cache hit rate',
    better: 'desc',
    ascLabelKey: 'Low to high',
    descLabelKey: 'High to low',
  },
  latency: {
    labelKey: 'Avg latency',
    better: 'asc',
    ascLabelKey: 'Low to high',
    descLabelKey: 'High to low',
  },
  // Healthy is 0 and an outage 1, so ascending puts healthy groups first.
  status: {
    labelKey: 'Status',
    better: 'asc',
    ascLabelKey: 'Healthy first',
    descLabelKey: 'Outages first',
  },
}

export const GROUP_HEALTH_SORT_KEYS = Object.keys(
  GROUP_HEALTH_SORT_META
) as GroupHealthSortKey[]

export const DEFAULT_GROUP_HEALTH_SORT: GroupHealthSort = {
  key: 'ratio',
  direction: 'asc',
}

/** The number a card shows for the measure, or null when it shows "—". */
function sortValue(
  group: GroupHealthGroup,
  key: GroupHealthSortKey
): number | null {
  switch (key) {
    case 'ratio':
      return Number.isFinite(group.group_ratio) ? group.group_ratio : null
    case 'success':
      return group.total.has_data ? group.total.success_rate : null
    case 'cache':
      return group.cache_hit_rate >= 0 ? group.cache_hit_rate : null
    case 'latency':
      return group.total.avg_latency_ms > 0 ? group.total.avg_latency_ms : null
    case 'status':
      if (group.status === 'ok') return 0
      return group.status === 'down' ? 1 : null
  }
}

/**
 * Sorts a copy of the groups. Cards without the number go last either way;
 * equal numbers keep the group name order, so a refresh with the same
 * numbers does not move the cards.
 */
export function sortGroupHealth(
  groups: GroupHealthGroup[],
  sort: GroupHealthSort
): GroupHealthGroup[] {
  const sign = sort.direction === 'asc' ? 1 : -1
  return groups
    .map((group) => ({ group, value: sortValue(group, sort.key) }))
    .sort((left, right) => {
      if (left.value !== right.value) {
        if (left.value === null) return 1
        if (right.value === null) return -1
        return (left.value - right.value) * sign
      }
      return left.group.name.localeCompare(right.group.name)
    })
    .map((entry) => entry.group)
}

const SORT_STORAGE_KEY = 'group-health-sort'

/** The last chosen order in this browser, or the default. */
export function readGroupHealthSort(): GroupHealthSort {
  try {
    const raw = window.localStorage.getItem(SORT_STORAGE_KEY)
    const saved = raw ? (JSON.parse(raw) as Partial<GroupHealthSort>) : null
    if (
      saved &&
      saved.key &&
      saved.key in GROUP_HEALTH_SORT_META &&
      (saved.direction === 'asc' || saved.direction === 'desc')
    ) {
      return { key: saved.key, direction: saved.direction }
    }
  } catch {
    /* storage may be unavailable or hold something else */
  }
  return DEFAULT_GROUP_HEALTH_SORT
}

export function saveGroupHealthSort(sort: GroupHealthSort): void {
  try {
    window.localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort))
  } catch {
    /* storage may be unavailable */
  }
}
