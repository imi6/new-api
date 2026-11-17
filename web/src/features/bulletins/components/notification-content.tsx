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
import { Bell, ChevronRight, Megaphone, Newspaper, Pin } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { RichContent } from '@/components/rich-content'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toIntlLocale } from '@/i18n/languages'
import { getAnnouncementColorClass } from '@/lib/colors'
import { formatTimestampRelative } from '@/lib/format'
import { formatDateTimeObject } from '@/lib/time'
import { cn } from '@/lib/utils'

import { useBulletins } from '../hooks/use-bulletins'
import type { Bulletin } from '../types'

export interface NotificationAnnouncement {
  id?: number | string
  type?: string
  content?: string
  extra?: string
  publishDate?: string | Date
}

interface ContentStateProps {
  loading: boolean
  error?: boolean
  onRetry?: () => void
  layout?: 'popover' | 'page'
}

/** 页面使用外层滚动，弹层保留独立且有限的阅读区域。 */
function NotificationContentFrame(props: {
  children: ReactNode
  layout?: 'popover' | 'page'
}) {
  if (props.layout === 'page') return <div>{props.children}</div>
  return (
    <ScrollArea className='h-[min(52vh,28rem)] pr-3'>
      {props.children}
    </ScrollArea>
  )
}

export function NoticeContent(props: ContentStateProps & { notice: string }) {
  const { t } = useTranslation()
  if (props.loading) return <LoadingState className='min-h-48' />
  if (props.error) {
    return (
      <ErrorState
        title={t('Failed to load announcements, please try again later')}
        onRetry={props.onRetry}
        className='min-h-48'
      />
    )
  }
  if (!props.notice) {
    return (
      <EmptyState
        icon={Bell}
        title={t('No announcements at this time')}
        className='min-h-48 border-0 p-4'
      />
    )
  }
  return (
    <NotificationContentFrame layout={props.layout}>
      <RichContent breaks content={props.notice} />
    </NotificationContentFrame>
  )
}

export function AnnouncementsContent(
  props: ContentStateProps & { announcements: NotificationAnnouncement[] }
) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const page = props.layout === 'page'
  if (props.loading) return <LoadingState className='min-h-48' />
  if (props.error) {
    return (
      <ErrorState
        title={t('Failed to load announcements, please try again later')}
        onRetry={props.onRetry}
        className='min-h-48'
      />
    )
  }
  if (props.announcements.length === 0) {
    return (
      <EmptyState
        icon={Megaphone}
        title={t('No system announcements')}
        className='min-h-48 border-0 p-4'
      />
    )
  }
  return (
    <NotificationContentFrame layout={props.layout}>
      <ol className={cn('flex flex-col', page && 'ml-2 border-l')}>
        {props.announcements.map((item, index) => {
          const key = item.id ?? JSON.stringify(item)
          const publishDate = item.publishDate
            ? new Date(item.publishDate)
            : null
          const validDate = publishDate && !Number.isNaN(publishDate.getTime())
          return (
            <li
              key={key}
              className={cn(
                'relative flex items-start gap-3 py-3',
                page && 'py-4 pl-6 sm:pl-8',
                !page && index > 0 && 'border-t'
              )}
            >
              <span
                className={cn(
                  'mt-1.5 inline-block size-2 shrink-0 rounded-full',
                  getAnnouncementColorClass(item.type),
                  page && 'ring-card absolute -left-[5px] ring-4'
                )}
                aria-hidden='true'
              />
              <div className='flex min-w-0 flex-1 flex-col gap-2'>
                {validDate && page && (
                  <time
                    dateTime={publishDate.toISOString()}
                    className='text-muted-foreground text-xs tabular-nums'
                  >
                    {formatDateTimeObject(publishDate)}
                  </time>
                )}
                <div className='text-sm break-words'>
                  <RichContent breaks content={item.content || ''} />
                </div>
                {item.extra && (
                  <div
                    className={cn(
                      'text-muted-foreground text-xs break-words',
                      page && 'text-sm'
                    )}
                  >
                    <RichContent breaks content={item.extra} />
                  </div>
                )}
                {validDate && !page && (
                  <time
                    dateTime={publishDate.toISOString()}
                    className='text-muted-foreground text-xs'
                  >
                    {formatTimestampRelative(
                      publishDate.getTime(),
                      'milliseconds',
                      locale
                    )}
                    {' · '}
                    {formatDateTimeObject(publishDate)}
                  </time>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </NotificationContentFrame>
  )
}

/** 保留服务端置顶顺序；列表展示不改变已读状态。 */
export function BulletinsContent(props: {
  onOpen: (item: Bulletin) => void
  layout?: 'popover' | 'page'
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const bulletins = useBulletins()
  const page = props.layout === 'page'
  if (bulletins.isLoading) return <LoadingState className='min-h-48' />
  if (bulletins.isError) {
    return (
      <ErrorState
        title={t('Failed to load announcements, please try again later')}
        onRetry={() => void bulletins.refetch()}
        className='min-h-48'
      />
    )
  }
  if (bulletins.items.length === 0) {
    return (
      <EmptyState
        icon={Newspaper}
        title={t('No announcements at this time')}
        className='min-h-48 border-0 p-4'
      />
    )
  }
  return (
    <NotificationContentFrame layout={props.layout}>
      <div className={cn('flex flex-col gap-1', page && 'gap-3')}>
        {bulletins.items.map((item) => (
          <Button
            key={item.id}
            type='button'
            variant='ghost'
            onClick={() => props.onOpen(item)}
            className={cn(
              'h-auto w-full items-start justify-start gap-3 px-2 py-2.5 text-left whitespace-normal',
              page && 'border-border/70 rounded-xl border px-4 py-4 sm:px-5'
            )}
          >
            <span
              className={cn(
                'mt-1.5 inline-block size-2 shrink-0 rounded-full',
                item.read ? 'bg-muted-foreground/30' : 'bg-primary'
              )}
              aria-hidden='true'
            />
            <span
              className={cn(
                'flex min-w-0 flex-1 flex-col gap-1',
                page && 'gap-2'
              )}
            >
              <span className='flex flex-wrap items-center gap-x-2 gap-y-1'>
                {item.pinned && (
                  <StatusBadge
                    icon={Pin}
                    label={t('Pinned')}
                    variant='warning'
                    copyable={false}
                    className='shrink-0'
                  />
                )}
                <span
                  className={cn(
                    'min-w-0 text-sm break-words',
                    !item.read && 'font-semibold',
                    page && 'text-base'
                  )}
                >
                  {item.title}
                </span>
              </span>
              {item.shown_at > 0 && (
                <span className='text-muted-foreground text-xs font-normal tabular-nums'>
                  {page
                    ? formatDateTimeObject(new Date(item.shown_at * 1000))
                    : formatTimestampRelative(item.shown_at, 'seconds', locale)}
                </span>
              )}
              {!item.read && <span className='sr-only'>{t('Unread')}</span>}
            </span>
            {page && (
              <ChevronRight
                className='text-muted-foreground mt-1 size-4 shrink-0'
                aria-hidden='true'
              />
            )}
          </Button>
        ))}
      </div>
    </NotificationContentFrame>
  )
}
