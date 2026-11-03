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
import {
  CHANNEL_TYPES,
  CHANNEL_TYPE_OPTIONS,
  CHANNEL_TYPE_TASK_PLUGIN,
} from '@/features/channels/constants'

// A group's platform is a channel type id stored as a string ("14" is
// Anthropic), so the platforms, their names and their icons are the same
// ones shown when creating a channel.

/** Platform for groups that match no channel type. */
export const OTHER_PLATFORM = 'other'

/** Channel types an admin can assign to a group, in channel picker order. */
export const PLATFORM_TYPE_OPTIONS = CHANNEL_TYPE_OPTIONS.filter(
  (option) => option.value !== CHANNEL_TYPE_TASK_PLUGIN
)

const PLATFORM_TYPE_IDS = new Set(
  PLATFORM_TYPE_OPTIONS.map((option) => String(option.value))
)

// Name matching for groups without an admin assignment. Model vendors come
// before the clouds that host them, so "Claude-AWS Bedrock" is Anthropic and
// "Azure-GPT" is OpenAI; an admin can assign AWS or Azure explicitly.
const PLATFORM_RULES: Array<{ type: number; pattern: RegExp }> = [
  { type: 14, pattern: /claude|anthropic/i },
  { type: 1, pattern: /openai|(?:^|[\s\-_])gpt/i },
  { type: 24, pattern: /gemini|(?:^|[\s\-_])google/i },
  { type: 48, pattern: /grok|xai/i },
  { type: 43, pattern: /deepseek/i },
  { type: 26, pattern: /(?:^|[\s\-_])glm|zhipu|智谱/i },
  { type: 25, pattern: /kimi|moonshot/i },
  { type: 17, pattern: /qwen|通义|百炼|bailian/i },
  { type: 54, pattern: /seedance|seedream/i },
  { type: 45, pattern: /doubao|豆包|volc|火山/i },
  { type: 35, pattern: /minimax/i },
  { type: 42, pattern: /mistral/i },
  { type: 23, pattern: /hunyuan|混元|腾讯/i },
  { type: 20, pattern: /openrouter/i },
  { type: 41, pattern: /vertex/i },
  { type: 33, pattern: /aws|bedrock/i },
  { type: 3, pattern: /azure|(?:^|[\s\-_])az(?:$|[\s\-_])/i },
]

/** Whether a stored value is a channel type id a group can be assigned. */
export function isPlatformType(value: string | undefined): boolean {
  return Boolean(value) && PLATFORM_TYPE_IDS.has(String(value))
}

/**
 * Resolve a group's platform to a channel type id string, or OTHER_PLATFORM.
 * An admin assignment in platformMap wins; a value that is not a known
 * channel type (for example a name saved by an older version) is ignored.
 */
export function apiKeyGroupPlatform(
  label: string,
  platformMap?: Record<string, string>
): string {
  const name = label.trim()
  const assigned = platformMap?.[name]
  if (isPlatformType(assigned)) return String(assigned)
  for (const rule of PLATFORM_RULES) {
    if (rule.pattern.test(name)) return String(rule.type)
  }
  return OTHER_PLATFORM
}

/** Display name of a platform, translated like the channel picker. */
export function apiKeyPlatformLabel(
  platform: string,
  t: (key: string) => string
): string {
  const label = CHANNEL_TYPES[Number(platform) as keyof typeof CHANNEL_TYPES]
  if (platform === OTHER_PLATFORM || !label) return t('Other')
  return t(label)
}

export function formatApiKeyGroupRatio(ratio: number | string): string {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return String(ratio)
  const text = ratio.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
  return `${text}x`
}
