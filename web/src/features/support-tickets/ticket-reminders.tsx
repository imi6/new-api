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
import { useNavigate } from '@tanstack/react-router'
import { LifeBuoy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FloatingWindow } from '@/components/floating-window'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useMediaQuery } from '@/hooks/use-media-query'
import { toIntlLocale } from '@/i18n/languages'
import { formatDateTimeStr, formatNumber } from '@/lib/format'

import { ticketCategoryLabel } from './labels'
import { useTicketReminderStore } from './reminder-store'
import { TicketDetailDialog } from './ticket-detail-dialog'
import {
  ticketRemindersDenied,
  useTicketReminders,
} from './use-ticket-reminders'

export function TicketReminders(props: { userId: number; admin?: boolean }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const navigate = useNavigate()
  const mobile = useMediaQuery('(max-width: 639px)')
  const admin = props.admin ?? true
  const adminQuery = useTicketReminders(props.userId, true, admin)
  const ownerQuery = useTicketReminders(props.userId, false)
  const dismissedAdmin = useTicketReminderStore(
    (state) => state.dismissedByAccount[`${props.userId}:admin`] ?? 0
  )
  const dismissedOwner = useTicketReminderStore(
    (state) => state.dismissedByAccount[`${props.userId}:owner`] ?? 0
  )
  const openedDetail = useTicketReminderStore((state) => state.openedDetail)
  const [manuallyExpanded, setManuallyExpanded] = useState(false)
  const adminDenied = ticketRemindersDenied(adminQuery.error)
  const ownerDenied = ticketRemindersDenied(ownerQuery.error)
  const detail =
    openedDetail?.userId === props.userId &&
    (openedDetail.admin ? admin && !adminDenied : !ownerDenied)
      ? openedDetail
      : null
  const adminData = admin && !adminDenied ? adminQuery.data : undefined
  const ownerData = !ownerDenied ? ownerQuery.data : undefined
  const unreadCount =
    (adminData?.unread_count ?? 0) + (ownerData?.unread_count ?? 0)
  const items = [
    ...(adminData?.items ?? []).map((item) => ({ ...item, admin: true })),
    ...(ownerData?.items ?? []).map((item) => ({ ...item, admin: false })),
  ]
    .sort((left, right) => right.message_id - left.message_id)
    .slice(0, 5)
  const expanded =
    manuallyExpanded ||
    (!mobile &&
      (((adminData?.unread_count ?? 0) > 0 &&
        (adminData?.latest_message_id ?? 0) > dismissedAdmin) ||
        ((ownerData?.unread_count ?? 0) > 0 &&
          (ownerData?.latest_message_id ?? 0) > dismissedOwner)))
  const collapse = () => {
    useTicketReminderStore
      .getState()
      .dismiss(props.userId, adminData?.latest_message_id ?? 0, true)
    useTicketReminderStore
      .getState()
      .dismiss(props.userId, ownerData?.latest_message_id ?? 0, false)
    setManuallyExpanded(false)
  }
  useEffect(() => {
    if (unreadCount === 0) setManuallyExpanded(false)
  }, [unreadCount])
  useEffect(
    () => () => {
      useTicketReminderStore.getState().closeDetail(props.userId)
    },
    [props.userId]
  )
  const badge = (
    <Badge variant='destructive' className='h-5 min-w-5 px-1.5 tabular-nums'>
      {unreadCount > 99 ? '99+' : formatNumber(unreadCount, locale)}
    </Badge>
  )

  return (
    <>
      {unreadCount > 0 &&
        !detail &&
        (expanded ? (
          <FloatingWindow
            title={t('Ticket reminders')}
            badge={badge}
            defaultPosition={{
              x: Math.max(8, window.innerWidth - 364),
              y: Math.max(8, window.innerHeight - 500),
            }}
            defaultWidth={340}
            defaultHeight={Math.min(460, window.innerHeight - 32)}
            minWidth={Math.min(280, window.innerWidth - 16)}
            minHeight={200}
            storageKey={`support-ticket-reminders-${props.userId}`}
            collapsed={false}
            onCollapsedChange={(next) => {
              if (next) collapse()
            }}
            onClose={collapse}
            footer={
              <div className='flex gap-2'>
                {admin && !adminDenied && (
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    className='h-auto min-h-8 min-w-0 flex-1 py-2 whitespace-normal'
                    onClick={() => {
                      collapse()
                      void navigate({ to: '/support-ticket-management' })
                    }}
                  >
                    {t('Open ticket management')}
                  </Button>
                )}
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className='h-auto min-h-8 min-w-0 flex-1 py-2 whitespace-normal'
                  onClick={() => {
                    collapse()
                    void navigate({ to: '/support-tickets' })
                  }}
                >
                  {t('My support tickets')}
                </Button>
              </div>
            }
          >
            {((admin && adminQuery.isError && !adminDenied) ||
              (ownerQuery.isError && !ownerDenied)) && (
              <p role='status' className='text-muted-foreground mb-3 text-xs'>
                {t('Ticket reminder connection interrupted')}
              </p>
            )}
            <div className='divide-border divide-y' aria-live='polite'>
              {items.map((item) => {
                let label = t('New support reply')
                if (item.admin) {
                  label =
                    item.kind === 'new_ticket'
                      ? t('New ticket')
                      : t('New user reply')
                }
                return (
                  <article
                    key={`${item.admin}:${item.ticket_id}`}
                    className='space-y-2 py-3 first:pt-0 last:pb-0'
                  >
                    <div className='flex flex-wrap items-center gap-2'>
                      <Badge
                        variant={
                          item.kind === 'new_ticket' ? 'default' : 'secondary'
                        }
                      >
                        {label}
                      </Badge>
                      <span className='text-sm font-medium'>
                        {t('Ticket #{{id}}', { id: item.ticket_id })}
                      </span>
                    </div>
                    <p className='text-muted-foreground text-xs'>
                      {item.admin && (
                        <>
                          {t('User ID')}: {formatNumber(item.user_id, locale)}{' '}
                          ·{' '}
                        </>
                      )}
                      {ticketCategoryLabel(item.category, t)}
                    </p>
                    <div className='flex items-end justify-between gap-2'>
                      <div className='text-muted-foreground space-y-1 text-xs'>
                        <p>
                          {t('Unread messages: {{count}}', {
                            count: item.unread_count,
                          })}
                        </p>
                        <time
                          dateTime={new Date(
                            item.created_at * 1000
                          ).toISOString()}
                        >
                          {formatDateTimeStr(new Date(item.created_at * 1000))}
                        </time>
                      </div>
                      <Button
                        type='button'
                        size='sm'
                        variant='outline'
                        onClick={() =>
                          useTicketReminderStore
                            .getState()
                            .openDetail(
                              props.userId,
                              item.ticket_id,
                              item.admin
                            )
                        }
                      >
                        {t('View')}
                      </Button>
                    </div>
                  </article>
                )
              })}
            </div>
          </FloatingWindow>
        ) : (
          <Button
            type='button'
            variant='outline'
            className='bg-background fixed right-4 bottom-4 z-40 h-11 gap-2 rounded-full px-4 shadow-lg sm:right-6 sm:bottom-6'
            aria-label={`${t('Ticket reminders')}: ${formatNumber(unreadCount, locale)}`}
            aria-expanded={false}
            onClick={() => setManuallyExpanded(true)}
          >
            <LifeBuoy className='size-4' aria-hidden='true' />
            {t('Support tickets')}
            {badge}
          </Button>
        ))}
      {detail && (
        <TicketDetailDialog
          key={`${detail.admin}:${detail.ticketId}`}
          id={detail.ticketId}
          userId={props.userId}
          admin={detail.admin}
          onClose={() =>
            useTicketReminderStore.getState().closeDetail(props.userId)
          }
        />
      )}
    </>
  )
}
