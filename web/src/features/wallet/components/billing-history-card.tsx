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

import { TitledCard } from '@/components/ui/titled-card'

import { BillingHistoryContent } from './billing-history-content'

interface BillingHistoryCardProps {
  paymentMethods?: string[]
  refreshKey?: number
}

export function BillingHistoryCard(props: BillingHistoryCardProps) {
  const { t } = useTranslation()
  return (
    <TitledCard
      title={t('Billing history')}
      description={t('View your topup transaction records and payment history')}
      icon={<Receipt className='size-4' />}
      iconTone='info'
      disableHoverEffect
      className='min-w-0'
    >
      <BillingHistoryContent
        paymentMethods={props.paymentMethods}
        refreshKey={props.refreshKey}
      />
    </TitledCard>
  )
}
