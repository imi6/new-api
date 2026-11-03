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
  OTHER_PLATFORM,
  apiKeyGroupPlatform,
  apiKeyPlatformLabel,
  formatApiKeyGroupRatio,
  isPlatformType,
} from '../api-key-group-platforms'

// Channel type ids, as in features/channels/constants.ts.
const OPENAI = '1'
const AZURE = '3'
const ANTHROPIC = '14'
const ALI = '17'
const OPENROUTER = '20'
const GEMINI = '24'
const MOONSHOT = '25'
const ZHIPU_GLM = '26'
const AWS = '33'
const DEEPSEEK = '43'
const XAI = '48'

describe('apiKeyGroupPlatform', () => {
  test('maps vendor names in a group to their channel type', () => {
    expect(apiKeyGroupPlatform('Claude Max-3')).toBe(ANTHROPIC)
    expect(apiKeyGroupPlatform('GPT Plus')).toBe(OPENAI)
    expect(apiKeyGroupPlatform('OpenAI GPT 特价分组')).toBe(OPENAI)
    expect(apiKeyGroupPlatform('Gemini-Ultra')).toBe(GEMINI)
    expect(apiKeyGroupPlatform('Grok Heavy')).toBe(XAI)
    expect(apiKeyGroupPlatform('DeepSeek')).toBe(DEEPSEEK)
    expect(apiKeyGroupPlatform('GLM')).toBe(ZHIPU_GLM)
    expect(apiKeyGroupPlatform('Kimi')).toBe(MOONSHOT)
    expect(apiKeyGroupPlatform('Qwen 通义')).toBe(ALI)
    expect(apiKeyGroupPlatform('openrouter全模型')).toBe(OPENROUTER)
  })

  test('prefers the model vendor over the cloud that hosts it', () => {
    expect(apiKeyGroupPlatform('Claude-AWS Bedrock')).toBe(ANTHROPIC)
    expect(apiKeyGroupPlatform('Azure-GPT可蒸馏')).toBe(OPENAI)
    expect(apiKeyGroupPlatform('AWS Bedrock')).toBe(AWS)
    expect(apiKeyGroupPlatform('Azure 专线')).toBe(AZURE)
  })

  test('uses an admin-assigned channel type before name matching', () => {
    expect(
      apiKeyGroupPlatform('Claude-AWS Bedrock', { 'Claude-AWS Bedrock': AWS })
    ).toBe(AWS)
  })

  test('ignores an assignment that is not a channel type', () => {
    expect(apiKeyGroupPlatform('GPT Plus', { 'GPT Plus': 'Claude' })).toBe(
      OPENAI
    )
    expect(apiKeyGroupPlatform('GPT Plus', { 'GPT Plus': '999' })).toBe(OPENAI)
  })

  test('puts names that match no channel type into Other', () => {
    expect(apiKeyGroupPlatform('custom-group-a')).toBe(OTHER_PLATFORM)
  })
})

describe('isPlatformType', () => {
  test('accepts known channel types and rejects anything else', () => {
    expect(isPlatformType(ANTHROPIC)).toBe(true)
    expect(isPlatformType('61')).toBe(false)
    expect(isPlatformType('Claude')).toBe(false)
    expect(isPlatformType('')).toBe(false)
    expect(isPlatformType(undefined)).toBe(false)
  })
})

describe('apiKeyPlatformLabel', () => {
  const t = (key: string) => `t:${key}`

  test('uses the channel type name the channel picker shows', () => {
    expect(apiKeyPlatformLabel(ANTHROPIC, t)).toBe('t:Anthropic')
    expect(apiKeyPlatformLabel(ALI, t)).toBe('t:Ali')
  })

  test('labels Other and unknown values as Other', () => {
    expect(apiKeyPlatformLabel(OTHER_PLATFORM, t)).toBe('t:Other')
    expect(apiKeyPlatformLabel('999', t)).toBe('t:Other')
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
