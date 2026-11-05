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

export type GroupHealthRange = 'hour' | 'day' | 'week'

export type GroupHealthStatus = 'ok' | 'down' | 'unknown'

/**
 * `ttft` is the time to first token of real streaming requests; `probe` is
 * the round trip of a channel check.
 */
export type GroupHealthLatencySource = 'ttft' | 'probe' | ''

/** One bar: real requests and channel checks of one hour, day, or week. */
export interface GroupHealthBar {
  start: number
  real_requests: number
  probe_samples: number
  success_rate: number
  has_data: boolean
  avg_latency_ms: number
  latency_source: GroupHealthLatencySource
}

export interface GroupHealthGroup {
  name: string
  desc: string
  /** Admin-assigned channel type id, or empty to match by name. */
  platform: string
  status: GroupHealthStatus
  top_model: string
  last_sample_at: number
  total: GroupHealthBar
  bars: GroupHealthBar[]
}

export interface GroupHealthData {
  updated_at: number
  range: GroupHealthRange
  real_traffic_enabled: boolean
  probe_enabled: boolean
  total: GroupHealthBar
  groups: GroupHealthGroup[]
}

export interface GroupHealthResponse {
  success: boolean
  message?: string
  data: GroupHealthData
}
