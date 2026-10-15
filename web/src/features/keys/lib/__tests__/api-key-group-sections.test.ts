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

import { groupApiKeyOptions } from '../api-key-group-sections'

function option(value: string) {
  return { value, label: value }
}

describe('groupApiKeyOptions', () => {
  test('keeps auto first and folds a shared name prefix into a major group', () => {
    const sections = groupApiKeyOptions([
      option('auto'),
      option('OpenAI GPT 特价分组'),
      option('OpenAI GPT 普通分组'),
      option('OpenAI GPT Pro分组'),
      option('OpenAI GPT Pro Max 分组'),
      option('Claude Code Max 分组'),
    ])

    expect(sections.map((section) => section.title)).toEqual([
      null,
      'OpenAI GPT',
      null,
    ])
    expect(sections[0]?.options.map((item) => item.value)).toEqual(['auto'])
    expect(sections[1]?.options.map((item) => item.itemLabel)).toEqual([
      '特价分组',
      '普通分组',
      'Pro分组',
      'Pro Max 分组',
    ])
    expect(sections[1]?.options.map((item) => item.value)).toEqual([
      'OpenAI GPT 特价分组',
      'OpenAI GPT 普通分组',
      'OpenAI GPT Pro分组',
      'OpenAI GPT Pro Max 分组',
    ])
    expect(sections[2]?.options[0]?.itemLabel).toBe('Claude Code Max 分组')
  })

  test('does not merge unrelated short names or a name that is only a prefix', () => {
    const sections = groupApiKeyOptions([
      option('vip'),
      option('svip'),
      option('default'),
      option('default-plus'),
    ])

    expect(sections.map((section) => section.title)).toEqual([
      null,
      null,
      null,
      null,
    ])
    expect(sections.map((section) => section.options[0]?.itemLabel)).toEqual([
      'vip',
      'svip',
      'default',
      'default-plus',
    ])
  })

  test('splits hyphenated families and keeps separate families in first-seen order', () => {
    const sections = groupApiKeyOptions([
      option('claude-sonnet'),
      option('openai-gpt-sale'),
      option('claude-opus'),
      option('openai-gpt-pro'),
    ])

    expect(sections.map((section) => section.title)).toEqual([
      'claude',
      'openai-gpt',
    ])
    expect(sections[0]?.options.map((item) => item.itemLabel)).toEqual([
      'sonnet',
      'opus',
    ])
    expect(sections[1]?.options.map((item) => item.itemLabel)).toEqual([
      'sale',
      'pro',
    ])
  })
})
