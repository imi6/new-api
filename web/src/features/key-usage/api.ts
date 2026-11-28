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
import { toIntlLocale } from '@/i18n/languages'
import { api } from '@/lib/api'
import { createServerError } from '@/lib/server-error-message'

export const PUBLIC_KEY_USAGE_SETTINGS_QUERY_KEY = [
  'public-key-usage-settings',
] as const

export const KEY_USAGE_PAGE_SIZE = 20

export type KeyUsageAccess =
  | { kind: 'public'; key: string }
  | { kind: 'owner'; keyId: string }

export interface KeyUsageSettings {
  enabled: boolean
  export_enabled: boolean
  max_range_days: number
  consume_log_enabled: boolean
}

export interface KeyUsageToken {
  total_granted: number
  total_used: number
  total_available: number
  unlimited_quota: boolean
  expires_at: number
  status: number
}

export interface KeyUsageEntry {
  created_at: number
  model_name: string
  prompt_tokens: number
  completion_tokens: number
  quota: number
  type: 2 | 6
}

export interface KeyUsageFilters {
  start_timestamp?: number
  end_timestamp?: number
  model_name?: string
}

export interface KeyUsageResult
  extends
    Omit<KeyUsageSettings, 'enabled'>,
    Required<Pick<KeyUsageFilters, 'start_timestamp' | 'end_timestamp'>> {
  token: KeyUsageToken
  items: KeyUsageEntry[]
  total: number
  total_is_capped: boolean
  p: number
  page_size: number
}

interface KeyUsageExport {
  items: KeyUsageEntry[]
}

interface ApiResponse<T> {
  success: boolean
  data?: T
  message?: string
  message_key?: string
}

export function isKeyUsageSecureOrigin(): boolean {
  const { protocol, hostname } = window.location
  return (
    protocol === 'https:' ||
    (protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(hostname))
  )
}

async function publicKeyUsageRequest<T>(
  path: string,
  signal: AbortSignal,
  language?: string,
  key?: string
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' })
  if (key) {
    // 将凭据限定在同源请求的授权头内。
    if (!isKeyUsageSecureOrigin()) {
      throw createServerError({ message_key: 'API key lookup requires HTTPS' })
    }
    headers.set('Authorization', `Bearer ${key}`)
  }
  const locale = toIntlLocale(language)
  if (locale) headers.set('Accept-Language', locale)
  const response = await fetch(path, {
    headers,
    signal,
    cache: 'no-store',
    credentials: 'omit',
    mode: 'same-origin',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  })
  const body = (await response.json().catch(() => undefined)) as
    | ApiResponse<T>
    | undefined
  if (!response.ok || !body?.success || body.data === undefined) {
    throw createServerError({
      response: {
        status: response.status,
        data: body ?? { message_key: 'Failed to query logs' },
      },
    })
  }
  return body.data
}

export function getPublicKeyUsageSettings(signal: AbortSignal) {
  return publicKeyUsageRequest<KeyUsageSettings>(
    '/api/key-usage/settings',
    signal
  )
}

async function requestKeyUsage<T>(
  access: KeyUsageAccess,
  params: URLSearchParams,
  forExport: boolean,
  signal: AbortSignal,
  language: string
): Promise<T> {
  if (access.kind === 'public') {
    const path = forExport ? '/api/key-usage/export' : '/api/key-usage/'
    return publicKeyUsageRequest<T>(
      `${path}?${params}`,
      signal,
      language,
      access.key
    )
  }

  const suffix = forExport ? '/export' : ''
  const { data } = await api.get<ApiResponse<T>>(
    `/api/token/${encodeURIComponent(access.keyId)}/usage${suffix}?${params}`,
    { signal, skipErrorHandler: true, disableDuplicate: true }
  )
  if (!data.success || data.data === undefined) throw createServerError(data)
  return data.data
}

function buildParams(filters: KeyUsageFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (
    filters.start_timestamp !== undefined &&
    filters.end_timestamp !== undefined
  ) {
    params.set('start_timestamp', String(filters.start_timestamp))
    params.set('end_timestamp', String(filters.end_timestamp))
  }
  if (filters.model_name) params.set('model_name', filters.model_name)
  return params
}

export function getKeyUsage(
  access: KeyUsageAccess,
  filters: KeyUsageFilters,
  page: number,
  signal: AbortSignal,
  language: string
): Promise<KeyUsageResult> {
  const params = buildParams(filters)
  params.set('p', String(page))
  params.set('page_size', String(KEY_USAGE_PAGE_SIZE))
  return requestKeyUsage(access, params, false, signal, language)
}

export function exportKeyUsage(
  access: KeyUsageAccess,
  filters: KeyUsageFilters,
  signal: AbortSignal,
  language: string
): Promise<KeyUsageExport> {
  return requestKeyUsage(access, buildParams(filters), true, signal, language)
}
