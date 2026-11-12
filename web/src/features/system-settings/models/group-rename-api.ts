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

type Response<T> = { success: boolean; message?: string; data?: T }

export type GroupRenamePhase = 'announced' | 'migrated' | 'settled'

export type GroupRenameAlias = {
  old: string
  new: string
  phase: GroupRenamePhase
  started_at: number
  migrated_at?: number
  migrated_acked_at?: number
  users: number
  tokens: number
  channels: number
  subscriptions: number
  /** Why the last step failed, as a translatable message. */
  error?: { key: string; params?: Record<string, unknown> }
}

export type GroupRenameStatus = {
  /** The rename in progress; null when none is running. */
  alias: GroupRenameAlias | null
  /** Online nodes that have not loaded the current step yet. */
  waiting: string[]
  /** When the final step is expected to run. */
  settle_at?: number
}

export const GROUP_RENAME_QUERY_KEY = ['group-rename'] as const

/** Starts a rename; the server finishes it in the background. */
export async function renameGroup(oldName: string, newName: string) {
  const response = await api.post<Response<GroupRenameAlias>>(
    '/api/option/group/rename',
    { old_name: oldName, new_name: newName }
  )
  return requireServerSuccess(response.data)
}

export async function getGroupRename() {
  const response = await api.get<Response<GroupRenameStatus>>(
    '/api/option/group/rename'
  )
  return requireServerSuccess(response.data).data ?? null
}

/** Cancels a rename that has not started migrating. */
export async function cancelGroupRename() {
  const response = await api.delete<Response<GroupRenameAlias>>(
    '/api/option/group/rename'
  )
  return requireServerSuccess(response.data)
}
