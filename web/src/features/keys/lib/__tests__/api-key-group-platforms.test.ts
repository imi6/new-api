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
import { describe, expect, test } from 'vitest'

import {
  apiKeyGroupPlatform,
  formatApiKeyGroupRatio,
} from '../api-key-group-platforms'

describe('apiKeyGroupPlatform', () => {
  test('keeps Azure and AWS as separate groups', () => {
    expect(apiKeyGroupPlatform('Azure-GPT可蒸馏')).toBe('Azure')
    expect(apiKeyGroupPlatform('Azure-GPT不可蒸馏')).toBe('Azure')
    expect(apiKeyGroupPlatform('AZ-GPT')).toBe('Azure')
    expect(apiKeyGroupPlatform('Claude-AWS Bedrock')).toBe('AWS')
  })

  test('keeps the remaining vendor families together', () => {
    expect(apiKeyGroupPlatform('Claude Max-3')).toBe('Claude')
    expect(apiKeyGroupPlatform('Claude-顶级华强北')).toBe('Claude')
    expect(apiKeyGroupPlatform('Claude Enterprise官转')).toBe('Claude')
    expect(apiKeyGroupPlatform('GPT Plus')).toBe('GPT')
    expect(apiKeyGroupPlatform('GPTPRO特惠')).toBe('GPT')
    expect(apiKeyGroupPlatform('GPT官KEY')).toBe('GPT')
    expect(apiKeyGroupPlatform('OpenAI GPT 特价分组')).toBe('GPT')
    expect(apiKeyGroupPlatform('Gemini-Vertex')).toBe('Gemini')
    expect(apiKeyGroupPlatform('Gemini-Ultra')).toBe('Gemini')
    expect(apiKeyGroupPlatform('Grok Free')).toBe('Grok')
    expect(apiKeyGroupPlatform('Grok Heavy')).toBe('Grok')
    expect(apiKeyGroupPlatform('DeepSeek')).toBe('DeepSeek')
    expect(apiKeyGroupPlatform('GLM')).toBe('GLM')
    expect(apiKeyGroupPlatform('Kimi')).toBe('Kimi')
    expect(apiKeyGroupPlatform('openrouter全模型')).toBe('OpenRouter')
    expect(apiKeyGroupPlatform('国模聚合')).toBe('国模')
  })

  test('puts account-specific names that match no vendor into Other', () => {
    expect(apiKeyGroupPlatform('custom-group-a')).toBe('Other')
    expect(apiKeyGroupPlatform('custom-group-b')).toBe('Other')
  })
})

describe('formatApiKeyGroupRatio', () => {
  test('trims trailing zeros and keeps a non-numeric ratio', () => {
    expect(formatApiKeyGroupRatio(0.065)).toBe('0.065x')
    expect(formatApiKeyGroupRatio(0.3)).toBe('0.3x')
    expect(formatApiKeyGroupRatio(2)).toBe('2x')
    expect(formatApiKeyGroupRatio('auto')).toBe('auto')
  })
})
