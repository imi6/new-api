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
const PLATFORM_RULES: Array<{ name: string; pattern: RegExp }> = [
  { name: 'AWS', pattern: /aws/i },
  { name: 'Azure', pattern: /azure|(?:^|[\s\-_])az(?:$|[\s\-_])/i },
  { name: 'Claude', pattern: /claude|anthropic/i },
  { name: 'GPT', pattern: /openai|(?:^|[\s\-_])gpt/i },
  { name: 'Gemini', pattern: /gemini|(?:^|[\s\-_])google/i },
  { name: 'Grok', pattern: /grok|xai/i },
  { name: 'DeepSeek', pattern: /deepseek/i },
  { name: 'GLM', pattern: /(?:^|[\s\-_])glm/i },
  { name: 'Kimi', pattern: /kimi/i },
  { name: 'OpenRouter', pattern: /openrouter/i },
  { name: '国模', pattern: /国模/ },
  { name: 'Seedance', pattern: /seedance/i },
  { name: 'Qwen', pattern: /qwen|通义/i },
  { name: 'Doubao', pattern: /doubao|豆包/i },
]

export function apiKeyGroupPlatform(label: string): string {
  const name = label.trim()
  for (const rule of PLATFORM_RULES) {
    if (rule.pattern.test(name)) return rule.name
  }
  return 'Other'
}

export function formatApiKeyGroupRatio(ratio: number | string): string {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return String(ratio)
  const text = ratio.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
  return `${text}x`
}
