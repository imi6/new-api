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

// U 金额使用服务端十进制字符串，显示时不经过浮点换算或平台汇率。
export function formatUAmount(value: string | undefined): string {
  if (!value || !/^-?\d+(\.\d{1,6})?$/.test(value)) return '—'
  const [whole, fraction] = value.split('.')
  const trimmed = fraction?.replace(/0+$/, '')
  return `${whole}${trimmed ? `.${trimmed}` : ''} U`
}

export const affiliateWithdrawalSchema = z.object({
  amount: z
    .string()
    .trim()
    .regex(
      /^(0|[1-9][0-9]{0,9})(\.[0-9]{1,6})?$/,
      'Enter a valid U amount with up to six decimal places'
    )
    .refine((value) => /[1-9]/.test(value), 'Amount must be greater than zero'),
  network: z.string().min(1, 'Select a withdrawal network'),
  address: z
    .string()
    .trim()
    .min(1, 'Enter the receiving address')
    .refine(
      (value) => [...value].length <= 128,
      'The receiving address is too long'
    ),
})

export type AffiliateWithdrawalValues = z.infer<
  typeof affiliateWithdrawalSchema
>
