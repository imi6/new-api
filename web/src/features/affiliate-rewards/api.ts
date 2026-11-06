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
  AffiliateClaimPage,
  AffiliateInviterDetail,
  AffiliateInviterPage,
  AffiliateInviterSortBy,
  AffiliateSummary,
} from './types'

type Response<T> = { success: boolean; message?: string; data: T }

export async function getAffiliateSummary(): Promise<AffiliateSummary> {
  const res = await api.get<Response<AffiliateSummary>>(
    '/api/user/affiliate/summary'
  )
  return requireServerSuccess(res.data).data
}

export async function getAffiliateInviters(params: {
  page: number
  pageSize: number
  keyword: string
  sortBy: AffiliateInviterSortBy
  sortOrder: 'asc' | 'desc'
}): Promise<AffiliateInviterPage> {
  const res = await api.get<Response<AffiliateInviterPage>>(
    '/api/user/affiliate/inviters',
    {
      params: {
        p: params.page,
        page_size: params.pageSize,
        keyword: params.keyword,
        sort_by: params.sortBy,
        sort_order: params.sortOrder,
      },
    }
  )
  return requireServerSuccess(res.data).data
}

export async function getAffiliateInviter(
  id: number
): Promise<AffiliateInviterDetail> {
  const res = await api.get<Response<AffiliateInviterDetail>>(
    `/api/user/affiliate/inviters/${id}`
  )
  return requireServerSuccess(res.data).data
}

export async function getAffiliateClaims(params: {
  page: number
  pageSize: number
  keyword: string
  /** Unix seconds; zero leaves the range open. */
  startTimestamp: number
}): Promise<AffiliateClaimPage> {
  const res = await api.get<Response<AffiliateClaimPage>>(
    '/api/user/affiliate/claims',
    {
      params: {
        p: params.page,
        page_size: params.pageSize,
        keyword: params.keyword,
        start_timestamp: params.startTimestamp,
      },
    }
  )
  return requireServerSuccess(res.data).data
}
