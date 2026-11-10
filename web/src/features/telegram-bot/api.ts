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
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import type {
  TelegramBotConfig,
  TelegramBotPreferences,
  TelegramBotRecovery,
  TelegramBotStatus,
} from './types'

interface TelegramResponse<T> {
  success: boolean
  data: T
  message?: string
}

const userBase = '/api/user/self/telegram-bot'

export async function getTelegramBotStatus(signal?: AbortSignal) {
  const response = await api.get<TelegramResponse<TelegramBotStatus>>(
    userBase,
    { signal }
  )
  return requireServerSuccess(response.data).data
}

export async function updateTelegramPreferences(payload: {
  version: number
  preferences: TelegramBotPreferences
}) {
  const response = await api.put<TelegramResponse<unknown>>(
    `${userBase}/preferences`,
    payload
  )
  return requireServerSuccess(response.data)
}

export async function disconnectTelegramBot() {
  const response = await api.post<TelegramResponse<unknown>>(
    `${userBase}/disconnect`,
    {}
  )
  return requireServerSuccess(response.data)
}

export async function testTelegramBot(admin = false) {
  const response = await api.post<TelegramResponse<unknown>>(
    admin ? '/api/telegram-bot/test' : `${userBase}/test`,
    {}
  )
  return requireServerSuccess(response.data)
}

export async function startTelegramRecovery() {
  const response = await api.post<TelegramResponse<TelegramBotRecovery>>(
    `${userBase}/recovery`,
    {},
    { singleUseAuthorization: true }
  )
  return requireServerSuccess(response.data).data
}

export async function confirmTelegramRecovery(flowToken: string) {
  const response = await api.post<TelegramResponse<unknown>>(
    `${userBase}/recovery/confirm`,
    { flow_token: flowToken },
    { singleUseAuthorization: true }
  )
  return requireServerSuccess(response.data)
}

export async function getTelegramBotConfig(signal?: AbortSignal) {
  const response = await api.get<TelegramResponse<TelegramBotConfig>>(
    '/api/telegram-bot/config',
    { signal }
  )
  const config = requireServerSuccess(response.data).data
  return {
    ...config,
    low_balance_enabled: config.low_balance_enabled ?? true,
    group_ratio_change_enabled: config.group_ratio_change_enabled ?? false,
  }
}

export async function updateTelegramBotConfig(payload: {
  enabled: boolean
  low_balance_enabled?: boolean
  group_ratio_change_enabled?: boolean
  version: number
  bot_token?: string
}) {
  const response = await api.put<TelegramResponse<TelegramBotConfig>>(
    '/api/telegram-bot/config',
    payload
  )
  const config = requireServerSuccess(response.data).data
  return {
    ...config,
    low_balance_enabled: config.low_balance_enabled ?? true,
    group_ratio_change_enabled: config.group_ratio_change_enabled ?? false,
  }
}
