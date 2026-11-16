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
import type { TFunction } from 'i18next'

import {
  BALANCE_PAY_KEY,
  INVOICE_STATUS_META,
} from '@/features/invoice/lib/invoice'
import type { Invoice } from '@/features/invoice/types'
import { formatTimestampToDate } from '@/lib/format'

/** 单条和批量复制使用同一格式；金额保留服务端的人民币精度。 */
export function formatInvoiceCopy(invoice: Invoice, t: TFunction): string {
  const rows: [string, string][] = [
    [t('User ID'), String(invoice.user_id)],
    [t('Status'), t(INVOICE_STATUS_META[invoice.status].labelKey)],
    [
      t('Invoice type'),
      invoice.invoice_type === 'special'
        ? t('Special VAT invoice')
        : t('General VAT invoice'),
    ],
    [
      t('Title type'),
      invoice.title_type === 'company' ? t('Company') : t('Individual'),
    ],
    [t('Invoice title'), invoice.title],
    [t('Taxpayer identification number'), invoice.tax_no],
    [t('Registered address'), invoice.reg_address],
    [t('Registered phone'), invoice.reg_phone],
    [t('Bank name'), invoice.bank_name],
    [t('Bank account'), invoice.bank_account],
    [t('Product category'), invoice.category],
    [t('Email for the invoice'), invoice.email],
    [t('Order amount'), `¥${invoice.order_amount}`],
    [
      t('Tax ({{rate}}%)', { rate: invoice.tax_rate }),
      `¥${invoice.tax_amount}`,
    ],
    [t('Invoice amount'), `¥${invoice.invoice_amount}`],
    [t('Tax order number'), invoice.tax_trade_no ?? ''],
    [
      t('Payment method'),
      invoice.tax_payment_method === BALANCE_PAY_KEY
        ? t('Balance')
        : invoice.tax_payment_method,
    ],
    [t('Submitted at'), formatTimestampToDate(invoice.create_time)],
    [t('Tax paid at'), formatTimestampToDate(invoice.tax_paid_time)],
    [t('Issued at'), formatTimestampToDate(invoice.issued_time)],
    [t('Invoice file'), invoice.file_name],
    [t('Rejection reason'), invoice.reject_reason],
  ]

  return [
    t('Application #{{id}}', { id: invoice.id }),
    ...rows
      .filter(([, value]) => value !== '' && value !== '-')
      .map(([label, value]) => `${label}: ${value}`),
  ].join('\n')
}
