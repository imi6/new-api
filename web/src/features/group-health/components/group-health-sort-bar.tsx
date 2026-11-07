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
  DEFAULT_GROUP_HEALTH_SORT,
  GROUP_HEALTH_SORT_KEYS,
  GROUP_HEALTH_SORT_META,
  type GroupHealthSort,
  type GroupHealthSortDirection,
} from '../lib/group-health-sort'

// A box not in use shows this; choosing it in the box in use goes back to
// the default order.
const NONE = 'none'

interface GroupHealthSortBarProps {
  sort: GroupHealthSort
  onSortChange: (sort: GroupHealthSort) => void
  /** Without cache hit rates on the cards, that box is left out. */
  cacheHitRateShown: boolean
}

/**
 * One box per measure, each only choosing a direction. The cards follow
 * the box chosen last; the others show "—".
 */
export function GroupHealthSortBar(props: GroupHealthSortBarProps) {
  const { t } = useTranslation()
  const keys = GROUP_HEALTH_SORT_KEYS.filter(
    (key) => key !== 'cache' || props.cacheHitRateShown
  )

  return (
    <div className='grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end'>
      {keys.map((key) => {
        const meta = GROUP_HEALTH_SORT_META[key]
        const active = props.sort.key === key
        // The better direction comes first in each box.
        const directions: GroupHealthSortDirection[] =
          meta.better === 'asc' ? ['asc', 'desc'] : ['desc', 'asc']
        const directionLabel = (direction: GroupHealthSortDirection) =>
          t(direction === 'asc' ? meta.ascLabelKey : meta.descLabelKey)
        const items = [
          { value: NONE, label: '—' },
          ...directions.map((direction) => ({
            value: direction,
            label: directionLabel(direction),
          })),
        ]
        return (
          <div key={key} className='flex min-w-0 items-center gap-1.5'>
            <span
              className={cn(
                'shrink-0 text-xs',
                active ? 'text-foreground font-medium' : 'text-muted-foreground'
              )}
            >
              {t(meta.labelKey)}
            </span>
            <Select
              items={items}
              value={active ? props.sort.direction : NONE}
              onValueChange={(value) => {
                if (value === 'asc' || value === 'desc') {
                  props.onSortChange({ key, direction: value })
                } else if (value === NONE && active) {
                  props.onSortChange(DEFAULT_GROUP_HEALTH_SORT)
                }
              }}
            >
              <SelectTrigger
                className={cn(
                  'h-8 min-w-0 flex-1 sm:w-28 sm:flex-none',
                  active && 'border-primary text-primary'
                )}
                aria-label={t('Sort by {{field}}', { field: t(meta.labelKey) })}
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
