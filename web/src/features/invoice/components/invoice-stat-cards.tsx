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
import { CircleCheck, Hourglass, Receipt } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatCard } from '@/features/dashboard/components/ui/stat-card'

import type { InvoiceSummary } from '../types'

interface InvoiceStatCardsProps {
  summary?: InvoiceSummary
  loading: boolean
  error: boolean
}

export function InvoiceStatCards(props: InvoiceStatCardsProps) {
  const { t } = useTranslation()
  const cards = [
    {
      key: 'available',
      title: t('Invoiceable amount'),
      icon: Receipt,
      tone: 'accent-1' as const,
      card: props.summary?.available,
    },
    {
      key: 'processing',
      title: t('Processing amount'),
      icon: Hourglass,
      tone: 'accent-2' as const,
      card: props.summary?.processing,
    },
    {
      key: 'issued',
      title: t('Invoiced amount'),
      icon: CircleCheck,
      tone: 'accent-3' as const,
      card: props.summary?.issued,
    },
  ]

  return (
    <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
      {cards.map((item) => (
        <div
          key={item.key}
          className='bg-card rounded-xl border px-3 py-2.5 sm:p-4'
        >
          <StatCard
            title={item.title}
            value={`¥${item.card?.amount ?? '0.00'}`}
            description={t('{{count}} records', {
              count: item.card?.count ?? 0,
            })}
            icon={item.icon}
            tone={item.tone}
            loading={props.loading}
            error={props.error}
            details={[]}
          />
        </div>
      ))}
    </div>
  )
}
