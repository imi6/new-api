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
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import type {
  BulletinFeed,
  BulletinInput,
  ManagedBulletin,
  ManagedBulletinList,
} from './types'

type Response<T> = { success: boolean; message?: string; data: T }

/** The live announcements, with the signed-in user's reads. */
export async function getBulletins(): Promise<BulletinFeed> {
  const res = await api.get<Response<BulletinFeed>>('/api/announcements')
  return requireServerSuccess(res.data).data
}

/** Records the signed-in user's reads; ids that are not live are skipped. */
export async function markBulletinsRead(ids: number[]): Promise<void> {
  const res = await api.post<Response<null>>('/api/announcements/read', {
    ids,
  })
  requireServerSuccess(res.data)
}

export async function getManagedBulletins(): Promise<ManagedBulletinList> {
  const res = await api.get<Response<ManagedBulletinList>>(
    '/api/announcements/admin'
  )
  return requireServerSuccess(res.data).data
}

export async function createBulletin(
  input: BulletinInput
): Promise<ManagedBulletin> {
  const res = await api.post<Response<ManagedBulletin>>(
    '/api/announcements/admin',
    input
  )
  return requireServerSuccess(res.data).data
}

export async function updateBulletin(
  id: number,
  input: BulletinInput
): Promise<ManagedBulletin> {
  const res = await api.put<Response<ManagedBulletin>>(
    `/api/announcements/admin/${id}`,
    input
  )
  return requireServerSuccess(res.data).data
}

export async function deleteBulletin(id: number): Promise<void> {
  const res = await api.delete<Response<null>>(
    `/api/announcements/admin/${id}`
  )
  requireServerSuccess(res.data)
}

export async function setBulletinGuestPopup(guestPopup: boolean): Promise<void> {
  const res = await api.put<Response<null>>(
    '/api/announcements/admin/setting',
    { guest_popup: guestPopup }
  )
  requireServerSuccess(res.data)
}
