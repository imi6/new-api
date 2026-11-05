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

import type { IntelligenceCheckSettings } from './defaults'

// Ranges match operation_setting.ValidateIntelligenceCheckSettingOption.
export const INTELLIGENCE_CHECK_LIMITS = {
  interval: { min: 1, max: 168 },
  maxTokens: { min: 256, max: 65536 },
  prompt: 8000,
  answer: 64,
  targets: 50,
} as const

export interface IntelligenceCheckTarget {
  group: string
  model: string
  /** Ask the candy question in this group. */
  candy: boolean
  /** Ask for the pelican drawing in this group. */
  pelican: boolean
}

function rangedInt(limits: { min: number; max: number }, message: string) {
  return z
    .number(message)
    .int(message)
    .min(limits.min, message)
    .max(limits.max, message)
}

/** Messages are locale keys; FormMessage translates them. */
export const intelligenceCheckSchema = z
  .object({
    enabled: z.boolean(),
    targets: z
      .array(
        z.object({
          group: z.string(),
          model: z.string(),
          candy: z.boolean(),
          pelican: z.boolean(),
        })
      )
      .max(INTELLIGENCE_CHECK_LIMITS.targets, 'Check at most 50 groups'),
    candy_enabled: z.boolean(),
    candy_interval_hours: rangedInt(
      INTELLIGENCE_CHECK_LIMITS.interval,
      'Enter a whole number of hours between 1 and 168'
    ),
    candy_prompt: z
      .string()
      .trim()
      .min(1, 'Enter the question')
      .max(INTELLIGENCE_CHECK_LIMITS.prompt, 'Too long'),
    candy_answer: z
      .string()
      .trim()
      .min(1, 'Enter the expected answer')
      .max(INTELLIGENCE_CHECK_LIMITS.answer, 'Too long'),
    candy_answer_format: z
      .string()
      .max(INTELLIGENCE_CHECK_LIMITS.prompt, 'Too long'),
    candy_max_tokens: rangedInt(
      INTELLIGENCE_CHECK_LIMITS.maxTokens,
      'Enter a whole number between 256 and 65536'
    ),
    pelican_enabled: z.boolean(),
    pelican_interval_hours: rangedInt(
      INTELLIGENCE_CHECK_LIMITS.interval,
      'Enter a whole number of hours between 1 and 168'
    ),
    pelican_prompt: z
      .string()
      .trim()
      .min(1, 'Enter the question')
      .max(INTELLIGENCE_CHECK_LIMITS.prompt, 'Too long'),
    pelican_max_tokens: rangedInt(
      INTELLIGENCE_CHECK_LIMITS.maxTokens,
      'Enter a whole number between 256 and 65536'
    ),
  })
  .superRefine((values, ctx) => {
    const seen = new Set<string>()
    values.targets.forEach((target) => {
      if (target.group === '' || target.model === '') {
        ctx.addIssue({
          code: 'custom',
          path: ['targets'],
          message: 'Choose a group and a model for every row',
        })
        return
      }
      if (seen.has(target.group)) {
        ctx.addIssue({
          code: 'custom',
          path: ['targets'],
          message: 'Each group can be checked only once',
        })
      }
      if (!target.candy && !target.pelican) {
        ctx.addIssue({
          code: 'custom',
          path: ['targets'],
          message: 'Choose at least one question for every group',
        })
      }
      seen.add(target.group)
    })
  })

export type IntelligenceCheckValues = z.infer<typeof intelligenceCheckSchema>

const PREFIX = 'intelligence_check_setting.'

type StoredTarget = {
  group?: unknown
  model?: unknown
  candy?: unknown
  pelican?: unknown
}

/**
 * Targets as saved. A question left unset is asked, as on the server, so
 * targets saved before the choice existed keep both questions.
 */
export function parseIntelligenceCheckTargets(
  raw: string
): IntelligenceCheckTarget[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return (parsed as StoredTarget[])
      .filter(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          typeof item.group === 'string' &&
          typeof item.model === 'string'
      )
      .map((item) => ({
        group: item.group as string,
        model: item.model as string,
        candy: item.candy !== false,
        pelican: item.pelican !== false,
      }))
  } catch {
    return []
  }
}

export function toIntelligenceCheckValues(
  settings: IntelligenceCheckSettings
): IntelligenceCheckValues {
  return {
    enabled: settings[`${PREFIX}enabled`],
    targets: parseIntelligenceCheckTargets(settings[`${PREFIX}targets`]),
    candy_enabled: settings[`${PREFIX}candy_enabled`],
    candy_interval_hours: settings[`${PREFIX}candy_interval_hours`],
    candy_prompt: settings[`${PREFIX}candy_prompt`],
    candy_answer: settings[`${PREFIX}candy_answer`],
    candy_answer_format: settings[`${PREFIX}candy_answer_format`],
    candy_max_tokens: settings[`${PREFIX}candy_max_tokens`],
    pelican_enabled: settings[`${PREFIX}pelican_enabled`],
    pelican_interval_hours: settings[`${PREFIX}pelican_interval_hours`],
    pelican_prompt: settings[`${PREFIX}pelican_prompt`],
    pelican_max_tokens: settings[`${PREFIX}pelican_max_tokens`],
  }
}

/** The options to save: only the fields that differ from the saved ones. */
export function changedIntelligenceCheckOptions(
  saved: IntelligenceCheckValues,
  next: IntelligenceCheckValues
): Array<{ key: string; value: string }> {
  const updates: Array<{ key: string; value: string }> = []
  const fields = Object.keys(next) as Array<keyof IntelligenceCheckValues>
  for (const field of fields) {
    const value =
      field === 'targets' ? JSON.stringify(next.targets) : String(next[field])
    const before =
      field === 'targets' ? JSON.stringify(saved.targets) : String(saved[field])
    if (value !== before) updates.push({ key: PREFIX + field, value })
  }
  return updates
}
