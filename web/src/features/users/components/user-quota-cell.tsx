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

import { QuotaDetailsPopover } from '@/components/quota-details-popover'
import { StatusBadge } from '@/components/status-badge'
import { formatQuotaWithCurrency, getCurrencyDisplay } from '@/lib/currency'
import { cn } from '@/lib/utils'
import { useSystemConfigStore } from '@/stores/system-config-store'

type UserQuotaCellProps = {
  remaining: number
  used: number
  title?: string
  remainingLabel?: string
  usedLabel?: string
  popoverUsedLabel?: string
  emptyLabel?: string
}

export function UserQuotaCell(props: UserQuotaCellProps) {
  const { t } = useTranslation()
  useSystemConfigStore((state) => state.config.currency)

  const { meta: currency } = getCurrencyDisplay()
  const quotaUnit = currency.kind === 'tokens' ? t('Tokens') : currency.symbol
  const title = props.title ?? t('Quota')
  const remainingLabel = props.remainingLabel ?? t('Available Balance')
  const usedLabel = props.usedLabel ?? t('Used amount')
  const popoverUsedLabel = props.popoverUsedLabel ?? t('Total Used')
  const emptyLabel = props.emptyLabel ?? t('No Quota')
  const hasQuota = props.remaining !== 0 || props.used !== 0
  const formattedRemaining = formatQuotaWithCurrency(props.remaining, {
    showSymbol: false,
  })
  const formattedUsed = formatQuotaWithCurrency(props.used, {
    showSymbol: false,
  })

  return (
    <QuotaDetailsPopover
      title={`${title} (${quotaUnit})`}
      triggerLabel={
        hasQuota
          ? `${remainingLabel} ${formattedRemaining}; ${usedLabel} ${formattedUsed}`
          : emptyLabel
      }
      details={[
        { label: remainingLabel, value: formattedRemaining },
        { label: popoverUsedLabel, value: formattedUsed },
      ]}
    >
      {hasQuota ? (
        <span className='grid min-w-0 grid-cols-1 gap-y-1 text-sm tabular-nums'>
          <span
            className={cn(
              props.remaining < 0 && 'text-destructive',
              props.remaining === 0 && 'text-muted-foreground'
            )}
          >
            {formattedRemaining}
          </span>
          <span
            data-table-text='secondary'
            className='text-muted-foreground flex items-baseline gap-1 text-xs font-normal'
          >
            <span>{usedLabel}</span>
            <span>{formattedUsed}</span>
          </span>
        </span>
      ) : (
        <StatusBadge
          label={emptyLabel}
          variant='neutral'
          copyable={false}
          className='-ml-1.5 font-normal'
        />
      )}
    </QuotaDetailsPopover>
  )
}
