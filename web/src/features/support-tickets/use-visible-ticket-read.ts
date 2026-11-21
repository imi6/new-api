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
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, type RefObject } from 'react'

import { markTicketRead } from './api'
import type { TicketDetail } from './types'
import { ticketReminderKey } from './use-ticket-reminders'

interface VisibleTicketReadOptions {
  userId: number
  ticketId: number
  enabled: boolean
  admin: boolean
  detail: TicketDetail | undefined
  container: RefObject<HTMLDivElement | null>
}

export function useVisibleTicketRead(options: VisibleTicketReadOptions) {
  const client = useQueryClient()
  const confirmed = useRef({ key: '', messageId: 0 })

  useEffect(() => {
    const container = options.container.current
    if (
      !options.enabled ||
      !options.detail ||
      !container ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return
    }

    const key = `${options.userId}:${options.ticketId}:${options.admin}`
    if (confirmed.current.key !== key) confirmed.current = { key, messageId: 0 }
    const currentConfirmed = confirmed.current

    let active = true
    let inFlight = false
    let highestVisible = currentConfirmed.messageId
    let requested = currentConfirmed.messageId
    let controller: AbortController | null = null

    // 仅确认本次真正展示到的消息，不把详情加载时的最后一条直接当作已读。
    const confirmVisible = async () => {
      if (!active || inFlight || highestVisible <= requested) return
      const messageId = highestVisible
      requested = messageId
      inFlight = true
      controller = new AbortController()
      try {
        await markTicketRead(
          options.ticketId,
          messageId,
          controller.signal,
          options.admin
        )
        if (active) {
          currentConfirmed.messageId = Math.max(
            currentConfirmed.messageId,
            messageId
          )
          await client.invalidateQueries({
            queryKey: ticketReminderKey(options.userId, options.admin),
          })
        }
      } catch {
        // 已读确认失败时保留提醒，下次详情刷新或继续阅读时再尝试。
        requested = currentConfirmed.messageId
      } finally {
        inFlight = false
        // 失败的同一条等待下一次可视事件；只继续发送期间真正读到的新消息。
        if (active && highestVisible > messageId) void confirmVisible()
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!active || document.visibilityState !== 'visible') return
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < 1) continue
          const marker = entry.target as HTMLElement
          const dialog = marker.closest('[data-slot="dialog-content"]')
          if (
            dialog?.closest('[inert]') ||
            dialog?.getAttribute('aria-hidden') === 'true'
          ) {
            continue
          }
          if (typeof document.elementFromPoint === 'function') {
            const bounds = marker.getBoundingClientRect()
            const visibleElement = document.elementFromPoint(
              bounds.left + bounds.width / 2,
              bounds.top + bounds.height / 2
            )
            if (!visibleElement || !container.contains(visibleElement)) continue
          }
          const messageId = Number(marker.dataset.ticketIncomingMessageId)
          if (Number.isSafeInteger(messageId) && messageId > highestVisible) {
            highestVisible = messageId
          }
        }
        void confirmVisible()
      },
      { threshold: 1 }
    )

    const observeVisibleMessages = () => {
      observer.disconnect()
      if (document.visibilityState !== 'visible') return
      for (const marker of container.querySelectorAll(
        '[data-ticket-incoming-message-id]'
      )) {
        observer.observe(marker)
      }
    }
    observeVisibleMessages()
    document.addEventListener('visibilitychange', observeVisibleMessages)
    document.addEventListener('focusin', observeVisibleMessages)
    return () => {
      active = false
      controller?.abort()
      observer.disconnect()
      document.removeEventListener('visibilitychange', observeVisibleMessages)
      document.removeEventListener('focusin', observeVisibleMessages)
    }
  }, [
    client,
    options.admin,
    options.container,
    options.detail,
    options.enabled,
    options.ticketId,
    options.userId,
  ])
}
