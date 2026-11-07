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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

import {
  GROUP_HEALTH_SORT_KEYS,
  GROUP_HEALTH_SORT_META,
  type GroupHealthSortDirection,
  type GroupHealthSortKey,
  type GroupHealthSortRules,
} from '../lib/group-health-sort'

interface GroupHealthSortBarProps {
  /** Every measure with its direction, the first one deciding the order. */
  rules: GroupHealthSortRules
  /** Puts this measure first, with this direction. */
  onPromote: (
    key: GroupHealthSortKey,
    direction: GroupHealthSortDirection
  ) => void
}

/**
 * One box per measure, each only choosing a direction. The number before a
 * box says where it comes in the order: the cards follow box 1, and the rest
 * separate the cards it ties on. Choosing a direction, or clicking the name,
 * moves that box to the front without clearing the others.
 */
export function GroupHealthSortBar(props: GroupHealthSortBarProps) {
  const { t } = useTranslation()
  // The boxes stay in a fixed order so they do not jump as the order changes.
  const keys = GROUP_HEALTH_SORT_KEYS.filter((key) =>
    props.rules.some((rule) => rule.key === key)
  )

  return (
    <div className='grid w-full grid-cols-2 gap-x-3 gap-y-2 sm:ml-auto sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end'>
      {keys.map((key) => {
        const meta = GROUP_HEALTH_SORT_META[key]
        const order = props.rules.findIndex((rule) => rule.key === key)
        const direction = props.rules[order].direction
        const primary = order === 0
        const label = t(meta.labelKey)
        // The better direction comes first in each box.
        const directions: GroupHealthSortDirection[] =
          meta.better === 'asc' ? ['asc', 'desc'] : ['desc', 'asc']
        const items = directions.map((value) => ({
          value,
          label: t(value === 'asc' ? meta.ascLabelKey : meta.descLabelKey),
        }))
        return (
          <div key={key} className='flex min-w-0 items-center gap-1.5'>
            <button
              type='button'
              onClick={() => props.onPromote(key, direction)}
              aria-label={t('Sort by {{field}} first', { field: label })}
              aria-pressed={primary}
              className={cn(
                'flex shrink-0 cursor-pointer items-center gap-1 text-xs',
                primary
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <span
                className={cn(
                  'tabular-nums',
                  primary ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                {order + 1}
              </span>
              {label}
            </button>
            <Select
              items={items}
              value={direction}
              onValueChange={(value) => {
                if (value === 'asc' || value === 'desc') {
                  props.onPromote(key, value)
                }
              }}
            >
              <SelectTrigger
                className={cn(
                  'h-8 min-w-0 flex-1 sm:w-28 sm:flex-none',
                  primary && 'border-primary text-primary'
                )}
                aria-label={t('Sort by {{field}}', { field: label })}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {items.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        )
      })}
    </div>
  )
}
