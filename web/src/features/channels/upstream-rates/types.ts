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
export type UpstreamRateSource = {
  id: string
  name: string
  base_url: string
  enabled: boolean
  token_configured: boolean
  poll_seconds: number
  read_at: number
  error: string
  complete: boolean
}

export type UpstreamRateConfig = {
  sources: UpstreamRateSource[]
  encryption_ready: boolean
}

export type UpstreamRateSourceInput = Pick<
  UpstreamRateSource,
  'id' | 'name' | 'base_url' | 'enabled' | 'poll_seconds'
> & { token: string }

export type UpstreamRateKey = {
  index: number
  enabled: boolean
  status: string
  match_method?: 'fingerprint' | 'masked'
  source_id?: string
  source_name?: string
  upstream_channel_id?: number
  upstream_channel_name?: string
  site_url?: string
  sync_status?: string
  only_with_keys?: boolean
  read_at?: number
  error?: string
  group_id?: number
  group_name?: string
  ratio?: number
  collected_at: number
  key_synced_at: number
  change?: { from: number; to: number; at: number }
  moved_from?: string
  moved_at?: number
}

export type UpstreamRate = {
  channel_id: number
  status: string
  source_id?: string
  source_name?: string
  upstream_channel_id?: number
  upstream_channel_name?: string
  site_url?: string
  sync_status?: string
  only_with_keys: boolean
  read_at: number
  error?: string
  keys: UpstreamRateKey[]
  enabled_keys: number
  matched_keys: number
  refresh_available: boolean
  force_refresh_available: boolean
}

export type UpstreamRateTask = {
  task_id: string
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  error?: string
}
