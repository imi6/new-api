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
import { describe, expect, it } from 'vitest'

import {
  invoiceSettingsSchema,
  parseInvoiceCategories,
  type InvoiceSettingsValues,
} from '../general/invoice-settings-schema'

const validSettings: InvoiceSettingsValues['invoice_setting'] = {
  enabled: true,
  special_enabled: true,
  tax_rate: 6,
  order_days: 30,
  payment_timeout_minutes: 30,
  file_max_kb: 100,
  categories: '*生产生活服务*软件开发服务',
}

function issueMessages(
  overrides: Partial<InvoiceSettingsValues['invoice_setting']>
): string[] {
  const result = invoiceSettingsSchema.safeParse({
    invoice_setting: { ...validSettings, ...overrides },
  })
  if (result.success) return []
  return result.error.issues.map((issue) => issue.message)
}

describe('invoice settings schema', () => {
  it('accepts the default settings', () => {
    expect(issueMessages({})).toEqual([])
  })

  it('accepts the range bounds the server accepts', () => {
    expect(
      issueMessages({
        tax_rate: 0,
        order_days: 3650,
        payment_timeout_minutes: 5,
        file_max_kb: 20480,
      })
    ).toEqual([])
  })

  it('rejects values outside the server ranges', () => {
    expect(issueMessages({ tax_rate: 100.01 })).toEqual([
      'Enter a tax rate between 0 and 100',
    ])
    expect(issueMessages({ payment_timeout_minutes: 4 })).toEqual([
      'Enter a whole number of minutes between 5 and 1440',
    ])
    expect(issueMessages({ file_max_kb: 20481 })).toEqual([
      'Enter a whole number of KB between 10 and 20480',
    ])
  })

  it('rejects a fractional number of days', () => {
    expect(issueMessages({ order_days: 1.5 })).toEqual([
      'Enter a whole number of days between 1 and 3650',
    ])
  })

  it('requires at least one non-blank category', () => {
    expect(issueMessages({ categories: ' \n\n ' })).toEqual([
      'Enter at least one product category',
    ])
  })

  it('rejects a category longer than 100 characters', () => {
    expect(issueMessages({ categories: '服'.repeat(101) })).toEqual([
      'Each product category can have at most 100 characters',
    ])
  })
})

describe('parseInvoiceCategories', () => {
  it('trims lines and drops blank ones', () => {
    expect(parseInvoiceCategories(' a \n\n b\r\n')).toEqual(['a', 'b'])
  })
})
