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
import { Bell, Megaphone, Newspaper } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AnnouncementsContent,
  BulletinsContent,
  NoticeContent,
} from '@/features/bulletins/components/notification-content'
import { useMarkBulletinsRead } from '@/features/bulletins/hooks/use-bulletins'
import type { Bulletin } from '@/features/bulletins/types'
import {
  useNotifications,
  type NotificationTab,
} from '@/hooks/use-notifications'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { useBulletinSessionStore } from '@/stores/bulletin-store'

export function SystemAnnouncements() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [activeTab, setActiveTab] = useState<NotificationTab>('notice')
  const notifications = useNotifications({ timelineLimit: 0 })
  const markBulletinsRead = useMarkBulletinsRead()
  const openBulletin = useBulletinSessionStore((state) => state.open)
  const {
    markNoticeAsRead,
    markAnnouncementsAsRead,
    noticeLoading,
    noticeError,
    timelineLoading,
    timelineError,
  } = notifications

  // 内容异步到达后，仅将当前可见栏目记为已读；公告仍需逐篇打开。
  useEffect(() => {
    if (activeTab === 'notice' && !noticeLoading && !noticeError) {
      markNoticeAsRead()
    }
    if (activeTab === 'announcements' && !timelineLoading && !timelineError) {
      markAnnouncementsAsRead()
    }
  }, [
    activeTab,
    noticeLoading,
    noticeError,
    timelineLoading,
    timelineError,
    markNoticeAsRead,
    markAnnouncementsAsRead,
  ])

  const handleOpenBulletin = (item: Bulletin) => {
    markBulletinsRead([item.id])
    openBulletin(item.id)
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('System Announcements')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='mx-auto w-full max-w-7xl space-y-5'>
          <p className='text-muted-foreground text-sm'>
            {t('Latest platform updates and notices')}
          </p>
          <Tabs
            value={activeTab}
            onValueChange={(value) => {
              if (
                value === 'notice' ||
                value === 'bulletins' ||
                value === 'announcements'
              ) {
                setActiveTab(value)
              }
            }}
            className='gap-4'
          >
            <TabsList
              aria-label={t('System Announcements')}
              className='grid h-10 w-full grid-cols-3 sm:max-w-md'
            >
              <TabsTrigger value='notice'>
                <Bell className='size-4' aria-hidden='true' />
                {t('Notice')}
              </TabsTrigger>
              <TabsTrigger value='bulletins'>
                <Newspaper className='size-4' aria-hidden='true' />
                {t('Announcements')}
                {notifications.unreadBulletinCount > 0 && (
                  <Badge
                    variant='destructive'
                    className='h-4 min-w-4 px-1 text-[10px] tabular-nums'
                  >
                    {formatNumber(notifications.unreadBulletinCount, locale)}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value='announcements'>
                <Megaphone className='size-4' aria-hidden='true' />
                {t('Timeline')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value='notice'>
              <Card className='min-h-72 py-5 sm:py-6'>
                <CardContent className='sm:px-6'>
                  <NoticeContent
                    notice={notifications.notice}
                    loading={noticeLoading}
                    error={Boolean(noticeError)}
                    onRetry={() => void notifications.refetchNotice()}
                    layout='page'
                  />
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value='bulletins'>
              <Card className='min-h-72 py-5 sm:py-6'>
                <CardContent className='sm:px-6'>
                  <BulletinsContent onOpen={handleOpenBulletin} layout='page' />
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value='announcements'>
              <Card className='min-h-72 py-5 sm:py-6'>
                <CardContent className='sm:px-6'>
                  <AnnouncementsContent
                    announcements={notifications.announcements}
                    loading={timelineLoading}
                    error={Boolean(timelineError)}
                    onRetry={() => void notifications.refetchTimeline()}
                    layout='page'
                  />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
