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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { handleServerError } from '@/lib/handle-server-error'

import { deleteAdminTickets } from './api'
import { useTicketReminderStore } from './reminder-store'
import type { TicketPage } from './types'

interface TicketDeleteDialogProps {
  ids: number[]
  onOpenChange: (open: boolean) => void
  onDeleted: (ids: number[]) => void
}

export function TicketDeleteDialog(props: TicketDeleteDialogProps) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const submitting = useRef(false)
  const canDelete = props.ids.length > 0 && props.ids.length <= 100
  const mutation = useMutation({
    mutationFn: () => deleteAdminTickets(props.ids),
    onSuccess: async (result) => {
      const deleted = new Set(result.deleted_ids)
      const openedDetail = useTicketReminderStore.getState().openedDetail
      if (openedDetail && deleted.has(openedDetail.ticketId)) {
        useTicketReminderStore.getState().closeDetail(openedDetail.userId)
      }
      props.onDeleted(result.deleted_ids)
      toast.success(t('Deleted {{count}} tickets', { count: deleted.size }))
      if (result.file_cleanup_pending) {
        toast.warning(
          t('Some screenshot files could not be removed from storage.')
        )
      }
      // 先取消旧请求并清除详情、截图缓存，避免已删除内容被正在返回的请求重新写入。
      await client.cancelQueries({
        predicate: (query) =>
          query.queryKey[0] === 'support-tickets' ||
          query.queryKey[0] === 'support-ticket-screenshot',
      })
      client.removeQueries({
        predicate: (query) =>
          (query.queryKey[0] === 'support-tickets' &&
            query.queryKey[3] === 'detail' &&
            deleted.has(Number(query.queryKey[4]))) ||
          (query.queryKey[0] === 'support-ticket-screenshot' &&
            deleted.has(Number(query.queryKey[3]))),
      })
      client.setQueriesData<TicketPage>(
        {
          queryKey: ['support-tickets'],
          predicate: (query) => query.queryKey[3] === 'list',
        },
        (previous) => {
          if (!previous?.items) return previous
          const items = previous.items.filter(
            (ticket) => !deleted.has(ticket.id)
          )
          return {
            ...previous,
            items,
            total: Math.max(
              0,
              previous.total - (previous.items.length - items.length)
            ),
          }
        }
      )
      await client.invalidateQueries({
        queryKey: ['support-tickets'],
        predicate: (query) =>
          query.queryKey[3] === 'list' || query.queryKey[3] === 'reminders',
      })
    },
    onError: (error) => handleServerError(error, t('Failed to delete tickets')),
    onSettled: () => {
      submitting.current = false
    },
  })

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!submitting.current) props.onOpenChange(open)
      }}
      title={t('Permanently delete {{count}} tickets?', {
        count: props.ids.length,
      })}
      desc={t(
        'This permanently deletes the selected tickets, all replies, and screenshots. Users will no longer be able to view them.'
      )}
      destructive
      confirmText={t('Delete permanently')}
      disabled={!canDelete}
      isLoading={mutation.isPending}
      handleConfirm={() => {
        if (submitting.current || !canDelete) return
        submitting.current = true
        mutation.mutate()
      }}
    />
  )
}
