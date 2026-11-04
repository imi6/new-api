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

// Ranges match operation_setting.ValidateInvoiceSettingOption on the server.
export const INVOICE_SETTING_LIMITS = {
  taxRate: { min: 0, max: 100 },
  orderDays: { min: 1, max: 3650 },
  paymentTimeoutMinutes: { min: 5, max: 1440 },
  fileMaxKB: { min: 10, max: 20480 },
  maxCategories: 50,
  maxCategoryLength: 100,
} as const

function rangedNumber(
  limits: { min: number; max: number },
  message: string,
  integer: boolean
) {
  const base = z
    .number(message)
    .min(limits.min, message)
    .max(limits.max, message)
  return integer ? base.int(message) : base
}

/**
 * Messages are locale keys; FormMessage translates them. The server checks
 * the same ranges again when each option is saved.
 */
export const invoiceSettingsSchema = z
  .object({
    invoice_setting: z.object({
      enabled: z.boolean(),
      normal_enabled: z.boolean(),
      special_enabled: z.boolean(),
      tax_rate: rangedNumber(
        INVOICE_SETTING_LIMITS.taxRate,
        'Enter a tax rate between 0 and 100',
        false
      ),
      special_tax_rate: rangedNumber(
        INVOICE_SETTING_LIMITS.taxRate,
        'Enter a tax rate between 0 and 100',
        false
      ),
      order_days: rangedNumber(
        INVOICE_SETTING_LIMITS.orderDays,
        'Enter a whole number of days between 1 and 3650',
        true
      ),
      payment_timeout_minutes: rangedNumber(
        INVOICE_SETTING_LIMITS.paymentTimeoutMinutes,
        'Enter a whole number of minutes between 5 and 1440',
        true
      ),
      file_max_kb: rangedNumber(
        INVOICE_SETTING_LIMITS.fileMaxKB,
        'Enter a whole number of KB between 10 and 20480',
        true
      ),
      categories: z.string().superRefine((value, ctx) => {
        // Non-blank, trimmed lines, the same way the server reads them.
        const categories = value
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== '')
        if (categories.length === 0) {
          ctx.addIssue({
            code: 'custom',
            message: 'Enter at least one product category',
          })
          return
        }
        if (categories.length > INVOICE_SETTING_LIMITS.maxCategories) {
          ctx.addIssue({
            code: 'custom',
            message: 'Enter at most 50 product categories',
          })
        }
        if (
          categories.some(
            (category) =>
              [...category].length > INVOICE_SETTING_LIMITS.maxCategoryLength
          )
        ) {
          ctx.addIssue({
            code: 'custom',
            message: 'Each product category can have at most 100 characters',
          })
        }
      }),
    }),
  })
  .superRefine((value, ctx) => {
    const types = value.invoice_setting
    if (types.normal_enabled || types.special_enabled) return
    ctx.addIssue({
      code: 'custom',
      path: ['invoice_setting', 'special_enabled'],
      message: 'Open at least one invoice type',
    })
  })

export type InvoiceSettingsValues = z.infer<typeof invoiceSettingsSchema>
