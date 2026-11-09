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
export type AffiliateCashDestination = 'platform' | 'u'
export type AffiliateWithdrawalStatus =
  | 'pending'
  | 'approved'
  | 'paying'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'failed'

export interface AffiliateCashNetwork {
  id: string
  name: string
  address_kind: 'evm' | 'tron'
  enabled: boolean
}

export interface AffiliateCashConfig {
  exchange_enabled: boolean
  withdrawal_enabled: boolean
  exchange_rate: string
  minimum_withdrawal: string
  fee_mode: '' | 'fixed' | 'percent' | 'both'
  fee_fixed: string
  fee_percent: string
  minimum_basis: '' | 'requested' | 'net'
  cancel_fee_policy: '' | 'refund' | 'retain'
  failed_fee_policy: '' | 'refund' | 'retain'
  networks: AffiliateCashNetwork[]
  version: string
  currency: 'USDT'
  precision: 6
}

export interface AffiliateCashSummary {
  rebate_unclaimed_quota: number
  max_platform_claim_quota: number
  max_u_exchange_quota: number
  u_available: string
  u_frozen: string
  pending_withdrawals: number
  can_exchange: boolean
  can_withdraw: boolean
  platform_reason: string
  exchange_reason: string
  withdrawal_reason: string
  config: AffiliateCashConfig
}

export interface AffiliateCashPage<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface AffiliateExchangePreview {
  quota: number
  destination: AffiliateCashDestination
  u_amount: string
  exchange_rate: string
  config_version: string
  minimum_withdrawal: string
  can_submit: boolean
  reason: string
}

export interface AffiliateExchangeRequest {
  quota: number
  destination: AffiliateCashDestination
  request_id: string
  config_version: string
  confirmed: boolean
}

export interface AffiliateWithdrawalInput {
  amount: string
  network: string
  address: string
}

export interface AffiliateWithdrawalPreview extends AffiliateWithdrawalInput {
  fee: string
  net_amount: string
  config_version: string
  cancel_fee_policy: 'refund' | 'retain'
  failed_fee_policy: 'refund' | 'retain'
  can_submit: boolean
  reason: string
}

export interface AffiliateWithdrawalRequest extends AffiliateWithdrawalInput {
  request_id: string
  config_version: string
}

export interface AffiliateWithdrawal {
  id: number
  version: number
  user_id: number
  amount: string
  fee: string
  net_amount: string
  network: string
  address: string
  status: AffiliateWithdrawalStatus
  config_version: string
  created_at: number
  updated_at: number
  paid_at: number
  reason: string
  transaction_id: string
  actual_amount?: string
  actual_fee?: string
  refunded_amount?: string
  cancel_fee_policy: 'refund' | 'retain'
  failed_fee_policy: 'refund' | 'retain'
}

export interface AffiliateCashLedgerEntry {
  id: number
  kind: string
  quota: number
  u_amount: string
  exchange_rate: string
  created_at: number
  request_id: string
  reason: string
}
