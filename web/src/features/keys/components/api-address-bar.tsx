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

import { CopyButton } from '@/components/copy-button'
import { useApiInfo } from '@/features/dashboard/hooks/use-status-data'
import { quotaUnitsToDollars } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'
import { useStatus } from '@/hooks/use-status'

/**
 * Inline address bar shown below the search/filter toolbar on the API keys page.
 * Applies the same show_in_keys / quota-threshold filters as the popover.
 */
export function ApiAddressBar() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const { items } = useApiInfo()
  const user = useAuthStore((s) => s.auth.user)

  const usedQuotaUsd = quotaUnitsToDollars(user?.used_quota ?? 0)
  const quotaUsd = quotaUnitsToDollars(user?.quota ?? 0)

  const serverAddress =
    (typeof status?.server_address === 'string' &&
      status.server_address.trim()) ||
    ''

  const visibleItems = items.filter((item) => {
    if (item.show_in_keys === false) return false
    if (item.min_used_quota_usd && item.min_used_quota_usd > 0) {
      if (usedQuotaUsd < item.min_used_quota_usd) return false
    }
    if (item.min_quota_usd && item.min_quota_usd > 0) {
      if (quotaUsd < item.min_quota_usd) return false
    }
    return true
  })

  const addresses = visibleItems.length
    ? visibleItems
    : serverAddress
      ? [{ url: serverAddress, route: t('Default API address'), description: '' }]
      : []

  if (addresses.length === 0) return null

  return (
    <div className='flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm'>
      {addresses.map((address) => (
        <div
          key={address.url}
          className='flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1'
        >
          <span className='text-muted-foreground shrink-0 text-xs font-medium'>
            {address.route}
          </span>
          <span className='text-muted-foreground mx-1 text-xs'>|</span>
          <code className='max-w-[200px] truncate text-xs select-text'>
            {address.url}
          </code>
          <CopyButton
            value={address.url}
            size='sm'
            className='size-5 shrink-0'
            iconClassName='size-3'
            tooltip={t('Copy API URL')}
            aria-label={`${t('Copy API URL')}: ${address.url}`}
          />
        </div>
      ))}
    </div>
  )
}
