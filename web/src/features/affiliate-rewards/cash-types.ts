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
import type { AffiliateWithdrawal } from '@/features/affiliate-cash/types'

export type AffiliateWithdrawalActionName =
  | 'approve'
  | 'reject'
  | 'start'
  | 'complete'
  | 'fail_release'
  | 'fail_retry'
  | 'correct'

export type AffiliateWithdrawalAction = {
  action: AffiliateWithdrawalActionName
  request_id: string
  expected_version: number
  reason?: string
  transaction_id?: string
  actual_amount?: string
  network?: string
  address?: string
  unpaid_confirmed?: boolean
}

export type AffiliateWithdrawalAttempt = {
  id: number
  operator_id: number
  created_at: number
  status: string
  transaction_id: string
  actual_amount: string
  network: string
  address: string
  reason: string
}

export type AffiliateWithdrawalCorrection = {
  id: number
  operator_id: number
  created_at: number
  reason: string
}

export type AffiliateWithdrawalDetail = {
  withdrawal: AffiliateWithdrawal
  attempts: AffiliateWithdrawalAttempt[]
  corrections: AffiliateWithdrawalCorrection[]
}

// 状态仅决定可见操作，最终状态转换与余额校验始终由服务端执行。
export function withdrawalActions(
  status: string
): AffiliateWithdrawalActionName[] {
  switch (status) {
    case 'pending':
      return ['approve', 'reject']
    case 'approved':
      return ['start', 'reject']
    case 'paying':
      return ['complete', 'fail_release', 'fail_retry']
    case 'completed':
      return ['correct']
    default:
      return []
  }
}
