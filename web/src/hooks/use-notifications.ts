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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo, useCallback } from 'react'

import { useBulletins } from '@/features/bulletins/hooks/use-bulletins'
import { useStatus } from '@/hooks/use-status'
import { getNotice } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'
import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { useNotificationStore } from '@/stores/notification-store'

function hashString(input: string): string {
  let hash = 0
  if (!input) return '0'

  for (let i = 0; i < input.length; i += 1) {
    const chr = input.charCodeAt(i)
    hash = (hash << 5) - hash + chr
    hash |= 0
  }

  return hash.toString(36)
}

/**
 * Generate a unique key for an announcement
 * Prefer backend id, fall back to a content hash so edits register
 */
function getAnnouncementKey(item: Record<string, unknown>): string {
  if (!item) return ''

  if (item.id !== undefined && item.id !== null) {
    return `id:${item.id}`
  }

  const fingerprint = JSON.stringify({
    publishDate: (item?.publishDate as string) || '',
    content: ((item?.content as string) || '').trim(),
    extra: ((item?.extra as string) || '').trim(),
    type: (item?.type as string) || '',
    title: ((item?.title as string) || '').trim(),
    link: ((item?.link as string) || '').trim(),
  })
  return `hash:${hashString(fingerprint)}`
}

export type NotificationTab = 'notice' | 'bulletins' | 'announcements'

/**
 * Hook to manage notifications (Notice + Announcements)
 * Provides unread counts and read status management
 */
export function useNotifications(options: { timelineLimit?: number } = {}) {
  const queryClient = useQueryClient()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<NotificationTab>('notice')
  // The announcements that pop up count in the badge too.
  const bulletinUnread = useBulletins().unreadCount

  // Fetch Notice from API
  const {
    data: noticeResponse,
    isLoading: noticeLoading,
    error: noticeError,
    refetch: refetchNotice,
  } = useQuery({
    queryKey: ['notice'],
    queryFn: async () => requireServerSuccess(await getNotice()),
    staleTime: 1000 * 60 * 5, // 5 minutes
  })

  // Fetch Announcements from status
  const { status, loading: statusLoading, error: statusError } = useStatus()
  const announcementsEnabled = status?.announcements_enabled ?? false
  const timelineLimit = options.timelineLimit ?? 20
  const announcements = useMemo<Record<string, unknown>[]>(() => {
    if (!announcementsEnabled) return []
    const items = (status?.announcements || []) as Record<string, unknown>[]
    return timelineLimit > 0 ? items.slice(0, timelineLimit) : items
  }, [announcementsEnabled, status?.announcements, timelineLimit])

  // Notification store
  const {
    lastReadNotice,
    readAnnouncementKeys,
    markNoticeRead,
    markAnnouncementsRead,
  } = useNotificationStore()

  // Extract notice content
  const noticeContent = noticeResponse?.success
    ? (noticeResponse.data || '').trim()
    : ''

  // Calculate unread counts
  const unreadCounts = useMemo(() => {
    const noticeUnread =
      noticeContent && noticeContent !== lastReadNotice ? 1 : 0

    const readKeys = new Set(readAnnouncementKeys)
    const announcementsUnread = announcements.filter(
      (item: Record<string, unknown>) => {
        const key = getAnnouncementKey(item)
        return !readKeys.has(key)
      }
    ).length

    return {
      notice: noticeUnread,
      announcements: announcementsUnread,
      total: noticeUnread + announcementsUnread + bulletinUnread,
    }
  }, [
    noticeContent,
    lastReadNotice,
    announcements,
    readAnnouncementKeys,
    bulletinUnread,
  ])

  const markNoticeAsRead = useCallback(() => {
    if (noticeContent && noticeContent !== lastReadNotice) {
      markNoticeRead(noticeContent)
    }
  }, [noticeContent, lastReadNotice, markNoticeRead])

  const markAnnouncementsAsRead = useCallback(() => {
    const readKeys = new Set(readAnnouncementKeys)
    const unreadKeys = announcements
      .map(getAnnouncementKey)
      .filter((key) => !readKeys.has(key))
    if (unreadKeys.length > 0) markAnnouncementsRead(unreadKeys)
  }, [announcements, readAnnouncementKeys, markAnnouncementsRead])

  // Handle popover open
  const handleOpenPopover = (tab?: NotificationTab) => {
    const nextTab = tab || activeTab

    // Mark currently visible content as read when opening the notification center
    if (noticeContent) {
      markNoticeRead(noticeContent)
    }
    if (nextTab === 'announcements') {
      markAnnouncementsAsRead()
    }

    setActiveTab(nextTab)
    setPopoverOpen(true)
  }

  const handlePopoverOpenChange = (open: boolean) => {
    if (open) {
      handleOpenPopover(activeTab)
      return
    }

    setPopoverOpen(false)
  }

  // Handle tab change - mark announcements as read when switching to that tab
  const handleTabChange = (tab: NotificationTab) => {
    setActiveTab(tab)

    if (tab === 'announcements' && !statusLoading && !statusError) {
      markAnnouncementsAsRead()
    }
  }

  return {
    // Data
    notice: noticeContent,
    announcements,
    loading: noticeLoading || statusLoading,
    noticeLoading,
    noticeError,
    timelineLoading: statusLoading,
    timelineError: statusError,

    // Unread counts
    unreadCount: unreadCounts.total,
    unreadNoticeCount: unreadCounts.notice,
    unreadBulletinCount: bulletinUnread,
    unreadAnnouncementsCount: unreadCounts.announcements,

    // Popover state
    popoverOpen,
    setPopoverOpen: handlePopoverOpenChange,
    activeTab,
    setActiveTab: handleTabChange,

    // Actions
    openPopover: handleOpenPopover,
    closePopover: () => setPopoverOpen(false),
    refetchNotice,
    refetchTimeline: () =>
      queryClient.refetchQueries({ queryKey: STATUS_QUERY_KEY, exact: true }),
    markNoticeAsRead,
    markAnnouncementsAsRead,
  }
}
