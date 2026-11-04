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

export type InvoiceStatus =
  | 'pending_payment'
  | 'pending_review'
  | 'issued'
  | 'rejected'
  | 'cancelled'

export type InvoiceType = 'normal' | 'special'
export type InvoiceTitleType = 'company' | 'personal'
export type InvoiceOrderType = 'topup' | 'subscription' | 'redemption'

export interface ApiResponse<T = unknown> {
  success?: boolean
  message?: string
  data?: T
}

export interface InvoicePayMethod {
  name: string
  type: string
  color?: string
  gateway: string
}

export interface InvoiceConfig {
  enabled: boolean
  /** Percent for a general VAT invoice. */
  tax_rate: number
  /** Percent for a special VAT invoice. */
  special_tax_rate: number
  order_days: number
  categories: string[]
  normal_enabled: boolean
  special_enabled: boolean
  payment_timeout: number
  max_orders: number
  pay_methods: InvoicePayMethod[]
}

export interface InvoiceSummaryCard {
  amount: string
  count: number
}

export interface InvoiceSummary {
  available: InvoiceSummaryCard
  processing: InvoiceSummaryCard
  issued: InvoiceSummaryCard
}

/** An order the user can include in an application. Amounts are CNY text. */
export interface InvoiceOrder {
  order_type: InvoiceOrderType
  order_id: number
  trade_no: string
  amount: string
  order_time: number
}

export interface Invoice {
  id: number
  user_id: number
  status: InvoiceStatus
  invoice_type: InvoiceType
  title_type: InvoiceTitleType
  title: string
  tax_no: string
  reg_address: string
  reg_phone: string
  bank_name: string
  bank_account: string
  category: string
  email: string
  order_amount: string
  tax_rate: string
  tax_amount: string
  invoice_amount: string
  tax_trade_no: string | null
  tax_payment_method: string
  tax_gateway: string
  tax_paid_time: number
  reject_reason: string
  file_name: string
  file_size: number
  file_mime: string
  create_time: number
  update_time: number
  issued_time: number
}

export interface InvoiceItem {
  id: number
  invoice_id: number
  order_type: InvoiceOrderType
  order_id: number
  trade_no: string
  amount: string
  order_time: number
}

export interface InvoiceDetail {
  invoice: Invoice
  items: InvoiceItem[]
}

export interface InvoicePage {
  page: number
  page_size: number
  total: number
  items: Invoice[] | null
}

export interface InvoiceOrderRef {
  order_type: InvoiceOrderType
  order_id: number
}

export interface CreateInvoiceRequest {
  invoice_type: InvoiceType
  title_type: InvoiceTitleType
  title: string
  tax_no: string
  reg_address: string
  reg_phone: string
  bank_name: string
  bank_account: string
  category: string
  email: string
  orders: InvoiceOrderRef[]
  payment_method: string
  gateway: string
}

/** Epay checkout returned when tax is due: a form POST target and its fields. */
export interface InvoicePaymentLaunch {
  url?: string
  params?: Record<string, string>
}

export type CreateInvoiceResponse = InvoiceDetail & InvoicePaymentLaunch
