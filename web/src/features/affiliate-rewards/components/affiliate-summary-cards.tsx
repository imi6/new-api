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
import { Coins, Gift, HandCoins, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { TitledCard } from '@/components/ui/titled-card'
import { StatCard } from '@/features/dashboard/components/ui/stat-card'
import { formatQuota } from '@/lib/format'

import type { AffiliateSummary } from '../types'

interface AffiliateSummaryCardsProps {
  summary?: AffiliateSummary
  loading: boolean
  error: boolean
}

/** Site totals: who invited, what it earned them, and what they took. */
export function AffiliateSummaryCards(props: AffiliateSummaryCardsProps) {
  const { t } = useTranslation()
  const summary = props.summary
  const cards = [
    {
      key: 'invites',
      title: t('Invited users'),
      value: String(summary?.invitees ?? 0),
      description: t('Invited by {{count}} users', {
        count: summary?.inviters ?? 0,
      }),
      icon: Users,
      tone: 'accent-1' as const,
    },
    {
      key: 'signup',
      title: t('Signup invite rewards'),
      value: formatQuota(summary?.signup_reward ?? 0),
      description: t('Given to inviters when invitees sign up'),
      icon: Gift,
      tone: 'accent-2' as const,
    },
    {
      key: 'accrued',
      title: t('Rebate earned'),
      value: formatQuota(summary?.accrued ?? 0),
      description: t('From invitee paid consumption'),
      icon: Coins,
      tone: 'accent-3' as const,
    },
    {
      key: 'claimed',
      title: t('Rebate claimed or deducted'),
      value: formatQuota(summary?.claimed ?? 0),
      description: t('{{count}} users claimed · {{unclaimed}} not claimed', {
        count: summary?.claimers ?? 0,
        unclaimed: formatQuota(summary?.unclaimed ?? 0),
      }),
      icon: HandCoins,
      tone: 'accent-1' as const,
    },
  ]

  // Two a row on phones, so the table below keeps room to scroll.
  return (
    <div className='flex shrink-0 flex-col gap-3'>
      <div className='grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4'>
        {cards.map((item) => (
          <div
            key={item.key}
            className='bg-card rounded-xl border px-3 py-2.5 sm:p-4'
          >
            <StatCard
              title={item.title}
              value={item.value}
              description={item.description}
              icon={item.icon}
              tone={item.tone}
              loading={props.loading}
              error={props.error}
              details={[]}
            />
          </div>
        ))}
      </div>
      {summary && (
        <TitledCard
          title={t('Rebate deduction breakdown')}
          disableHoverEffect
          headerClassName='border-b-0 px-3 pt-3 !pb-0 sm:px-4 sm:pt-3 sm:!pb-0'
          titleClassName='text-sm sm:text-sm'
          contentClassName='flex flex-col gap-2 px-3 pt-2 pb-3 sm:px-4 sm:pt-2 sm:pb-3'
        >
          <dl className='grid grid-cols-2 gap-2 xl:grid-cols-4'>
            {[
              {
                label: t('User transfers to platform'),
                amount: summary.user_platform_quota,
              },
              {
                label: t('Admin transfers to platform'),
                amount: summary.admin_platform_quota,
              },
              {
                label: t('Original rebate exchanged for U'),
                amount: summary.u_exchange_quota,
              },
              {
                label: t('Administrative rebate deductions'),
                amount: summary.admin_revoked_quota,
              },
            ].map((item) => (
              <div
                key={item.label}
                className='bg-muted/40 flex min-w-0 flex-col justify-between gap-1 rounded-lg px-3 py-2'
              >
                <dt className='text-muted-foreground text-xs leading-relaxed break-words'>
                  {item.label}
                </dt>
                <dd className='font-mono text-base font-semibold break-all tabular-nums sm:text-lg'>
                  {props.loading || props.error
                    ? '—'
                    : formatQuota(item.amount ?? 0)}
                </dd>
              </div>
            ))}
          </dl>
          <p className='text-muted-foreground text-xs leading-relaxed'>
            {t(
              'Rebate units and U are accounted separately. Historical opening adjustments are included in cumulative deductions, not actual payouts.'
            )}
          </p>
        </TitledCard>
      )}
    </div>
  )
}
