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
import { MessageCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PublicLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { RichContent } from '@/components/rich-content'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { useIsSidebarModuleVisible } from '@/hooks/use-sidebar-config'

import { getContactContent } from './api'

export function Contact() {
  const { t } = useTranslation()
  const supportEnabled = useIsSidebarModuleVisible('/support-tickets')
  const query = useQuery({
    queryKey: ['contact-content'],
    queryFn: ({ signal }) => getContactContent(signal),
    staleTime: 0,
    meta: { errorToast: false, errorRedirect: false },
  })
  const contactContent = query.data?.trim() ?? ''

  let content = (
    <EmptyState
      icon={MessageCircle}
      title={t('Contact information is not available yet')}
      action={
        supportEnabled ? (
          <Button render={<Link to='/support-tickets' />}>
            {t('My support tickets')}
          </Button>
        ) : undefined
      }
    />
  )
  if (query.isLoading) {
    content = <LoadingState className='min-h-72' />
  } else if (query.isError) {
    content = (
      <ErrorState
        title={t('Failed to load contact information')}
        onRetry={() => void query.refetch()}
      />
    )
  } else if (contactContent) {
    content = <RichContent breaks content={contactContent} />
  }

  return (
    <PublicLayout>
      <div className='mx-auto flex w-full max-w-4xl flex-col gap-6 py-6 sm:py-10'>
        <div className='flex items-center gap-3'>
          <IconBadge tone='info' size='title'>
            <MessageCircle aria-hidden='true' />
          </IconBadge>
          <div className='min-w-0 space-y-1'>
            <h1 className='text-2xl font-semibold tracking-tight'>
              {t('Contact Us')}
            </h1>
            <p className='text-muted-foreground text-sm'>
              {t('Get in touch with us')}
            </p>
          </div>
        </div>
        <Card data-card-hover='false' className='min-h-80 py-6 sm:py-8'>
          <CardContent className='min-w-0 sm:px-8'>{content}</CardContent>
        </Card>
      </div>
    </PublicLayout>
  )
}
