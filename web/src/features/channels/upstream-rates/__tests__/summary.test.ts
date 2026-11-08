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

import { summarizeUpstreamRate } from '../summary'
import type { UpstreamRate, UpstreamRateKey } from '../types'

function rate(keys: UpstreamRateKey[], status = 'matched'): UpstreamRate {
  return {
    channel_id: 1,
    status,
    only_with_keys: true,
    read_at: 1,
    keys,
    enabled_keys: 2,
    matched_keys: 2,
    refresh_available: true,
    force_refresh_available: true,
  }
}

const first: UpstreamRateKey = {
  index: 1,
  enabled: true,
  status: 'matched',
  group_id: 1,
  group_name: 'A',
  ratio: 0.1,
  collected_at: 1,
  key_synced_at: 1,
}

describe('上游倍率范围', () => {
  test('多分组范围排除禁用 Key，保留分组数量而不计算平均倍率', () => {
    const result = summarizeUpstreamRate(
      rate([
        first,
        { ...first, index: 2, group_id: 2, group_name: 'B', ratio: 0.2 },
        { ...first, index: 3, enabled: false, ratio: 99 },
      ])
    )
    expect(result).toMatchObject({
      min: 0.1,
      max: 0.2,
      groupCount: 2,
      historical: false,
    })
  })

  test('相同倍率的不同分组仍显示两个分组，零倍率保持为零', () => {
    expect(
      summarizeUpstreamRate(rate([first, { ...first, index: 2, group_id: 2 }]))
    ).toMatchObject({ min: 0.1, max: 0.1, groupCount: 2 })
    expect(summarizeUpstreamRate(rate([{ ...first, ratio: 0 }]))).toMatchObject(
      { min: 0, max: 0 }
    )
  })

  test('不同上游渠道中的相同分组 ID 不合并为一个分组', () => {
    expect(
      summarizeUpstreamRate(
        rate([
          { ...first, source_id: 'a', upstream_channel_id: 4 },
          { ...first, index: 2, source_id: 'a', upstream_channel_id: 7 },
          { ...first, index: 3, source_id: 'b', upstream_channel_id: 4 },
        ])
      )
    ).toMatchObject({ min: 0.1, max: 0.1, groupCount: 3 })
  })

  test('部分成功时范围仅采用当前确认值，失败项目历史值不混入', () => {
    const result = summarizeUpstreamRate(
      rate(
        [first, { ...first, index: 2, status: 'unavailable', ratio: 5 }],
        'partial'
      )
    )
    expect(result).toMatchObject({ min: 0.1, max: 0.1, historical: false })
  })

  test('读取失败时历史值带历史标记且不展示当前调价提示', () => {
    const result = summarizeUpstreamRate(
      rate(
        [
          {
            ...first,
            status: 'read_failed',
            change: { from: 0.08, to: 0.1, at: 1 },
          },
        ],
        'read_failed'
      )
    )
    expect(result).toMatchObject({
      min: 0.1,
      max: 0.1,
      historical: true,
      changed: false,
    })
  })

  test('迁组独立于调价，完全未匹配时不补默认倍率', () => {
    expect(
      summarizeUpstreamRate(rate([{ ...first, moved_from: 'B', moved_at: 1 }]))
    ).toMatchObject({ moved: true, changed: false })
    expect(
      summarizeUpstreamRate(
        rate([{ ...first, status: 'unmatched', ratio: undefined }], 'unmatched')
      )
    ).toMatchObject({ min: undefined, max: undefined })
  })
})
