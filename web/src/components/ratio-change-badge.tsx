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
import { ArrowDown, ArrowUp, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatTimestampToDate } from '@/lib/format'
import { cn } from '@/lib/utils'

/** A group ratio's recent change, as the server reports it. */
export type GroupRatioChange = {
  from: number
  to: number
  /** Unix seconds of the latest change, or when the group was added. */
  at: number
  /** The group was added recently; from is unset. */
  new?: boolean
}

/** Up to four decimals without trailing zeros: 0.0100 → "0.01". */
function trimRatio(value: number): string {
  return String(Number(value.toFixed(4)))
}

interface RatioChangeBadgeProps {
  change?: GroupRatioChange | null
  className?: string
  formatValue?: (value: number) => string
  tooltip?: string
}

/**
 * 标记近期倍率变动或新增分组：下降显示绿色，上涨显示红色。
 * 悬浮提示展示变动前后的倍率及日期。
 */
export function RatioChangeBadge(props: RatioChangeBadgeProps) {
  const { t } = useTranslation()
  const change = props.change
  if (!change) return null
  const formatValue = props.formatValue ?? trimRatio
  const date = formatTimestampToDate(change.at).slice(0, 10)

  let badge = (
    <StatusBadge
      label={t('New')}
      icon={Sparkles}
      variant='info'
      size='sm'
      copyable={false}
    />
  )
  let tooltip = t('New group, added on {{date}}', { date })
  if (!change.new) {
    const cheaper = change.to < change.from
    badge = (
      <StatusBadge
        label={formatValue(Math.abs(change.to - change.from))}
        icon={cheaper ? ArrowDown : ArrowUp}
        variant={cheaper ? 'success' : 'danger'}
        size='sm'
        copyable={false}
      />
    )
    tooltip = t('Ratio changed from {{from}}x to {{to}}x on {{date}}', {
      from: formatValue(change.from),
      to: formatValue(change.to),
      date,
    })
  }
  tooltip = props.tooltip ?? tooltip

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn('inline-flex shrink-0 tabular-nums', props.className)}
            aria-label={tooltip}
          />
        }
      >
        {badge}
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}
