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
import { describe, expect, it } from 'vitest'

import { isGroupLabelConfig, parseGroupLabelConfig } from '../group-labels'

const labels = [
  { id: 'self', name: '自营', icon: 'shield', color: 'teal' },
  { id: 'genuine', name: '保真', icon: 'badge-check', color: 'amber' },
]

describe('group label configuration', () => {
  it('keeps the configured order and original group names', () => {
    const config = { labels, groups: { Claude: ['genuine', 'self'] } }
    expect(parseGroupLabelConfig(JSON.stringify(config))).toEqual(config)
    expect(isGroupLabelConfig(config)).toBe(true)
  })

  it.each(['', 'null', '{}', '{', '[]'])(
    'uses no labels for missing or malformed configuration: %s',
    (value) => {
      expect(parseGroupLabelConfig(value)).toEqual({ labels: [], groups: {} })
    }
  )

  it.each([
    { labels, groups: { Claude: ['missing'] } },
    { labels, groups: { Claude: ['self', 'self'] } },
    { labels: [labels[0], labels[0]], groups: {} },
    { labels: [{ ...labels[0], name: '自营\n' }], groups: {} },
    {
      labels: [{ ...labels[0], name: '超出十二个字符的标签名字文本' }],
      groups: {},
    },
    { labels: [{ ...labels[0], icon: '<svg>' }], groups: {} },
    { labels: [{ ...labels[0], color: 'url()' }], groups: {} },
    { labels, groups: { Claude: 'self' } },
  ])('rejects invalid labels and references', (config) => {
    expect(isGroupLabelConfig(config)).toBe(false)
  })

  it('treats prototype-looking group names as ordinary stored data', () => {
    const config = {
      labels,
      groups: JSON.parse('{"__proto__":["self"],"constructor":["genuine"]}'),
    }
    expect(isGroupLabelConfig(config)).toBe(true)
    expect(
      Object.hasOwn(
        parseGroupLabelConfig(JSON.stringify(config)).groups,
        '__proto__'
      )
    ).toBe(true)
    expect(({} as Record<string, unknown>).self).toBeUndefined()
  })
})
