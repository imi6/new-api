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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { getAffiliateSummary } from './api'
import { AffiliateClaimsTab } from './components/affiliate-claims-tab'
import { AffiliateRankingTab } from './components/affiliate-ranking-tab'
import { AffiliateSummaryCards } from './components/affiliate-summary-cards'

const route = getRouteApi('/_authenticated/affiliate-rewards/')

/** Admin view of referral rewards: totals, the ranking and every claim. */
export function AffiliateRewards() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const tab = search.tab ?? 'ranking'

  const summary = useQuery({
    queryKey: ['affiliate-rewards', 'summary'],
    queryFn: getAffiliateSummary,
  })
  const fetching = summary.isFetching

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('Referral rewards')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          variant='outline'
          size='sm'
          onClick={() =>
            void queryClient.invalidateQueries({
              queryKey: ['affiliate-rewards'],
            })
          }
          disabled={fetching}
        >
          <RefreshCw
            className={fetching ? 'animate-spin' : undefined}
            aria-hidden='true'
          />
          {t('Refresh')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='flex flex-col gap-4'>
          <AffiliateSummaryCards
            summary={summary.data}
            loading={summary.isLoading}
            error={summary.isError}
          />
          {summary.data?.exclude_special_ratio && (
            <p className='text-muted-foreground text-sm'>
              {t(
                'Inviters whose group has a special ratio earn no rebate now. Rebate they earned before stays claimable.'
              )}
            </p>
          )}
          <Tabs
            value={tab}
            onValueChange={(value) =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  tab: value === 'ranking' ? undefined : (value as 'claims'),
                }),
                replace: true,
              })
            }
          >
            <TabsList>
              <TabsTrigger value='ranking'>{t('Invite ranking')}</TabsTrigger>
              <TabsTrigger value='claims'>{t('Claim records')}</TabsTrigger>
            </TabsList>
            <TabsContent value='ranking' className='pt-3'>
              <AffiliateRankingTab />
            </TabsContent>
            <TabsContent value='claims' className='pt-3'>
              <AffiliateClaimsTab />
            </TabsContent>
          </Tabs>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
