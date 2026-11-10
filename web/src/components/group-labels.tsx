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
import {
  Award,
  BadgeCheck,
  Heart,
  Shield,
  Sparkles,
  Star,
  Zap,
} from 'lucide-react'

import type {
  GroupLabel,
  GroupLabelColor,
  GroupLabelIcon,
} from '@/lib/group-labels'
import { cn } from '@/lib/utils'

import { Badge } from './ui/badge'

const labelIcons = {
  shield: Shield,
  'badge-check': BadgeCheck,
  award: Award,
  sparkles: Sparkles,
  star: Star,
  zap: Zap,
  heart: Heart,
} satisfies Record<Exclude<GroupLabelIcon, 'none'>, typeof Shield>

const labelColors: Record<GroupLabelColor, string> = {
  teal: 'border-teal-700 bg-teal-700 text-white dark:border-teal-800 dark:bg-teal-800',
  amber:
    'border-amber-800 bg-amber-800 text-white dark:border-amber-800 dark:bg-amber-800',
  violet:
    'border-violet-700 bg-violet-700 text-white dark:border-violet-800 dark:bg-violet-800',
  blue: 'border-blue-700 bg-blue-700 text-white dark:border-blue-800 dark:bg-blue-800',
  green:
    'border-green-700 bg-green-700 text-white dark:border-green-800 dark:bg-green-800',
  red: 'border-red-700 bg-red-700 text-white dark:border-red-800 dark:bg-red-800',
  slate:
    'border-slate-600 bg-slate-600 text-white dark:border-slate-700 dark:bg-slate-700',
}

export function GroupLabels(props: {
  labels?: readonly GroupLabel[]
  className?: string
  compact?: boolean
}) {
  if (!props.labels?.length) return null
  const visibleLabels = props.compact ? props.labels.slice(0, 1) : props.labels
  const hiddenLabels = props.compact ? props.labels.slice(1) : []
  return (
    <span
      className={cn(
        'inline-flex max-w-full min-w-0 flex-nowrap items-center gap-1 overflow-hidden',
        props.className
      )}
    >
      {visibleLabels.map((label) => {
        const Icon = label.icon === 'none' ? undefined : labelIcons[label.icon]
        return (
          <Badge
            key={label.id}
            variant='outline'
            className={cn(
              'h-4 max-w-full min-w-0 shrink gap-0.5 rounded px-1 py-0 text-[10px] leading-none font-medium shadow-none [&>svg]:size-2.5!',
              labelColors[label.color] ?? labelColors.slate
            )}
          >
            {Icon && <Icon aria-hidden='true' className='shrink-0' />}
            <span className='min-w-0 truncate' title={label.name}>
              {label.name}
            </span>
          </Badge>
        )
      })}
      {hiddenLabels.length > 0 && (
        <span
          className='shrink-0 text-[10px] leading-none tabular-nums'
          title={hiddenLabels.map((label) => label.name).join(', ')}
        >
          +{hiddenLabels.length}
        </span>
      )}
    </span>
  )
}
