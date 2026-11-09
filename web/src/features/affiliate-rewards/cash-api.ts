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
import type {
  AffiliateCashConfig,
  AffiliateCashPage,
  AffiliateWithdrawal,
} from '@/features/affiliate-cash/types'
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import type {
  AffiliateWithdrawalAction,
  AffiliateWithdrawalDetail,
} from './cash-types'

type Response<T> = { success: boolean; message?: string; data: T }
const base = '/api/user/affiliate/cash'

export type AffiliateCashTotals = {
  completed_net_amount: string
  completed_fee: string
  u_available_total: string
  u_frozen_total: string
}

export async function getAffiliateCashTotals(): Promise<AffiliateCashTotals> {
  const response = await api.get<Response<AffiliateCashTotals>>(
    `${base}/summary`
  )
  return requireServerSuccess(response.data).data
}

export async function getAffiliateCashSettings(): Promise<AffiliateCashConfig> {
  const response = await api.get<Response<AffiliateCashConfig>>(
    `${base}/settings`
  )
  return requireServerSuccess(response.data).data
}

export async function updateAffiliateCashSettings(
  settings: AffiliateCashConfig
): Promise<AffiliateCashConfig> {
  const response = await api.put<Response<AffiliateCashConfig>>(
    `${base}/settings`,
    settings
  )
  return requireServerSuccess(response.data).data
}

export async function getAffiliateWithdrawals(params: {
  page: number
  pageSize: number
  status: string
}): Promise<AffiliateCashPage<AffiliateWithdrawal>> {
  const response = await api.get<
    Response<AffiliateCashPage<AffiliateWithdrawal>>
  >(`${base}/withdrawals`, {
    params: {
      p: params.page,
      page_size: params.pageSize,
      status: params.status || undefined,
    },
  })
  return requireServerSuccess(response.data).data
}

export async function getAffiliateWithdrawal(
  id: number
): Promise<AffiliateWithdrawalDetail> {
  const response = await api.get<Response<AffiliateWithdrawalDetail>>(
    `${base}/withdrawals/${id}`
  )
  return requireServerSuccess(response.data).data
}

export async function updateAffiliateWithdrawal(
  id: number,
  action: AffiliateWithdrawalAction
): Promise<AffiliateWithdrawal> {
  const response = await api.post<Response<AffiliateWithdrawal>>(
    `${base}/withdrawals/${id}/action`,
    action
  )
  return requireServerSuccess(response.data).data
}
