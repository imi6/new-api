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
import { useTranslation } from 'react-i18next'

import { ChannelTypeLogo } from '@/features/channels/components/channel-type-badge'
import { apiKeyPlatformLabel } from '@/features/keys/lib/api-key-group-platforms'
import { formatTimestampToDate } from '@/lib/format'

import { getMyPartnerSites } from '../api'
import { PARTNER_CONTACT_LABEL_KEYS } from '../types'

/** The signed-in user's own submissions. They are read only. */
export function PartnerMine() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['partner', 'mine'],
    queryFn: getMyPartnerSites,
  })
  const sites = query.data ?? []

  return (
    <section className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-baseline justify-between gap-2'>
        <h2 className='text-base font-semibold'>{t('My submissions')}</h2>
        <span className='text-muted-foreground text-xs'>
          {t('Submissions cannot be changed. To correct one, submit again.')}
        </span>
      </div>
      {!query.isLoading && sites.length === 0 && (
        <p className='text-muted-foreground bg-card rounded-2xl border px-4 py-6 text-center text-sm'>
          {t('No submissions yet')}
        </p>
      )}
      {sites.map((site) => (
        <article
          key={site.id}
          className='bg-card flex flex-col gap-3 rounded-2xl border p-4'
        >
          <header className='flex flex-wrap items-baseline justify-between gap-2'>
            <span className='font-medium break-all'>{site.site_name}</span>
            <span className='text-muted-foreground text-xs tabular-nums'>
              {formatTimestampToDate(site.created_at)}
            </span>
          </header>
          <dl className='text-muted-foreground grid gap-1 text-xs sm:grid-cols-2'>
            {site.site_url && (
              <div className='break-all'>
                <dt className='inline'>{t('Site address')}: </dt>
                <dd className='inline'>{site.site_url}</dd>
              </div>
            )}
            <div className='break-all'>
              <dt className='inline'>
                {t(PARTNER_CONTACT_LABEL_KEYS[site.contact_type])}:{' '}
              </dt>
              <dd className='inline'>{site.contact}</dd>
            </div>
          </dl>
          <ul className='flex flex-col gap-2'>
            {site.offers.map((offer) => (
              <li
                key={offer.id}
                className='flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm'
              >
                <ChannelTypeLogo type={offer.channel_type} size={16} />
                <span className='text-muted-foreground text-xs'>
                  {apiKeyPlatformLabel(String(offer.channel_type), t)}
                </span>
                <span className='font-medium break-all'>
                  {offer.group_name}
                </span>
                <span className='text-warning ms-auto font-semibold tabular-nums'>
                  {offer.ratio}x
                </span>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  )
}
