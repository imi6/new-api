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
import { Receipt } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { StatusBadge } from '@/components/status-badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { formatTimestampToDate } from '@/lib/format'

import { ORDER_TYPE_LABEL_KEYS, orderKey } from '../lib/invoice'
import type { InvoiceOrder } from '../types'

interface InvoiceOrderListProps {
  orders: InvoiceOrder[]
  loading: boolean
  selected: ReadonlySet<string>
  maxOrders: number
  orderDays: number
  onToggle: (order: InvoiceOrder, checked: boolean) => void
  onToggleAll: (checked: boolean) => void
}

export function InvoiceOrderList(props: InvoiceOrderListProps) {
  const { t } = useTranslation()
  const selectableCount = Math.min(props.orders.length, props.maxOrders)
  const allSelected =
    selectableCount > 0 && props.selected.size >= selectableCount
  const someSelected = props.selected.size > 0 && !allSelected
  const atLimit = props.selected.size >= props.maxOrders

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Invoiceable orders')}</CardTitle>
        <CardDescription>
          {t(
            'Orders paid in the last {{days}} days. At most {{max}} orders per application.',
            { days: props.orderDays, max: props.maxOrders }
          )}
        </CardDescription>
        {props.orders.length > 0 && (
          <CardAction>
            <label className='flex cursor-pointer items-center gap-2 text-sm'>
              <Checkbox
                checked={allSelected}
                indeterminate={someSelected}
                onCheckedChange={(value) => props.onToggleAll(!!value)}
                aria-label={t('Select all')}
              />
              {t('Select all')}
            </label>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {props.loading && (
          <div className='flex flex-col gap-2'>
            <Skeleton className='h-14 rounded-lg' />
            <Skeleton className='h-14 rounded-lg' />
            <Skeleton className='h-14 rounded-lg' />
          </div>
        )}
        {!props.loading && props.orders.length === 0 && (
          <EmptyState
            icon={Receipt}
            title={t('No invoiceable orders')}
            description={t(
              'Paid Epay top-ups, Epay subscriptions, and redeemed codes appear here.'
            )}
            className='min-h-[200px]'
          />
        )}
        {!props.loading && props.orders.length > 0 && (
          <ul className='flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-1'>
            {props.orders.map((order) => {
              const key = orderKey(order)
              const checked = props.selected.has(key)
              const disabled = !checked && atLimit
              return (
                <li key={key}>
                  <label
                    className='hover:bg-muted/50 has-data-checked:border-primary/60 has-data-checked:bg-primary/5 flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 has-disabled:cursor-not-allowed has-disabled:opacity-60'
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={(value) =>
                        props.onToggle(order, !!value)
                      }
                      aria-label={order.trade_no}
                    />
                    <div className='flex min-w-0 flex-1 flex-col gap-1'>
                      <div className='flex flex-wrap items-center gap-2'>
                        <StatusBadge
                          label={t(ORDER_TYPE_LABEL_KEYS[order.order_type])}
                          variant='neutral'
                          copyable={false}
                          size='sm'
                        />
                        <span className='truncate font-mono text-xs'>
                          {order.trade_no}
                        </span>
                      </div>
                      <span className='text-muted-foreground text-xs'>
                        {formatTimestampToDate(order.order_time)}
                      </span>
                    </div>
                    <span className='shrink-0 font-semibold tabular-nums'>
                      ¥{order.amount}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
