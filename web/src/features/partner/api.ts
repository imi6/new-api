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
  PartnerConfig,
  PartnerOfferPage,
  PartnerSite,
  PartnerSiteInput,
  PartnerStatus,
} from './types'

type Response<T> = { success: boolean; message?: string; data: T }

export async function getPartnerConfig(): Promise<PartnerConfig> {
  const res = await api.get<Response<PartnerConfig>>('/api/partner/config')
  return requireServerSuccess(res.data).data
}

/** Submits one site; the captcha token is sent when the site uses one. */
export async function submitPartnerSite(
  input: PartnerSiteInput,
  turnstile: string
): Promise<{ id: number }> {
  const res = await api.post<Response<{ id: number }>>(
    '/api/partner/sites',
    input,
    { params: turnstile ? { turnstile } : undefined }
  )
  return requireServerSuccess(res.data).data
}

export async function getMyPartnerSites(): Promise<PartnerSite[]> {
  const res = await api.get<Response<PartnerSite[]>>('/api/partner/sites')
  return requireServerSuccess(res.data).data
}

export async function getPartnerOffers(params: {
  page: number
  pageSize: number
  keyword: string
  channelType: number
  status: PartnerStatus | ''
  sortOrder: 'asc' | 'desc'
}): Promise<PartnerOfferPage> {
  const res = await api.get<Response<PartnerOfferPage>>(
    '/api/partner/admin/offers',
    {
      params: {
        p: params.page,
        page_size: params.pageSize,
        keyword: params.keyword,
        channel_type: params.channelType || undefined,
        status: params.status || undefined,
        sort_order: params.sortOrder,
      },
    }
  )
  return requireServerSuccess(res.data).data
}

export async function markPartnerSite(
  id: number,
  status: PartnerStatus,
  note: string
): Promise<void> {
  const res = await api.patch<Response<null>>(
    `/api/partner/admin/sites/${id}`,
    { admin_status: status, admin_note: note }
  )
  requireServerSuccess(res.data)
}

/** Deletes one group; the site goes with its last group. */
export async function deletePartnerOffer(id: number): Promise<void> {
  const res = await api.delete<Response<null>>(
    `/api/partner/admin/offers/${id}`
  )
  requireServerSuccess(res.data)
}

export async function deletePartnerSite(id: number): Promise<void> {
  const res = await api.delete<Response<null>>(
    `/api/partner/admin/sites/${id}`
  )
  requireServerSuccess(res.data)
}
