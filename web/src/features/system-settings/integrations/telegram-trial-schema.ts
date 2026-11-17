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
import { z } from 'zod'

export function createTelegramTrialSchema(t: TFunction) {
  const quota = z
    .number({ error: () => t('Please enter a valid amount') })
    .int({ error: () => t('Please enter a valid amount') })
    .min(0, { error: () => t('Must be greater than or equal to 0') })
    .max(Number.MAX_SAFE_INTEGER, { error: () => t('Amount is too large') })

  return z
    .object({
      enabled: z.boolean(),
      min_user_id: z
        .number({ error: () => t('Enter a positive whole-number user ID.') })
        .int({ error: () => t('Enter a positive whole-number user ID.') })
        .min(1, { error: () => t('Enter a positive whole-number user ID.') })
        .max(Number.MAX_SAFE_INTEGER, {
          error: () => t('Enter a positive whole-number user ID.'),
        }),
      quota,
      daily_limit: quota,
      total_limit: quota,
      require_membership: z.boolean(),
      chat_id: z
        .string()
        .trim()
        .max(64, {
          error: () =>
            t('Enter a Telegram group or channel username or numeric ID.'),
        }),
      join_url: z
        .string()
        .trim()
        .max(255, {
          error: () => t('Enter a valid https://t.me/ join link.'),
        }),
      version: z.number().int().nonnegative(),
    })
    .superRefine((values, context) => {
      if (values.enabled && values.quota <= 0) {
        context.addIssue({
          code: 'custom',
          path: ['quota'],
          message: t('Set a positive trial quota before enabling claims.'),
        })
      }
      if (values.enabled) {
        for (const field of ['daily_limit', 'total_limit'] as const) {
          if (values[field] <= 0 || values[field] < values.quota) {
            context.addIssue({
              code: 'custom',
              path: [field],
              message: t('The trial limit must cover at least one claim.'),
            })
          }
        }
      }
      if (!values.require_membership) return
      const isUsername = /^@[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(values.chat_id)
      const isChatNumber =
        /^-[1-9]\d{0,18}$/.test(values.chat_id) &&
        BigInt(values.chat_id) >= -9223372036854775808n
      if (!isUsername && !isChatNumber) {
        context.addIssue({
          code: 'custom',
          path: ['chat_id'],
          message: t(
            'Enter a Telegram group or channel username or numeric ID.'
          ),
        })
      }
      let validJoinURL = false
      try {
        const url = new URL(values.join_url)
        validJoinURL =
          values.join_url.startsWith('https://t.me/') &&
          url.protocol === 'https:' &&
          url.hostname === 't.me' &&
          url.pathname.length > 1 &&
          url.search === '' &&
          url.hash === '' &&
          url.username === '' &&
          url.password === '' &&
          url.port === ''
      } catch {
        validJoinURL = false
      }
      if (!validJoinURL) {
        context.addIssue({
          code: 'custom',
          path: ['join_url'],
          message: t('Enter a valid https://t.me/ join link.'),
        })
      }
    })
}

export type TelegramTrialValues = z.infer<
  ReturnType<typeof createTelegramTrialSchema>
>
