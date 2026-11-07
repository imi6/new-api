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
 * One box per measure, carrying its name and the direction it points. The
 * cards follow the box used last, outlined here, and the others only separate
 * the cards it ties on. Picking in a box moves it to the front, so picking
 * the direction it already shows is how a measure is brought back in front.
 */
export function GroupHealthSortBar(props: GroupHealthSortBarProps) {
  const { t } = useTranslation()
  // The boxes stay in a fixed order so they do not jump as the order changes.
  const keys = GROUP_HEALTH_SORT_KEYS.filter((key) =>
    props.rules.some((rule) => rule.key === key)
  )

  return (
    <div className='flex min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:justify-end'>
      {keys.map((key) => {
        const meta = GROUP_HEALTH_SORT_META[key]
        const order = props.rules.findIndex((rule) => rule.key === key)
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
          <Select
            key={key}
            items={items}
            value={props.rules[order].direction}
            onValueChange={(value) => {
              if (value === 'asc' || value === 'desc') {
                props.onPromote(key, value)
              }
            }}
          >
            <SelectTrigger
              size='sm'
              className={cn(
                'gap-1 py-1 pr-1.5 pl-2 text-xs [&_svg]:size-3',
                primary && 'border-primary text-primary'
              )}
              aria-label={t('Sort by {{field}}', { field: label })}
            >
              <span className={primary ? undefined : 'text-muted-foreground'}>
                {label}
              </span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {items.map((item) => (
                  <SelectItem
                    key={item.value}
                    value={item.value}
                    className='text-xs'
                    // Also fires on the direction already shown, which is
                    // what moves this measure back in front of the others.
                    onClick={() => props.onPromote(key, item.value)}
                  >
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )
      })}
    </div>
  )
}
