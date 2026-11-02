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
import { Route } from 'lucide-react'
import { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { IconBadge } from '@/components/ui/icon-badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useApiInfo } from '@/features/dashboard/hooks/use-status-data'
import {
  testUrlLatency,
  getDefaultPingStatus,
} from '@/features/dashboard/lib/api-info'
import type { PingStatusMap, ApiInfoItem } from '@/features/dashboard/types'
import { quotaUnitsToDollars } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { PanelWrapper } from '../ui/panel-wrapper'
import { ApiInfoItemComponent } from './api-info-item'

export function ApiInfoPanel() {
  const { t } = useTranslation()
  const { items, loading } = useApiInfo()
  const user = useAuthStore((s) => s.auth.user)
  const [pingStatus, setPingStatus] = useState<PingStatusMap>({})

  const usedQuotaUsd = quotaUnitsToDollars(user?.used_quota ?? 0)
  const quotaUsd = quotaUnitsToDollars(user?.quota ?? 0)

  // Apply the same visibility rules as the API Keys page address bar
  const list = useMemo(
    () =>
      items.filter((item) => {
        if (item.show_in_keys === false) return false
        const hasUsedThreshold = item.min_used_quota_usd && item.min_used_quota_usd > 0
        const hasQuotaThreshold = item.min_quota_usd && item.min_quota_usd > 0
        if (hasUsedThreshold || hasQuotaThreshold) {
          const usedOk = !hasUsedThreshold || usedQuotaUsd >= item.min_used_quota_usd
          const quotaOk = !hasQuotaThreshold || quotaUsd >= item.min_quota_usd
          if (!usedOk && !quotaOk) return false
        }
        return true
      }),
    [items, usedQuotaUsd, quotaUsd]
  )

  const handleTest = useCallback(async (url: string) => {
    setPingStatus((prev) => ({
      ...prev,
      [url]: { latency: null, testing: true, error: false },
    }))

    const result = await testUrlLatency(url)
    setPingStatus((prev) => ({ ...prev, [url]: result }))
  }, [])

  return (
    <PanelWrapper
      title={
        <span className='flex items-center gap-2'>
          <IconBadge tone='info' size='sm'>
            <Route />
          </IconBadge>
          {t('API Info')}
        </span>
      }
      description={t('Configured routes and latency checks')}
      loading={loading}
      empty={!list.length}
      emptyMessage={t('No API routes configured')}
      height='h-72'
      contentClassName='p-0'
    >
      <ScrollArea className='h-72'>
        <div>
          {list.map((item: ApiInfoItem, idx: number) => (
            <div
              key={item.url}
              className={
                idx < list.length - 1 ? 'border-border/60 border-b' : ''
              }
            >
              <ApiInfoItemComponent
                item={item}
                status={pingStatus[item.url] || getDefaultPingStatus()}
                onTest={handleTest}
              />
            </div>
          ))}
        </div>
      </ScrollArea>
    </PanelWrapper>
  )
}
