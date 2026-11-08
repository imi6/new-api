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
  UpstreamRate,
  UpstreamRateConfig,
  UpstreamRateSourceInput,
  UpstreamRateTask,
} from './types'

type Envelope<T> = { success: boolean; data: T; message?: string }
const base = '/api/channel/upstream_rates'
export const upstreamRateQueryKey = ['channels', 'upstream-rates'] as const

export async function getUpstreamRateConfig(
  signal?: AbortSignal
): Promise<UpstreamRateConfig> {
  const response = await api.get<Envelope<UpstreamRateConfig>>(
    `${base}/config`,
    { signal }
  )
  return requireServerSuccess(response.data).data
}

export async function getUpstreamRates(
  ids: number[],
  signal?: AbortSignal
): Promise<UpstreamRate[]> {
  const requests: Promise<UpstreamRate[]>[] = []
  for (let offset = 0; offset < ids.length; offset += 200) {
    requests.push(
      api
        .get<Envelope<UpstreamRate[]>>(base, {
          params: { ids: ids.slice(offset, offset + 200).join(',') },
          signal,
        })
        .then((response) => requireServerSuccess(response.data).data)
    )
  }
  return (await Promise.all(requests)).flat()
}

export async function saveUpstreamRateSource(
  input: UpstreamRateSourceInput
): Promise<void> {
  requireServerSuccess(
    (await api.put<Envelope<null>>(`${base}/sources`, input)).data
  )
}

export async function deleteUpstreamRateSource(id: string): Promise<void> {
  requireServerSuccess(
    (
      await api.delete<Envelope<null>>(
        `${base}/sources/${encodeURIComponent(id)}`
      )
    ).data
  )
}

export async function refreshUpstreamRates(input: {
  source_id?: string
  channel_id?: number
  force?: boolean
}): Promise<UpstreamRateTask> {
  return requireServerSuccess(
    (await api.post<Envelope<UpstreamRateTask>>(`${base}/refresh`, input)).data
  ).data
}

export async function getUpstreamRateTask(
  id: string,
  signal?: AbortSignal
): Promise<UpstreamRateTask> {
  return requireServerSuccess(
    (
      await api.get<Envelope<UpstreamRateTask>>(
        `${base}/tasks/${encodeURIComponent(id)}`,
        { signal }
      )
    ).data
  ).data
}
