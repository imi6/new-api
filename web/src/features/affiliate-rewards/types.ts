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

/** Site totals of referral rewards. Amounts are quota units. */
export type AffiliateSummary = {
  inviters: number
  invitees: number
  /** The inviters' share of the signup bonus. */
  signup_reward: number
  accrued: number
  claimed: number
  unclaimed: number
  /** Users who claimed rebate at least once. */
  claimers: number
  /** Inviters with a special ratio earn no rebate now. */
  exclude_special_ratio: boolean
}

/** One inviter in the ranking. */
export type AffiliateInviter = {
  user_id: number
  username: string
  display_name: string
  group: string
  invitee_count: number
  signup_reward: number
  /** The invitees' paid consumption. */
  invitee_paid: number
  accrued: number
  claimed: number
  unclaimed: number
  last_claim_at: number
  /** The inviter's group has a special ratio rule. */
  special_ratio: boolean
}

export type AffiliateInviterSortBy =
  | 'accrued'
  | 'invitees'
  | 'claimed'
  | 'unclaimed'
  | 'paid'
  | 'signup'

export type AffiliateInviterPage = {
  page: number
  page_size: number
  total: number
  items: AffiliateInviter[]
}

export type AffiliateInvitee = {
  user_id: number
  username: string
  display_name: string
  group: string
  paid_consumed: number
  rebate: number
  created_at: number
}

export type AffiliateClaim = {
  id: number
  user_id: number
  username?: string
  display_name?: string
  quota: number
  created_at: number
}

/** One inviter's invitees and claims, each capped at limit. */
export type AffiliateInviterDetail = {
  invitee_total: number
  invitees: AffiliateInvitee[]
  claim_total: number
  claims: AffiliateClaim[]
  limit: number
}

export type AffiliateClaimPage = {
  page: {
    page: number
    page_size: number
    total: number
    items: AffiliateClaim[]
  }
  /** The sum of the matching claims. */
  sum: number
}
