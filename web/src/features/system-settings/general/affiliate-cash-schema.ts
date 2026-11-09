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
import i18next from 'i18next'
import { z } from 'zod'

const maximumCashUnits = 9_007_199_254_740_991n

function parseCashUnits(value: string): bigint | null {
  if (!/^(0|[1-9][0-9]{0,9})(\.[0-9]{1,6})?$/.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
}

const amount = z
  .string()
  .refine(
    (value) =>
      value === '' || /^(0|[1-9][0-9]{0,9})(\.[0-9]{1,6})?$/.test(value),
    {
      error: () =>
        i18next.t('Enter a non-negative amount with up to six decimal places'),
    }
  )
  .refine(
    (value) => {
      const units = parseCashUnits(value)
      return units === null || units <= maximumCashUnits
    },
    { error: () => i18next.t('The U amount exceeds the account limit') }
  )

export const affiliateCashSettingsSchema = z
  .object({
    exchange_enabled: z.boolean(),
    withdrawal_enabled: z.boolean(),
    exchange_rate: amount,
    minimum_withdrawal: amount,
    fee_mode: z.enum(['', 'fixed', 'percent', 'both']),
    fee_fixed: amount,
    fee_percent: amount,
    minimum_basis: z.enum(['', 'requested', 'net']),
    cancel_fee_policy: z.enum(['', 'refund', 'retain']),
    failed_fee_policy: z.enum(['', 'refund', 'retain']),
    currency: z.literal('USDT'),
    precision: z.literal(6),
    version: z.string(),
    networks: z
      .array(
        z.object({
          id: z
            .string()
            .refine((value) => /^[a-zA-Z0-9_-]{1,32}$/.test(value), {
              error: () =>
                i18next.t(
                  'Use 1-32 letters, digits, hyphens or underscores for the network identifier'
                ),
            }),
          name: z
            .string()
            .trim()
            .min(1, { error: () => i18next.t('Please enter a network name') })
            .max(80, {
              error: () =>
                i18next.t('Network names cannot exceed 80 characters'),
            }),
          address_kind: z.enum(['evm', 'tron']),
          enabled: z.boolean(),
        })
      )
      .max(20, {
        error: () => i18next.t('At most 20 payout networks are supported'),
      }),
  })
  .superRefine((value, context) => {
    const enabled = value.exchange_enabled || value.withdrawal_enabled
    const selected = [
      'fee_mode',
      'minimum_basis',
      'cancel_fee_policy',
      'failed_fee_policy',
    ] as const
    if (enabled) {
      for (const key of selected) {
        if (!value[key]) {
          context.addIssue({
            code: 'custom',
            path: [key],
            message: i18next.t('Select a policy before enabling withdrawals'),
          })
        }
      }
      for (const key of ['exchange_rate', 'minimum_withdrawal'] as const) {
        if (key === 'exchange_rate' && !value.exchange_enabled) continue
        if ((parseCashUnits(value[key]) ?? 0n) <= 0n) {
          context.addIssue({
            code: 'custom',
            path: [key],
            message: i18next.t('Must be greater than 0'),
          })
        }
      }
      if (
        (value.fee_mode === 'fixed' || value.fee_mode === 'both') &&
        value.fee_fixed === ''
      ) {
        context.addIssue({
          code: 'custom',
          path: ['fee_fixed'],
          message: i18next.t('Please enter a valid number'),
        })
      }
      if (
        (value.fee_mode === 'percent' || value.fee_mode === 'both') &&
        value.fee_percent === ''
      ) {
        context.addIssue({
          code: 'custom',
          path: ['fee_percent'],
          message: i18next.t('Please enter a valid number'),
        })
      }
      if (
        value.withdrawal_enabled &&
        value.networks.some((network) => network.enabled)
      ) {
        const fixed =
          value.fee_mode === 'percent' ? 0n : parseCashUnits(value.fee_fixed)
        const percent =
          value.fee_mode === 'fixed' ? 0n : parseCashUnits(value.fee_percent)
        const minimum = parseCashUnits(value.minimum_withdrawal)
        if (fixed !== null && percent !== null && minimum !== null) {
          // 与服务端相同：最小 U 单位整数计算，比例手续费向下取整。
          const maximumNet =
            maximumCashUnits -
            fixed -
            (maximumCashUnits * percent) / 100_000_000n
          if (
            maximumNet <= 0n ||
            (value.minimum_basis === 'net' && maximumNet < minimum)
          ) {
            context.addIssue({
              code: 'custom',
              path: ['fee_mode'],
              message: i18next.t(
                'The withdrawal fee and minimum must allow a positive payout within the account limit'
              ),
            })
          }
        }
      }
    }
    if ((parseCashUnits(value.fee_percent) ?? 0n) > 100_000_000n) {
      context.addIssue({
        code: 'custom',
        path: ['fee_percent'],
        message: i18next.t('Fee percentage cannot exceed 100'),
      })
    }
    if (
      new Set(value.networks.map((network) => network.id)).size !==
      value.networks.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['networks'],
        message: i18next.t('Network identifiers must be unique'),
      })
    }
  })

export type AffiliateCashSettingsValues = z.infer<
  typeof affiliateCashSettingsSchema
>
