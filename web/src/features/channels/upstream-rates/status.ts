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
// 状态值来自后端；保留字面量翻译键，方便同步全部语言。
export const upstreamRateStatusKeys: Record<string, string> = {
  matched: 'Matched',
  not_configured: 'No upstream rate sources',
  not_synced: 'Not yet synchronized',
  unmatched: 'No matching key',
  conflict: 'Key matching conflict',
  partial: 'Partial upstream synchronization',
  unavailable: 'Upstream data unavailable',
  disabled: 'Disabled',
  read_failed: 'Upstream snapshot read failed',
  failed: 'Upstream synchronization failed',
  stale: 'Upstream snapshot expired',
  unsupported_protocol: 'Unsupported fingerprint protocol',
  unsupported_credential: 'Unsupported credential format',
  invalid_time: 'Invalid upstream timestamp',
  invalid_response: 'Invalid upstream response',
  older_snapshot: 'Older snapshot ignored',
}

export const upstreamRateErrorKeys: Record<string, string> = {
  credential_unavailable: 'Upstream rate credential unavailable',
  invalid_configuration: 'Invalid upstream rate configuration',
  unauthorized: 'Upstream rate token rejected',
  channel_forbidden: 'Upstream channel access denied',
  not_found: 'Upstream channel or endpoint not found',
  rate_limited: 'Upstream rate request limited',
  refresh_failed: 'Upstream synchronization failed',
  api_unavailable: 'Upstream rate API unavailable',
  timeout: 'Upstream rate request timed out',
  request_failed: 'Upstream snapshot read failed',
  channel_unavailable: 'Upstream data unavailable',
  invalid_response: 'Invalid upstream response',
  unsupported_protocol: 'Unsupported fingerprint protocol',
  older_snapshot: 'Older snapshot ignored',
}
