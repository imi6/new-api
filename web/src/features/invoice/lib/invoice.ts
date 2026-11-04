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
import { z } from 'zod'

import type { StatusVariant } from '@/components/status-badge'

import type {
  InvoiceOrder,
  InvoiceOrderRef,
  InvoiceOrderType,
  InvoicePayMethod,
  InvoiceStatus,
} from '../types'

// Field limits match model.InvoiceInput.Normalize on the server.
export const INVOICE_TITLE_MAX = 100
export const INVOICE_TAX_NO_MAX = 30
export const INVOICE_REG_ADDRESS_MAX = 200
export const INVOICE_REG_PHONE_MAX = 30
export const INVOICE_BANK_NAME_MAX = 100
export const INVOICE_BANK_ACCOUNT_MAX = 50
export const INVOICE_EMAIL_MAX = 100

/**
 * Form schema for the invoice details. Messages are locale keys; FormMessage
 * translates them. The server checks the same rules again on submit.
 */
export const invoiceFormSchema = z
  .object({
    invoice_type: z.enum(['normal', 'special']),
    title_type: z.enum(['company', 'personal']),
    title: z
      .string()
      .trim()
      .min(1, 'Enter the invoice title')
      .max(INVOICE_TITLE_MAX, 'The invoice title is too long'),
    tax_no: z
      .string()
      .trim()
      .max(INVOICE_TAX_NO_MAX, 'The taxpayer identification number is too long'),
    reg_address: z.string().trim().max(INVOICE_REG_ADDRESS_MAX, 'Too long'),
    reg_phone: z.string().trim().max(INVOICE_REG_PHONE_MAX, 'Too long'),
    bank_name: z.string().trim().max(INVOICE_BANK_NAME_MAX, 'Too long'),
    bank_account: z.string().trim().max(INVOICE_BANK_ACCOUNT_MAX, 'Too long'),
    category: z.string().min(1, 'Select a product category'),
    email: z
      .string()
      .trim()
      .max(INVOICE_EMAIL_MAX, 'Invalid email address')
      .pipe(z.email('Invalid email address')),
  })
  .superRefine((value, ctx) => {
    const company =
      value.invoice_type === 'special' || value.title_type === 'company'
    if (company && value.tax_no === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['tax_no'],
        message: 'Enter the taxpayer identification number',
      })
    }
    if (value.invoice_type !== 'special') return
    const required = [
      'reg_address',
      'reg_phone',
      'bank_name',
      'bank_account',
    ] as const
    for (const field of required) {
      if (value[field] === '') {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: 'Required for a special VAT invoice',
        })
      }
    }
  })

export type InvoiceFormValues = z.infer<typeof invoiceFormSchema>

/** Two-decimal CNY text to integer cents. Unparsable text counts as zero. */
export function toCents(amount: string): number {
  const value = Number(amount)
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100)
}

export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2)
}

export interface InvoiceAmountPreview {
  orderCents: number
  taxCents: number
  invoiceCents: number
}

/**
 * Preview of model.CalculateInvoiceAmounts: sum, then the tax rounded half
 * away from zero to the cent. The invoice is issued for the order total and
 * the tax is paid on top. Display only; the server recomputes on submit.
 */
export function previewInvoiceAmounts(
  amounts: string[],
  taxRatePercent: number
): InvoiceAmountPreview {
  const orderCents = amounts.reduce((sum, amount) => sum + toCents(amount), 0)
  const rate = Number.isFinite(taxRatePercent) ? taxRatePercent : 0
  // Round the product first so 33.33 × 6% does not land on 199.99999.
  const exact = Math.round(orderCents * rate * 1e6) / 1e8
  const taxCents = Math.round(exact)
  return { orderCents, taxCents, invoiceCents: orderCents }
}

export function orderKey(order: InvoiceOrderRef): string {
  return `${order.order_type}:${order.order_id}`
}

export function toOrderRef(order: InvoiceOrder): InvoiceOrderRef {
  return { order_type: order.order_type, order_id: order.order_id }
}

/** Pay methods of different Epay gateways can share a type, so key by both. */
export function payMethodKey(method: InvoicePayMethod): string {
  return `${method.gateway}:${method.type}`
}

export const ORDER_TYPE_LABEL_KEYS: Record<InvoiceOrderType, string> = {
  topup: 'Top-up',
  subscription: 'Subscription',
  redemption: 'Redemption code',
}

export const INVOICE_STATUS_META: Record<
  InvoiceStatus,
  { labelKey: string; variant: StatusVariant }
> = {
  pending_payment: { labelKey: 'Awaiting tax payment', variant: 'warning' },
  pending_review: { labelKey: 'Under review', variant: 'info' },
  issued: { labelKey: 'Invoice issued', variant: 'success' },
  rejected: { labelKey: 'Invoice rejected', variant: 'danger' },
  cancelled: { labelKey: 'Cancelled', variant: 'neutral' },
}

export const INVOICE_STATUS_FILTERS = [
  'pending_payment',
  'pending_review',
  'issued',
  'rejected',
  'cancelled',
] as const satisfies readonly InvoiceStatus[]
