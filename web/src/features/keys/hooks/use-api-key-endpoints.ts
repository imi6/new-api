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
import { useTranslation } from 'react-i18next'

import { useApiInfo } from '@/features/dashboard/hooks/use-status-data'
import { useStatus } from '@/hooks/use-status'
import { useAuthStore } from '@/stores/auth-store'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

export interface ApiKeyEndpoint {
  url: string
  route: string
  description: string
}

/** 密钥页面所有节点入口共用可见性和额度门槛，避免弹窗绕过列表筛选。 */
export function useApiKeyEndpoints(): {
  endpoints: ApiKeyEndpoint[]
  loading: boolean
} {
  const { t } = useTranslation()
  const { status, loading } = useStatus()
  const { items } = useApiInfo()
  const user = useAuthStore((state) => state.auth.user)
  const configuredQuotaPerUnit = useSystemConfigStore(
    (state) => state.config.currency.quotaPerUnit
  )
  const quotaPerUnit =
    Number.isFinite(configuredQuotaPerUnit) && configuredQuotaPerUnit > 0
      ? configuredQuotaPerUnit
      : DEFAULT_CURRENCY_CONFIG.quotaPerUnit
  // 可见门槛按美元计算，不受页面展示币种或汇率影响。
  const usedQuotaUsd = (user?.used_quota ?? 0) / quotaPerUnit
  const quotaUsd = (user?.quota ?? 0) / quotaPerUnit

  const endpoints: ApiKeyEndpoint[] = []
  const urls = new Set<string>()
  for (const item of items) {
    if (item.show_in_keys === false) continue
    const usedThreshold = item.min_used_quota_usd ?? 0
    const quotaThreshold = item.min_quota_usd ?? 0
    if (usedThreshold > 0 || quotaThreshold > 0) {
      const usedOk = usedThreshold > 0 && usedQuotaUsd >= usedThreshold
      const quotaOk = quotaThreshold > 0 && quotaUsd >= quotaThreshold
      if (!usedOk && !quotaOk) continue
    }

    const url = item.url.trim()
    if (!url || urls.has(url)) continue
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue
    } catch {
      continue
    }
    urls.add(url)
    endpoints.push({
      url,
      route: item.route || url,
      description: item.description || '',
    })
  }

  if (endpoints.length === 0) {
    const serverAddress =
      typeof status?.server_address === 'string'
        ? status.server_address.trim()
        : ''
    let url = window.location.origin
    if (serverAddress) {
      try {
        const parsed = new URL(serverAddress)
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
          url = serverAddress
        }
      } catch {
        // 后台地址无效时使用当前站点，不生成不可用的连接信息。
      }
    }
    endpoints.push({
      url,
      route:
        url === serverAddress ? t('Default API address') : t('Current domain'),
      description: '',
    })
  }

  return { endpoints, loading }
}
