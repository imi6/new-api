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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { formatDateTimeStr } from '@/lib/format'
import {
  getServerErrorSources,
  getServerErrorStatus,
} from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import { getTicket, replyToTicket, setTicketStatus } from './api'
import { ticketCategoryLabel } from './labels'
import { TicketComposer } from './ticket-composer'
import { TicketScreenshot } from './ticket-screenshot'
import { TicketStatusBadge } from './ticket-status-badge'
import { ticketReminderKey } from './use-ticket-reminders'
import { useVisibleTicketRead } from './use-visible-ticket-read'

interface TicketDetailDialogProps {
  id: number
  userId: number
  admin: boolean
  onClose: () => void
}

export function TicketDetailDialog(props: TicketDetailDialogProps) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [closeConfirm, setCloseConfirm] = useState(false)
  const [replyBusy, setReplyBusy] = useState(false)
  const messageLog = useRef<HTMLDivElement>(null)
  const rootKey = ['support-tickets', props.userId, props.admin] as const
  const query = useQuery({
    queryKey: [...rootKey, 'detail', props.id],
    queryFn: ({ signal }) => getTicket(props.admin, props.id, signal),
    refetchInterval: 30_000,
    staleTime: 0,
    meta: { errorToast: false, errorRedirect: false },
  })
  const statusMutation = useMutation({
    mutationFn: (status: 'open' | 'closed') =>
      setTicketStatus(props.admin, props.id, status),
    onSuccess: async (ticket) => {
      setCloseConfirm(false)
      toast.success(
        ticket.status === 'closed' ? t('Ticket closed') : t('Ticket reopened')
      )
      await client.invalidateQueries({ queryKey: rootKey })
    },
  })
  const busy = replyBusy || statusMutation.isPending
  const unavailable =
    getServerErrorStatus(query.error) === 404 ||
    getServerErrorSources(query.error).some(
      (source) =>
        source.message_key === 'Support ticket not found' ||
        source.message === 'Support ticket not found'
    )
  const detail = unavailable ? undefined : query.data
  useVisibleTicketRead({
    userId: props.userId,
    ticketId: props.id,
    enabled: !query.isError && !closeConfirm,
    admin: props.admin,
    detail,
    container: messageLog,
  })
  useEffect(() => {
    if (unavailable) {
      void client.invalidateQueries({
        queryKey: ticketReminderKey(props.userId, props.admin),
      })
    }
  }, [client, props.admin, props.userId, unavailable])

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !busy) props.onClose()
        }}
        title={t('Ticket #{{id}}', { id: props.id })}
        contentClassName='sm:max-w-2xl'
        showCloseButton={!busy}
      >
        {query.isLoading && <LoadingState />}
        {query.isError && !detail && (
          <ErrorState
            description={t('Failed to load')}
            onRetry={() => void query.refetch()}
          />
        )}
        {detail && (
          <div className='space-y-5'>
            <div className='flex flex-wrap items-center justify-between gap-3 border-b pb-3'>
              <div className='flex flex-wrap items-center gap-2 text-sm'>
                <span>{ticketCategoryLabel(detail.ticket.category, t)}</span>
                <TicketStatusBadge
                  status={detail.ticket.status}
                  admin={props.admin}
                />
                {props.admin && (
                  <span className='text-muted-foreground'>
                    {t('User ID')}: {detail.ticket.user_id}
                  </span>
                )}
              </div>
              {detail.ticket.status !== 'closed' && (
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  disabled={busy}
                  onClick={() => setCloseConfirm(true)}
                >
                  {t('Close ticket')}
                </Button>
              )}
              {props.admin && detail.ticket.status === 'closed' && (
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  disabled={busy}
                  onClick={() => statusMutation.mutate('open')}
                >
                  {t('Reopen ticket')}
                </Button>
              )}
            </div>
            <div
              ref={messageLog}
              className='space-y-4'
              role='log'
              aria-label={t('Messages')}
            >
              {detail.messages.map((message) => {
                let author = props.admin ? t('User') : t('You')
                if (message.is_admin) author = t('Support')
                return (
                  <article
                    key={message.id}
                    className={cn(
                      'space-y-2 rounded-xl border p-3 sm:p-4',
                      message.is_admin && 'border-primary/20 bg-primary/5'
                    )}
                  >
                    <div className='text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs'>
                      <span className='text-foreground font-medium'>
                        {author}
                      </span>
                      <time
                        dateTime={new Date(
                          message.created_at * 1000
                        ).toISOString()}
                      >
                        {formatDateTimeStr(new Date(message.created_at * 1000))}
                      </time>
                    </div>
                    <p className='text-sm leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap'>
                      {message.content}
                    </p>
                    {message.attachments.length > 0 && (
                      <div className='flex flex-wrap gap-2'>
                        {message.attachments.map((attachment, index) => (
                          <TicketScreenshot
                            key={attachment.id}
                            userId={props.userId}
                            admin={props.admin}
                            ticketId={props.id}
                            attachment={attachment}
                            number={index + 1}
                          />
                        ))}
                      </div>
                    )}
                    {message.is_admin !== props.admin &&
                      message.author_id !== props.userId && (
                        <div
                          className='h-px'
                          data-ticket-incoming-message-id={message.id}
                          aria-hidden='true'
                        />
                      )}
                  </article>
                )
              })}
            </div>
            {detail.ticket.status === 'closed' && (
              <p className='text-muted-foreground bg-muted/50 rounded-lg p-3 text-sm'>
                {t(
                  'You cannot reply to a closed ticket. Support can reopen it if needed.'
                )}
              </p>
            )}
            <TicketComposer
              disabled={
                detail.ticket.status === 'closed' || statusMutation.isPending
              }
              submit={(payload) =>
                replyToTicket(props.admin, props.id, payload)
              }
              onBusyChange={setReplyBusy}
              onSuccess={async () => {
                await client.invalidateQueries({ queryKey: rootKey })
                toast.success(t('Reply sent'))
              }}
            />
          </div>
        )}
      </Dialog>
      <ConfirmDialog
        open={closeConfirm}
        onOpenChange={setCloseConfirm}
        title={t('Close this ticket?')}
        desc={t(
          'You cannot reply to a closed ticket. Support can reopen it if needed.'
        )}
        confirmText={t('Close ticket')}
        isLoading={statusMutation.isPending}
        handleConfirm={() => statusMutation.mutate('closed')}
      />
    </>
  )
}
