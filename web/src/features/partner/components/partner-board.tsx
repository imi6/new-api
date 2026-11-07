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
import { useQuery } from '@tanstack/react-query'
import { FileText, Handshake, MessagesSquare, Scale } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuthStore } from '@/stores/auth-store'

import { getPartnerConfig } from '../api'
import { PartnerForm } from './partner-form'
import { PartnerMine } from './partner-mine'

const STEPS = [
  {
    icon: FileText,
    titleKey: 'Submit a quote',
    descKey: 'Fill in your site and the ratio of each group you can supply.',
  },
  {
    icon: Scale,
    titleKey: 'Price comparison',
    descKey: 'The platform compares the quotes of all sites.',
  },
  {
    icon: MessagesSquare,
    titleKey: 'Get in touch',
    descKey: 'If it is a fit, an administrator contacts you.',
  },
] as const

/** The intro card, the form and, when signed in, the user's submissions. */
export function PartnerBoard() {
  const { t } = useTranslation()
  const signedIn = Boolean(useAuthStore((state) => state.auth.user))
  const config = useQuery({
    queryKey: ['partner', 'config'],
    queryFn: getPartnerConfig,
  })

  return (
    <div className='flex flex-col gap-6'>
      <div className='bg-card grid overflow-hidden rounded-2xl border md:grid-cols-2'>
        <div className='flex flex-col gap-3 p-6'>
          <span className='bg-primary/10 text-primary flex size-10 items-center justify-center rounded-xl'>
            <Handshake className='size-5' aria-hidden='true' />
          </span>
          <h2 className='text-xl font-semibold'>
            {t('Supply your upstream, start working with us')}
          </h2>
          <p className='text-muted-foreground text-sm whitespace-pre-line'>
            {config.data?.intro ||
              t(
                'Tell us your site, the groups you can supply and the ratio of each. No API key is needed.'
              )}
          </p>
        </div>
        <ol className='bg-muted/30 flex flex-col divide-y border-t md:border-t-0 md:border-l'>
          {STEPS.map((step) => (
            <li key={step.titleKey} className='flex items-start gap-3 p-4'>
              <span className='bg-background flex size-8 shrink-0 items-center justify-center rounded-lg border'>
                <step.icon className='size-4' aria-hidden='true' />
              </span>
              <span className='flex flex-col gap-0.5'>
                <span className='text-sm font-medium'>{t(step.titleKey)}</span>
                <span className='text-muted-foreground text-xs'>
                  {t(step.descKey)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className='bg-card rounded-2xl border p-4 sm:p-6'>
        {config.isLoading && <Skeleton className='h-96 w-full' />}
        {config.isError && (
          <EmptyState
            icon={Handshake}
            title={t('Supplier applications are closed')}
            description={t('Try again later.')}
            className='min-h-[240px]'
          />
        )}
        {config.data && (
          <PartnerForm
            maxOffers={config.data.max_offers_per_site}
            signedIn={signedIn}
          />
        )}
      </div>

      {signedIn && <PartnerMine />}
    </div>
  )
}
