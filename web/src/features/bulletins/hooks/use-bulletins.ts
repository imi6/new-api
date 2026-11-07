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
import { useCallback, useMemo } from 'react'

import { useAuthStore } from '@/stores/auth-store'
import { useBulletinReadStore } from '@/stores/bulletin-store'

import { getBulletins, markBulletinsRead } from '../api'
import type { Bulletin } from '../types'

// Fetched on page load, then at most every ten minutes, also when the tab
// is shown again after that long.
const BULLETIN_REFRESH_MS = 10 * 60 * 1000

export const BULLETINS_QUERY_KEY = ['bulletins'] as const
/** Under BULLETINS_QUERY_KEY, so invalidating that refreshes both lists. */
export const MANAGED_BULLETINS_QUERY_KEY = [...BULLETINS_QUERY_KEY, 'admin'] as const

/**
 * The live announcements, with which ones this user has read. A read counts
 * when the server has it for the signed-in user or this browser kept it.
 */
export function useBulletins(options: { enabled?: boolean } = {}) {
  const userId = useAuthStore((state) => state.auth.user?.id ?? 0)
  const readIds = useBulletinReadStore((state) => state.readIds)
  const query = useQuery({
    queryKey: [...BULLETINS_QUERY_KEY, userId],
    queryFn: getBulletins,
    enabled: options.enabled ?? true,
    staleTime: BULLETIN_REFRESH_MS,
    refetchInterval: BULLETIN_REFRESH_MS,
    refetchOnWindowFocus: true,
    // Announcements are not worth an error toast on every page.
    meta: { errorToast: false },
  })

  const items = useMemo<Bulletin[]>(() => {
    const read = new Set(readIds)
    return (query.data?.items ?? []).map((item) =>
      item.read || !read.has(item.id) ? item : { ...item, read: true }
    )
  }, [query.data, readIds])
  const unreadCount = items.filter((item) => !item.read).length

  return {
    items,
    unreadCount,
    guestPopup: query.data?.guest_popup ?? false,
    signedIn: userId > 0,
    isLoading: query.isLoading,
    isSuccess: query.isSuccess,
  }
}

/**
 * Marks announcements read in this browser at once, and for a signed-in user
 * on the server too. A failed save only means another device may still pop
 * it up, so it is not reported.
 */
export function useMarkBulletinsRead() {
  const signedIn = useAuthStore((state) => Boolean(state.auth.user))
  const markRead = useBulletinReadStore((state) => state.markRead)
  return useCallback(
    (ids: number[]) => {
      if (ids.length === 0) return
      markRead(ids, signedIn)
      if (signedIn) {
        void markBulletinsRead(ids).catch(() => undefined)
      }
    },
    [markRead, signedIn]
  )
}
