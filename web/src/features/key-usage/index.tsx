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
import { Link } from '@tanstack/react-router'
import { ArrowLeft, KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PublicLayout, SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { IconBadge } from '@/components/ui/icon-badge'

import {
  getPublicKeyUsageSettings,
  isKeyUsageSecureOrigin,
  PUBLIC_KEY_USAGE_SETTINGS_QUERY_KEY,
} from './api'
import { KeyUsageLookup } from './components/key-usage-lookup'

export function PublicKeyUsagePage() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: PUBLIC_KEY_USAGE_SETTINGS_QUERY_KEY,
    queryFn: ({ signal }) => getPublicKeyUsageSettings(signal),
    staleTime: 0,
    meta: { errorToast: false, errorRedirect: false },
  })

  let content = <LoadingState />
  if (query.isError) {
    content = (
      <ErrorState
        title={t('Failed to query API key usage')}
        onRetry={() => void query.refetch()}
      />
    )
  } else if (query.data && !query.data.enabled) {
    content = (
      <EmptyState title={t('Public API key usage lookup is disabled')} />
    )
  } else if (query.data && !isKeyUsageSecureOrigin()) {
    content = <EmptyState title={t('API key lookup requires HTTPS')} />
  } else if (query.data?.enabled) {
    content = <KeyUsageLookup />
  }

  return (
    <PublicLayout>
      <div className='mx-auto w-full max-w-6xl space-y-5 py-4 sm:py-8'>
        <div className='flex items-center gap-3'>
          <IconBadge tone='info' size='title'>
            <KeyRound aria-hidden='true' />
          </IconBadge>
          <h1 className='text-2xl font-semibold tracking-tight'>
            {t('Usage lookup')}
          </h1>
        </div>
        {content}
      </div>
    </PublicLayout>
  )
}

export function OwnerKeyUsagePage(props: { keyId: string }) {
  const { t } = useTranslation()
  return (
    <SectionPageLayout stackActionsOnMobile>
      <SectionPageLayout.Title>{t('Usage lookup')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button variant='outline' size='sm' render={<Link to='/keys' />}>
          <ArrowLeft aria-hidden='true' />
          {t('API Keys')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='mx-auto w-full max-w-7xl'>
          <KeyUsageLookup key={props.keyId} keyId={props.keyId} />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
