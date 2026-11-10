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
export interface TelegramBotPreferences {
  enabled: boolean
  low_balance: boolean
  topup: boolean
  subscription: boolean
  expiry: boolean
}

export const EMPTY_TELEGRAM_PREFERENCES: TelegramBotPreferences = {
  enabled: false,
  low_balance: false,
  topup: false,
  subscription: false,
  expiry: false,
}

export const DEFAULT_TELEGRAM_PREFERENCES: TelegramBotPreferences = {
  enabled: true,
  low_balance: true,
  topup: true,
  subscription: true,
  expiry: true,
}

export interface TelegramBotStatus {
  available: boolean
  bot_username: string
  connected: boolean
  status:
    | 'unconnected'
    | 'connecting'
    | 'connected'
    | 'disconnected'
    | 'blocked'
  telegram_id: string
  version: number
  preferences_version: number
  preferences: TelegramBotPreferences
  last_error: string
  last_connected_at: number
  deep_link: string
}

export interface TelegramBotConfig {
  enabled: boolean
  token_configured: boolean
  bot_id: string
  bot_username: string
  version: number
  webhook_url: string
  webhook_status: string
  last_error: string
  pending_inbox: number
  pending_outbox: number
}

export interface TelegramBotRecovery {
  url: string
  flow_token: string
  expires_at: number
}
