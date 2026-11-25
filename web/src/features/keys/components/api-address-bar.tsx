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

import { useApiKeyEndpoints } from '../hooks/use-api-key-endpoints'

/**
 * Inline address bar shown below the search/filter toolbar on the API keys page.
 * Applies the same show_in_keys / quota-threshold filters as the popover.
 */
export function ApiAddressBar() {
  const { t } = useTranslation()
  const { endpoints: addresses, loading } = useApiKeyEndpoints()

  if (loading || addresses.length === 0) return null

  return (
    <div className='bg-muted/30 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm'>
      {addresses.map((address) => (
        <div
          key={address.url}
          className='bg-background flex items-center gap-1.5 rounded-md border px-2.5 py-1'
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
