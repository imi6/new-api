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

import type { Invoice } from '@/features/invoice/types'

/** 单条和批量仅复制开票所需的五项信息；金额保留服务端的人民币精度。 */
export function formatInvoiceCopy(invoice: Invoice, t: TFunction): string {
  const rows: [string, string][] = [
    [
      t('Title type'),
      invoice.title_type === 'company' ? t('Company') : t('Individual'),
    ],
    [t('Invoice title'), invoice.title],
    [t('Taxpayer identification number'), invoice.tax_no],
    [t('Product category'), invoice.category],
    [t('Invoice amount'), `¥${invoice.invoice_amount}`],
  ]

  return rows
    .filter(([, value]) => value !== '' && value !== '-')
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n')
}
