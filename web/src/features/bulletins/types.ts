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

// Announcements that pop up or show in the notification bell. The web code
// calls them bulletins so they are not mistaken for the announcement
// timeline of the console settings; the API calls them announcements.

export type BulletinNotifyMode = 'silent' | 'popup'

export type BulletinStatus = 'draft' | 'published' | 'archived'

export const BULLETIN_STATUSES: BulletinStatus[] = [
  'draft',
  'published',
  'archived',
]

export const BULLETIN_NOTIFY_MODES: BulletinNotifyMode[] = ['popup', 'silent']

/** A live announcement, as everyone receives it. */
export type Bulletin = {
  id: number
  title: string
  content: string
  notify_mode: BulletinNotifyMode
  /** Unix seconds: its start time, else when it was first published. */
  shown_at: number
  /** Whether the signed-in user read it; a visitor's reads stay local. */
  read: boolean
}

export type BulletinFeed = {
  items: Bulletin[]
  /** Whether visitors who are not signed in get the popups too. */
  guest_popup: boolean
}

/** An announcement as an administrator manages it. */
export type ManagedBulletin = {
  id: number
  title: string
  content: string
  status: BulletinStatus
  notify_mode: BulletinNotifyMode
  /** Unix seconds; 0 means no limit. */
  starts_at: number
  ends_at: number
  published_at: number
  created_at: number
  updated_at: number
}

export type ManagedBulletinList = {
  items: ManagedBulletin[]
  guest_popup: boolean
}

export type BulletinInput = {
  title: string
  content: string
  status: BulletinStatus
  notify_mode: BulletinNotifyMode
  starts_at: number
  ends_at: number
}
