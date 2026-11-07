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

export type PartnerContactType = 'wechat' | 'telegram' | 'qq' | 'email' | 'other'

export const PARTNER_CONTACT_TYPES: PartnerContactType[] = [
  'wechat',
  'telegram',
  'qq',
  'email',
  'other',
]

export const PARTNER_CONTACT_LABEL_KEYS: Record<PartnerContactType, string> = {
  wechat: 'WeChat',
  telegram: 'Telegram',
  qq: 'QQ',
  email: 'Email',
  other: 'Other',
}

export type PartnerStatus = 'pending' | 'contacted' | 'connected' | 'rejected'

export const PARTNER_STATUSES: PartnerStatus[] = [
  'pending',
  'contacted',
  'connected',
  'rejected',
]

export const PARTNER_STATUS_META: Record<
  PartnerStatus,
  { labelKey: string; variant: 'neutral' | 'info' | 'success' | 'danger' }
> = {
  pending: { labelKey: 'Not handled', variant: 'neutral' },
  contacted: { labelKey: 'Contacted', variant: 'info' },
  connected: { labelKey: 'Connected', variant: 'success' },
  rejected: { labelKey: 'Not suitable', variant: 'danger' },
}

export type PartnerConfig = {
  max_offers_per_site: number
  /** Replaces the default intro when set. */
  intro: string
  contact_types: PartnerContactType[]
}

export type PartnerOfferInput = {
  group_name: string
  channel_type: number
  ratio: number
  models: string[]
  description: string
}

export type PartnerSiteInput = {
  site_name: string
  site_url: string
  contact_type: PartnerContactType
  contact: string
  remark: string
  offers: PartnerOfferInput[]
}

export type PartnerOffer = {
  id: number
  site_id: number
  group_name: string
  channel_type: number
  ratio: number
  /** Comma separated. */
  models: string
  description: string
}

/** A submission as its submitter sees it, read only. */
export type PartnerSite = {
  id: number
  site_name: string
  site_url: string
  contact_type: PartnerContactType
  contact: string
  remark: string
  created_at: number
  offers: PartnerOffer[]
}

/** One offer in the administrator's table, with its site. */
export type PartnerOfferRow = {
  offer_id: number
  group_name: string
  channel_type: number
  ratio: number
  models: string
  description: string
  site_id: number
  site_name: string
  site_url: string
  contact_type: PartnerContactType
  contact: string
  remark: string
  submit_ip: string
  admin_status: PartnerStatus
  admin_note: string
  created_at: number
  /** Zero for a visitor who was not signed in. */
  user_id: number
  username: string | null
}

export type PartnerOfferPage = {
  page: number
  page_size: number
  total: number
  items: PartnerOfferRow[]
}
