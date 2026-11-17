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
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AnnouncementsContent,
  BulletinsContent,
  NoticeContent,
  type NotificationAnnouncement,
} from '@/features/bulletins/components/notification-content'
import {
  useBulletins,
  useMarkBulletinsRead,
} from '@/features/bulletins/hooks/use-bulletins'
import type { Bulletin } from '@/features/bulletins/types'
import type { NotificationTab } from '@/hooks/use-notifications'
import { cn } from '@/lib/utils'
import { useBulletinSessionStore } from '@/stores/bulletin-store'

interface NotificationPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  unreadCount: number
  activeTab: NotificationTab
  onTabChange: (tab: NotificationTab) => void
  notice: string
  announcements: NotificationAnnouncement[]
  loading: boolean
  className?: string
}

/**
 * Notification popover with Notice, Announcements and Timeline tabs
 */
export function NotificationPopover({
  open,
  onOpenChange,
  unreadCount,
  activeTab,
  onTabChange,
  notice,
  announcements,
  loading,
  className,
}: NotificationPopoverProps) {
  const { t } = useTranslation()
  const bulletinUnread = useBulletins().unreadCount
  const markBulletinsRead = useMarkBulletinsRead()
  const openBulletin = useBulletinSessionStore((state) => state.open)
  // The dialog opens over the page, so the popover closes first.
  const handleOpenBulletin = (item: Bulletin) => {
    markBulletinsRead([item.id])
    onOpenChange(false)
    openBulletin(item.id)
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant='ghost'
            size='icon'
            className={cn('relative size-9', className)}
            aria-label={t('Notifications')}
          />
        }
      >
        <Bell className='size-[1.2rem]' />
        {unreadCount > 0 ? (
          <Badge
            variant='destructive'
            className='absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center px-1 text-[10px] font-semibold tabular-nums'
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </Badge>
        ) : null}
      </PopoverTrigger>

      <PopoverContent
        align='end'
        sideOffset={8}
        className='w-[min(26rem,calc(100vw-1rem))] gap-3 p-3'
      >
        <PopoverHeader className='gap-1 px-1'>
          <PopoverTitle>{t('System Announcements')}</PopoverTitle>
          <p className='text-muted-foreground text-xs'>
            {t('Latest platform updates and notices')}
          </p>
        </PopoverHeader>

        <Tabs
          value={activeTab}
          onValueChange={onTabChange as (value: string) => void}
        >
          <TabsList className='grid w-full grid-cols-3'>
            <TabsTrigger value='notice' className='gap-1.5'>
              <Bell className='size-3.5' />
              {t('Notice')}
            </TabsTrigger>
            <TabsTrigger value='bulletins' className='gap-1.5'>
              <Newspaper className='size-3.5' />
              {t('Announcements')}
              {bulletinUnread > 0 && (
                <Badge
                  variant='destructive'
                  className='h-4 min-w-4 px-1 text-[10px] tabular-nums'
                >
                  {bulletinUnread > 99 ? '99+' : bulletinUnread}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value='announcements' className='gap-1.5'>
              <Megaphone className='size-3.5' />
              {t('Timeline')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value='notice' className='mt-2'>
            <NoticeContent notice={notice} loading={loading} />
          </TabsContent>

          <TabsContent value='bulletins' className='mt-2'>
            <BulletinsContent onOpen={handleOpenBulletin} />
          </TabsContent>

          <TabsContent value='announcements' className='mt-2'>
            <AnnouncementsContent
              announcements={announcements}
              loading={loading}
            />
          </TabsContent>
        </Tabs>

        <div className='flex justify-end'>
          <Button size='sm' onClick={() => onOpenChange(false)}>
            {t('Close')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
