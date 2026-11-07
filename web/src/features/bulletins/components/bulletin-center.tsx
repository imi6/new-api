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
import { useLocation } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  useBulletinReadStore,
  useBulletinSessionStore,
} from '@/stores/bulletin-store'

import { markBulletinsRead } from '../api'
import { useBulletins, useMarkBulletinsRead } from '../hooks/use-bulletins'
import type { Bulletin } from '../types'
import { BulletinDialog, type BulletinDialogItem } from './bulletin-dialog'

// The gap between closing one popup and showing the next.
const NEXT_POPUP_DELAY_MS = 300

function dialogItem(item: Bulletin): BulletinDialogItem {
  return { title: item.title, content: item.content, shownAt: item.shown_at }
}

/**
 * Mounted once at the root. Pops up the unread popup announcements one at a
 * time, oldest first; shows the one opened from the notification bell; and
 * after signing in hands this browser's earlier reads to the server.
 */
export function BulletinCenter() {
  const { t } = useTranslation()
  const pathname = useLocation({ select: (location) => location.pathname })
  // The setup wizard runs before the site works.
  const onSetup = pathname.startsWith('/setup')
  const bulletins = useBulletins({ enabled: !onSetup })
  const markRead = useMarkBulletinsRead()
  const shownIds = useBulletinSessionStore((state) => state.shownIds)
  const markShown = useBulletinSessionStore((state) => state.markShown)
  const openedId = useBulletinSessionStore((state) => state.openedId)
  const closeOpened = useBulletinSessionStore((state) => state.close)

  const popupAllowed = bulletins.signedIn || bulletins.guestPopup
  const waiting = useMemo(() => {
    if (onSetup || !popupAllowed) return []
    return bulletins.items
      .filter(
        (item) =>
          item.notify_mode === 'popup' &&
          !item.read &&
          !shownIds.includes(item.id)
      )
      .sort((left, right) => left.shown_at - right.shown_at || left.id - right.id)
  }, [bulletins.items, onSetup, popupAllowed, shownIds])

  // The popups of this run, the first one showing; the run's size for "1 / 3".
  const [queue, setQueue] = useState<number[]>([])
  const [runSize, setRunSize] = useState(0)
  const [closing, setClosing] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The bell's announcement, kept while its dialog closes.
  const opened = bulletins.items.find((item) => item.id === openedId) ?? null
  const [shownDetail, setShownDetail] = useState<Bulletin | null>(null)
  if (opened && opened !== shownDetail) {
    setShownDetail(opened)
  }
  // An announcement taken down while open closes its dialog without the
  // user, so the opened id is cleared here; left set, it would hold back
  // every popup in this tab.
  const openedGone = openedId !== null && bulletins.isSuccess && !opened
  useEffect(() => {
    if (openedGone) closeOpened()
  }, [openedGone, closeOpened])

  // Start a run when nothing shows and popups wait; a popup that left the
  // list since (archived, ended) is passed over.
  const current = bulletins.items.find((item) => item.id === queue[0])
  if (queue.length === 0 && waiting.length > 0 && opened === null) {
    setQueue(waiting.map((item) => item.id))
    setRunSize(waiting.length)
  } else if (queue.length > 0 && !current && !closing) {
    setQueue(queue.slice(1))
  }

  const finishCurrent = (read: boolean) => {
    if (!current || closing) return
    markShown(current.id)
    if (read) markRead([current.id])
    setClosing(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setQueue((ids) => ids.slice(1))
      setClosing(false)
    }, NEXT_POPUP_DELAY_MS)
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  // Reads made before signing in become the account's, once the list of
  // live announcements is in; the server skips ids no longer live.
  const guestReadIds = useBulletinReadStore((state) => state.guestReadIds)
  const clearGuestReads = useBulletinReadStore((state) => state.clearGuestReads)
  const merging = useRef(false)
  useEffect(() => {
    if (!bulletins.signedIn || !bulletins.isSuccess) return
    if (guestReadIds.length === 0 || merging.current) return
    const live = new Set(bulletins.items.map((item) => item.id))
    const ids = guestReadIds.filter((id) => live.has(id))
    if (ids.length === 0) {
      clearGuestReads()
      return
    }
    merging.current = true
    markBulletinsRead(ids)
      .then(() => clearGuestReads())
      .catch(() => undefined)
      .finally(() => {
        merging.current = false
      })
  }, [
    bulletins.signedIn,
    bulletins.isSuccess,
    bulletins.items,
    guestReadIds,
    clearGuestReads,
  ])

  const position = queue.length > 0 ? runSize - queue.length + 1 : 0

  return (
    <>
      <BulletinDialog
        open={Boolean(current) && !closing && opened === null}
        item={current ? dialogItem(current) : null}
        onDismiss={() => finishCurrent(false)}
        onConfirm={() => finishCurrent(true)}
        confirmLabel={t('I have read it')}
        position={{ index: position, total: runSize }}
      />
      <BulletinDialog
        open={opened !== null}
        item={shownDetail ? dialogItem(shownDetail) : null}
        onDismiss={closeOpened}
        onConfirm={closeOpened}
        confirmLabel={t('Close')}
      />
    </>
  )
}
