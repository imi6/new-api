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

import { PublicLayout, SectionPageLayout } from '@/components/layout'
import { PageTransition } from '@/components/page-transition'

import { PartnerBoard } from './components/partner-board'

/** The public page linked from the top navigation. */
export function PartnerPublic() {
  const { t } = useTranslation()
  return (
    <PublicLayout showMainContainer={false}>
      <PageTransition className='mx-auto flex w-full max-w-5xl flex-col gap-4 px-3 pt-20 pb-10 sm:px-6'>
        <h1 className='text-2xl font-semibold'>{t('Supplier application')}</h1>
        <PartnerBoard />
      </PageTransition>
    </PublicLayout>
  )
}

/** The same page inside the console, linked from the Personal menu. */
export function PartnerApply() {
  const { t } = useTranslation()
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Supplier application')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='mx-auto w-full max-w-5xl'>
          <PartnerBoard />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
