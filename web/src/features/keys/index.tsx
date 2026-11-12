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

import { SectionPageLayout } from '@/components/layout'

import { ApiKeysDialogs } from './components/api-keys-dialogs'
import { ApiKeysPrimaryButtons } from './components/api-keys-primary-buttons'
import { ApiKeysProvider } from './components/api-keys-provider'
import { ApiKeysTable } from './components/api-keys-table'
import { ApiAddressBar } from './components/api-address-bar'
import { IntelligenceTestDialog } from './components/dialogs/intelligence-test-dialog'
import { IntelligenceTestIndicator } from './components/intelligence-test-indicator'
import { IntelligenceTestProvider } from './components/intelligence-test-provider'

export function ApiKeys() {
  const { t } = useTranslation()
  return (
    <ApiKeysProvider>
      <IntelligenceTestProvider>
        <SectionPageLayout fixedContent>
          <SectionPageLayout.Title>{t('API Keys')}</SectionPageLayout.Title>
          <SectionPageLayout.Actions>
            <ApiKeysPrimaryButtons />
          </SectionPageLayout.Actions>
          <SectionPageLayout.Content>
            {/* The content area does not scroll, so the table needs a bounded
                height to scroll its own rows, as on the models page. */}
            <div className='flex h-full min-h-0 flex-col gap-2'>
              <ApiAddressBar />
              <div className='min-h-0 flex-1'>
                <ApiKeysTable />
              </div>
            </div>
          </SectionPageLayout.Content>
        </SectionPageLayout>

        <ApiKeysDialogs />
        <IntelligenceTestDialog />
        <IntelligenceTestIndicator />
      </IntelligenceTestProvider>
    </ApiKeysProvider>
  )
}
