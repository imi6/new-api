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
import type { ChannelAffinitySettings } from '../general/channel-affinity/types'

export type RetrySettings = {
  RetryTimes: number
  AutomaticRetryStatusCodes: string
}
export type HealthSettings = {
  ChannelDisableThreshold: string
  AutomaticDisableChannelEnabled: boolean
  AutomaticDisableFailureCount: number
  AutomaticEnableChannelEnabled: boolean
  AutomaticDisableKeywords: string
  AutomaticDisableStatusCodes: string
  'monitor_setting.auto_test_channel_enabled': boolean
  'monitor_setting.auto_test_channel_minutes': number
  'monitor_setting.channel_test_concurrency': number
  'monitor_setting.skip_recently_used_channels': boolean
  'monitor_setting.channel_test_mode':
    | 'scheduled_all'
    | 'auto_ban_only'
    | 'passive_recovery'
}
/** Scheduled intelligence checks; stored as intelligence_check_setting.* options. */
export type IntelligenceCheckSettings = {
  'intelligence_check_setting.enabled': boolean
  /** JSON array of { group, model }. */
  'intelligence_check_setting.targets': string
  'intelligence_check_setting.candy_enabled': boolean
  'intelligence_check_setting.candy_interval_hours': number
  'intelligence_check_setting.candy_prompt': string
  'intelligence_check_setting.candy_answer': string
  'intelligence_check_setting.candy_answer_format': string
  'intelligence_check_setting.candy_max_tokens': number
  'intelligence_check_setting.pelican_enabled': boolean
  'intelligence_check_setting.pelican_interval_hours': number
  'intelligence_check_setting.pelican_prompt': string
  'intelligence_check_setting.pelican_max_tokens': number
  'intelligence_check_setting.keep_results': number
}
export type RequestPolicySettings = RetrySettings &
  HealthSettings &
  IntelligenceCheckSettings &
  Pick<ChannelAffinitySettings, keyof ChannelAffinitySettings>

export const defaultRequestPolicySettings: RequestPolicySettings = {
  RetryTimes: 0,
  AutomaticRetryStatusCodes:
    '100-199,300-399,401-407,409-499,500-503,505-523,525-599',
  ChannelDisableThreshold: '',
  AutomaticDisableChannelEnabled: false,
  AutomaticDisableFailureCount: 1,
  AutomaticEnableChannelEnabled: false,
  AutomaticDisableKeywords: '',
  AutomaticDisableStatusCodes: '401',
  'monitor_setting.auto_test_channel_enabled': false,
  'monitor_setting.auto_test_channel_minutes': 10,
  'monitor_setting.channel_test_concurrency': 1,
  'monitor_setting.channel_test_mode': 'scheduled_all',
  'monitor_setting.skip_recently_used_channels': true,
  // The server sends the real values, including the default questions.
  'intelligence_check_setting.enabled': false,
  'intelligence_check_setting.targets': '[]',
  'intelligence_check_setting.candy_enabled': true,
  'intelligence_check_setting.candy_interval_hours': 6,
  'intelligence_check_setting.candy_prompt': '',
  'intelligence_check_setting.candy_answer': '21',
  'intelligence_check_setting.candy_answer_format': '',
  'intelligence_check_setting.candy_max_tokens': 8192,
  'intelligence_check_setting.pelican_enabled': true,
  'intelligence_check_setting.pelican_interval_hours': 24,
  'intelligence_check_setting.pelican_prompt': '',
  'intelligence_check_setting.pelican_max_tokens': 32000,
  'intelligence_check_setting.keep_results': 10,
  'channel_affinity_setting.enabled': false,
  'channel_affinity_setting.session_mode': '',
  'channel_affinity_setting.switch_on_success': true,
  'channel_affinity_setting.keep_on_channel_disabled': false,
  'channel_affinity_setting.max_entries': 100000,
  'channel_affinity_setting.default_ttl_seconds': 3600,
  'channel_affinity_setting.rules': '[]',
}
