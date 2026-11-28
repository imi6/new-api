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
import { CircleHelp } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { DialogClose } from '@/components/ui/dialog'
import type { AffiliateRebateSummary } from '@/features/wallet/api'
import { formatQuota } from '@/lib/format'

interface AffiliateRebateGuideProps {
  summary: Pick<
    AffiliateRebateSummary,
    'downstream_threshold' | 'upstream_minimum'
  > | null
}

export function AffiliateRebateGuide(props: AffiliateRebateGuideProps) {
  const { t } = useTranslation()

  return (
    <Dialog
      title={t('Rebate rules')}
      contentClassName='sm:max-w-xl'
      headerClassName='pr-8'
      bodyClassName='space-y-4 text-sm'
      trigger={
        <Button type='button' variant='outline' size='sm'>
          <CircleHelp className='size-3.5' aria-hidden='true' />
          {t('Rebate rules')}
        </Button>
      }
      footer={
        <DialogClose render={<Button type='button' />}>
          {t('Got it')}
        </DialogClose>
      }
    >
      <section className='space-y-1.5'>
        <h3 className='font-semibold'>{t('How invitations work')}</h3>
        <p className='text-muted-foreground'>
          {t(
            'Share your invite link or code. When a friend uses it to register a new account, they appear in your invitee list.'
          )}
        </p>
      </section>

      <section className='space-y-1.5'>
        <h3 className='font-semibold'>{t('Why usage may earn no rebate')}</h3>
        <ul className='text-muted-foreground list-disc space-y-1.5 ps-5'>
          <li>
            {t(
              'Only the paid portion of settled usage earns rebates. Gift credit is used first, and subscription usage does not count.'
            )}
          </li>
          <li>
            {t(
              'The invitee must meet the cumulative paid-usage threshold. Check the eligible groups on this page for the group that was actually billed.'
            )}
          </li>
          <li>
            {t(
              'Rebates may also be unavailable when the program is paused or your account is excluded by the special pricing rule.'
            )}
          </li>
        </ul>
        {props.summary && (
          <dl className='bg-muted/60 flex flex-wrap justify-between gap-x-3 gap-y-1 rounded-md px-3 py-2'>
            <dt>{t('Invitee paid-usage threshold')}</dt>
            <dd className='font-semibold tabular-nums'>
              {formatQuota(props.summary.downstream_threshold)}
            </dd>
          </dl>
        )}
      </section>

      <section className='space-y-1.5'>
        <h3 className='font-semibold'>{t('Claiming your rebate')}</h3>
        <p className='text-muted-foreground'>
          {t(
            'Earned rebates appear under Unclaimed rebate. You can transfer them to platform balance or convert them to withdrawable U when available.'
          )}
        </p>
        <p className='text-muted-foreground'>
          {t(
            'Claiming requires your own paid usage to meet the threshold and is subject to the 7-day claim limit.'
          )}
        </p>
        {props.summary && (
          <dl className='bg-muted/60 flex flex-wrap justify-between gap-x-3 gap-y-1 rounded-md px-3 py-2'>
            <dt>{t('Your paid-usage threshold to claim')}</dt>
            <dd className='font-semibold tabular-nums'>
              {formatQuota(props.summary.upstream_minimum)}
            </dd>
          </dl>
        )}
      </section>
    </Dialog>
  )
}
