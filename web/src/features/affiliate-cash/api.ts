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
import {
  getServerErrorSources,
  requireServerSuccess,
} from '@/lib/server-error-message'

import type {
  AffiliateCashDestination,
  AffiliateCashLedgerEntry,
  AffiliateCashPage,
  AffiliateCashSummary,
  AffiliateExchangePreview,
  AffiliateExchangeRequest,
  AffiliateWithdrawal,
  AffiliateWithdrawalInput,
  AffiliateWithdrawalPreview,
  AffiliateWithdrawalRequest,
} from './types'

export const AFFILIATE_CASH_QUERY_KEY = ['affiliate-cash'] as const
const base = '/api/user/affiliate_cash'

export function isStaleAffiliateWithdrawal(error: unknown): boolean {
  const key = 'The withdrawal state changed. Refresh and try again'
  return getServerErrorSources(error).some(
    (source) => source.message_key === key || source.message === key
  )
}

export async function getAffiliateCash(
  signal?: AbortSignal
): Promise<AffiliateCashSummary> {
  const response = await api.get(base, { signal })
  return requireServerSuccess(response.data).data
}

export async function previewAffiliateExchange(input: {
  quota: number
  destination: AffiliateCashDestination
}): Promise<AffiliateExchangePreview> {
  const response = await api.post(`${base}/exchange/preview`, input)
  return requireServerSuccess(response.data).data
}

export async function exchangeAffiliateRebate(
  input: AffiliateExchangeRequest
): Promise<unknown> {
  const response = await api.post(`${base}/exchange`, input)
  return requireServerSuccess(response.data).data
}

export async function getAffiliateCashLedger(
  page = 1,
  signal?: AbortSignal
): Promise<AffiliateCashPage<AffiliateCashLedgerEntry>> {
  const response = await api.get(`${base}/ledger`, {
    params: { p: page, page_size: 10 },
    signal,
  })
  return requireServerSuccess(response.data).data
}

export async function previewAffiliateWithdrawal(
  input: AffiliateWithdrawalInput
): Promise<AffiliateWithdrawalPreview> {
  const response = await api.post(`${base}/withdrawals/preview`, input)
  return requireServerSuccess(response.data).data
}

export async function createAffiliateWithdrawal(
  input: AffiliateWithdrawalRequest
): Promise<AffiliateWithdrawal> {
  const response = await api.post(`${base}/withdrawals`, input)
  return requireServerSuccess(response.data).data
}

export async function getAffiliateWithdrawals(
  page = 1,
  signal?: AbortSignal
): Promise<AffiliateCashPage<AffiliateWithdrawal>> {
  const response = await api.get(`${base}/withdrawals`, {
    params: { p: page, page_size: 10 },
    signal,
  })
  return requireServerSuccess(response.data).data
}

export async function cancelAffiliateWithdrawal(
  id: number,
  requestID: string,
  expectedVersion: number
): Promise<AffiliateWithdrawal> {
  const response = await api.post(`${base}/withdrawals/${id}/cancel`, {
    request_id: requestID,
    expected_version: expectedVersion,
  })
  return requireServerSuccess(response.data).data
}
