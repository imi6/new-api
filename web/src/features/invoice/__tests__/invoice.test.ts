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

import { parseDispositionFilename } from '../api'
import {
  formatCents,
  invoiceFormSchema,
  type InvoiceFormValues,
  payMethodKey,
  previewInvoiceAmounts,
  toCents,
} from '../lib/invoice'

const baseForm: InvoiceFormValues = {
  invoice_type: 'normal',
  title_type: 'personal',
  title: 'Example',
  tax_no: '',
  reg_address: '',
  reg_phone: '',
  bank_name: '',
  bank_account: '',
  category: 'Information technology service',
  email: 'user@example.com',
}

function issuePaths(values: InvoiceFormValues): string[] {
  const result = invoiceFormSchema.safeParse(values)
  if (result.success) return []
  return result.error.issues.map((issue) => issue.path.join('.'))
}

describe('invoice amount preview', () => {
  it('sums order amounts in cents', () => {
    expect(previewInvoiceAmounts(['10.10', '20.20'], 0)).toEqual({
      orderCents: 3030,
      taxCents: 0,
      invoiceCents: 3030,
    })
  })

  it('rounds the tax half away from zero to the cent', () => {
    // 0.25 × 6% = 0.015
    expect(previewInvoiceAmounts(['0.25'], 6).taxCents).toBe(2)
    // 33.33 × 6% = 1.9998
    expect(previewInvoiceAmounts(['33.33'], 6).taxCents).toBe(200)
    // 0.05 × 6% = 0.003
    expect(previewInvoiceAmounts(['0.05'], 6).taxCents).toBe(0)
  })

  it('adds the tax to the invoice amount', () => {
    const preview = previewInvoiceAmounts(['100.00'], 6)
    expect(formatCents(preview.taxCents)).toBe('6.00')
    expect(formatCents(preview.invoiceCents)).toBe('106.00')
  })

  it('treats unparsable amounts and rates as zero', () => {
    expect(toCents('abc')).toBe(0)
    expect(previewInvoiceAmounts(['1.00'], Number.NaN).taxCents).toBe(0)
  })
})

describe('invoice form schema', () => {
  it('accepts a personal general invoice without a tax number', () => {
    expect(issuePaths(baseForm)).toEqual([])
  })

  it('requires a tax number for a company title', () => {
    expect(issuePaths({ ...baseForm, title_type: 'company' })).toEqual([
      'tax_no',
    ])
  })

  it('requires the bank details for a special invoice', () => {
    expect(
      issuePaths({
        ...baseForm,
        invoice_type: 'special',
        title_type: 'company',
        tax_no: '91110000000000000X',
      })
    ).toEqual(['reg_address', 'reg_phone', 'bank_name', 'bank_account'])
  })

  it('rejects an invalid email and a blank title', () => {
    expect(
      issuePaths({ ...baseForm, title: '  ', email: 'not-an-email' })
    ).toEqual(['title', 'email'])
  })
})

describe('invoice helpers', () => {
  it('keys pay methods by gateway and type', () => {
    expect(
      payMethodKey({ name: 'Alipay', type: 'alipay', gateway: 'site-b' })
    ).toBe('site-b:alipay')
  })

  it('reads plain and RFC 5987 file names', () => {
    expect(parseDispositionFilename('attachment; filename="a.pdf"')).toBe(
      'a.pdf'
    )
    expect(
      parseDispositionFilename(
        "attachment; filename*=utf-8''%E5%8F%91%E7%A5%A8.pdf"
      )
    ).toBe('发票.pdf')
    expect(parseDispositionFilename(undefined)).toBe('')
  })
})
