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
import type { UpstreamRate } from './types'

// 范围只由启用 Key 构成。当前结果和历史回退分开，绝不求平均值。
export function summarizeUpstreamRate(rate: UpstreamRate) {
  const enabled = rate.keys.filter((key) => key.enabled)
  const current = enabled.filter(
    (key) => key.status === 'matched' && key.ratio !== undefined
  )
  const values =
    current.length > 0
      ? current
      : enabled.filter((key) => key.ratio !== undefined)
  const ratios = values.flatMap((key) =>
    key.ratio === undefined ? [] : [key.ratio]
  )
  const groups = new Set(
    values.map(
      (key) =>
        `${key.source_id ?? ''}:${key.upstream_channel_id ?? 0}:${key.group_id ? `id:${key.group_id}` : `name:${key.group_name}`}`
    )
  )
  const changes = current.flatMap((key) => (key.change ? [key.change] : []))
  // 多个分组同时涨跌时优先提示上涨，避免掩盖成本增加。
  let direction: 'up' | 'down' | undefined
  if (changes.some((change) => change.to > change.from)) {
    direction = 'up'
  } else if (changes.some((change) => change.to < change.from)) {
    direction = 'down'
  }
  return {
    min: ratios.length ? Math.min(...ratios) : undefined,
    max: ratios.length ? Math.max(...ratios) : undefined,
    groupCount: groups.size,
    historical: values.length > 0 && current.length === 0,
    approximate: values.some((key) => key.match_method === 'masked'),
    changed: current.some((key) => key.change !== undefined),
    change: groups.size === 1 ? changes[0] : undefined,
    direction,
    moved: current.some((key) => key.moved_from !== undefined),
  }
}
