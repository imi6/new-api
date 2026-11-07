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
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

// The ids kept per browser, newest last, so the lists do not grow forever.
const MAX_KEPT_IDS = 200

function keepIds(ids: number[], added: number[]): number[] {
  const merged = [...ids.filter((id) => !added.includes(id)), ...added]
  return merged.slice(-MAX_KEPT_IDS)
}

function readIdList(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.filter((id): id is number => Number.isInteger(id) && id > 0)
}

interface BulletinReadState {
  /** Announcements read in this browser, signed in or not. */
  readIds: number[]
  /** Those read before signing in, still to be handed to the server. */
  guestReadIds: number[]
  markRead: (ids: number[], signedIn: boolean) => void
  clearGuestReads: () => void
}

/**
 * Reads kept in this browser. A visitor's reads only live here; a signed-in
 * user's are also on the server, and kept here too so signing out does not
 * pop the same announcement up again.
 */
export const useBulletinReadStore = create<BulletinReadState>()(
  persist(
    (set) => ({
      readIds: [],
      guestReadIds: [],
      markRead: (ids, signedIn) =>
        set((state) => ({
          readIds: keepIds(state.readIds, ids),
          guestReadIds: signedIn
            ? state.guestReadIds
            : keepIds(state.guestReadIds, ids),
        })),
      clearGuestReads: () => set({ guestReadIds: [] }),
    }),
    {
      name: 'bulletin-reads',
      partialize: (state) => ({
        readIds: state.readIds,
        guestReadIds: state.guestReadIds,
      }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<BulletinReadState>
        return {
          ...current,
          readIds: readIdList(saved.readIds),
          guestReadIds: readIdList(saved.guestReadIds),
        }
      },
    }
  )
)

interface BulletinSessionState {
  /** Popups already shown in this tab, so a refresh does not repeat them. */
  shownIds: number[]
  /** The announcement opened from the notification bell, if any. */
  openedId: number | null
  markShown: (id: number) => void
  open: (id: number) => void
  close: () => void
}

export const useBulletinSessionStore = create<BulletinSessionState>()(
  persist(
    (set) => ({
      shownIds: [],
      openedId: null,
      markShown: (id) =>
        set((state) => ({ shownIds: keepIds(state.shownIds, [id]) })),
      open: (id) => set({ openedId: id }),
      close: () => set({ openedId: null }),
    }),
    {
      name: 'bulletin-shown',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ shownIds: state.shownIds }),
      merge: (persisted, current) => ({
        ...current,
        shownIds: readIdList(
          (persisted as Partial<BulletinSessionState> | undefined)?.shownIds
        ),
      }),
    }
  )
)
