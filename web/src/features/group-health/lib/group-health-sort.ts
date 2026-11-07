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

// The order of the channel status cards. Every measure has a direction and
// they all count: the first decides the order and the rest separate the cards
// it ties on. Each measure reads the same number its card shows, and a card
// without that number goes last whichever way the measure points.

export type GroupHealthSortKey =
  | 'ratio'
  | 'success'
  | 'cache'
  | 'latency'
  | 'status'

export type GroupHealthSortDirection = 'asc' | 'desc'

export type GroupHealthSortRule = {
  key: GroupHealthSortKey
  direction: GroupHealthSortDirection
}

/**
 * Every measure with its direction, in the order they are applied: the first
 * decides the order and the next ones only separate cards the earlier ones
 * tie on.
 */
export type GroupHealthSortRules = GroupHealthSortRule[]

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

/** Every measure pointing its better way, cheapest groups first. */
export const DEFAULT_GROUP_HEALTH_SORT_RULES: GroupHealthSortRules =
  GROUP_HEALTH_SORT_KEYS.map((key) => ({
    key,
    direction: GROUP_HEALTH_SORT_META[key].better,
  }))

/**
 * Puts one measure first, with the direction just chosen for it, and leaves
 * the others in their order behind it. Choosing a measure therefore decides
 * the order without dropping what the other boxes say.
 */
export function promoteGroupHealthSort(
  rules: GroupHealthSortRules,
  key: GroupHealthSortKey,
  direction: GroupHealthSortDirection
): GroupHealthSortRules {
  return [{ key, direction }, ...rules.filter((rule) => rule.key !== key)]
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

/** Which of two cards comes first by one measure, or 0 when they tie. */
function compareBy(
  left: GroupHealthGroup,
  right: GroupHealthGroup,
  rule: GroupHealthSortRule
): number {
  const leftValue = sortValue(left, rule.key)
  const rightValue = sortValue(right, rule.key)
  if (leftValue === rightValue) return 0
  if (leftValue === null) return 1
  if (rightValue === null) return -1
  const sign = rule.direction === 'asc' ? 1 : -1
  return (leftValue - rightValue) * sign
}

/**
 * Sorts a copy of the groups by each measure in turn, moving on to the next
 * only where the earlier ones tie. Cards without a number go last by that
 * measure either way; cards every measure ties on keep the group name order,
 * so a refresh with the same numbers does not move the cards.
 */
export function sortGroupHealth(
  groups: GroupHealthGroup[],
  rules: GroupHealthSortRules
): GroupHealthGroup[] {
  return [...groups].sort((left, right) => {
    for (const rule of rules) {
      const order = compareBy(left, right, rule)
      if (order !== 0) return order
    }
    return left.name.localeCompare(right.name)
  })
}

const SORT_STORAGE_KEY = 'group-health-sort-rules'

/**
 * The last chosen order in this browser, with any measure it does not name
 * appended in its better direction, so every box always has a direction.
 */
export function readGroupHealthSortRules(): GroupHealthSortRules {
  const rules: GroupHealthSortRules = []
  try {
    const raw = window.localStorage.getItem(SORT_STORAGE_KEY)
    const saved: unknown = raw ? JSON.parse(raw) : null
    if (Array.isArray(saved)) {
      for (const entry of saved as Partial<GroupHealthSortRule>[]) {
        const key = entry?.key
        const direction = entry?.direction
        if (!key || !(key in GROUP_HEALTH_SORT_META)) continue
        if (direction !== 'asc' && direction !== 'desc') continue
        if (rules.some((rule) => rule.key === key)) continue
        rules.push({ key, direction })
      }
    }
  } catch {
    /* storage may be unavailable or hold something else */
  }
  for (const rule of DEFAULT_GROUP_HEALTH_SORT_RULES) {
    if (!rules.some((kept) => kept.key === rule.key)) rules.push(rule)
  }
  return rules
}

export function saveGroupHealthSortRules(rules: GroupHealthSortRules): void {
  try {
    window.localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(rules))
  } catch {
    /* storage may be unavailable */
  }
}
