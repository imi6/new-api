import { useQueryClient } from '@tanstack/react-query'
import { Gift, RefreshCw, User, Clock, Wallet } from 'lucide-react'
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
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { AFFILIATE_CASH_QUERY_KEY } from '@/features/affiliate-cash/api'
import { formatUAmount } from '@/features/affiliate-cash/lib/amount'
import { useAffiliateCash } from '@/features/affiliate-cash/lib/use-affiliate-cash'
import {
  getAffiliateCode,
  getAffiliateRebate,
  type AffiliateRebateSummary,
} from '@/features/wallet/api'
import { generateAffiliateLink } from '@/features/wallet/lib'
import type { UserWalletData } from '@/features/wallet/types'
import { getSelf } from '@/lib/api'
import { formatQuota } from '@/lib/format'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { AffiliateCashHistory } from './components/affiliate-cash-history'
import { AffiliateClaimCard } from './components/affiliate-claim-card'
import { AffiliateWithdrawalCard } from './components/affiliate-withdrawal-card'

// ─────────────────────────────────────────────────────────────────────────────
// Stat card
// ─────────────────────────────────────────────────────────────────────────────

interface StatCardProps {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  tone?: 'default' | 'orange' | 'teal' | 'yellow'
}

function StatCard(props: StatCardProps) {
  const toneClass: Record<string, string> = {
    default: 'bg-muted/40',
    orange: 'bg-orange-50/70 dark:bg-orange-950/20',
    teal: 'bg-teal-50/70 dark:bg-teal-950/20',
    yellow: 'bg-yellow-50/70 dark:bg-yellow-950/20',
  }
  return (
    <div
      className={`flex flex-col gap-2 rounded-xl border p-4 ${toneClass[props.tone ?? 'default']}`}
    >
      <div className='flex items-center gap-2'>
        <span className='text-muted-foreground'>{props.icon}</span>
        <span className='text-muted-foreground text-xs'>{props.label}</span>
      </div>
      <div className='text-xl font-bold tabular-nums'>{props.value}</div>
      {props.sub != null && (
        <div className='text-muted-foreground text-xs'>{props.sub}</div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export function ReferralPage() {
  const { t } = useTranslation()

  const [user, setUser] = useState<UserWalletData | null>(null)
  const [userLoading, setUserLoading] = useState(true)
  const [summary, setSummary] = useState<AffiliateRebateSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [affiliateCode, setAffiliateCode] = useState('')
  const [affiliateLink, setAffiliateLink] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const cash = useAffiliateCash()
  const queryClient = useQueryClient()

  const fetchAll = useCallback(async () => {
    await Promise.all([
      getSelf().then((res) => {
        if (res.success && res.data) setUser(res.data as UserWalletData)
        setUserLoading(false)
      }),
      getAffiliateRebate().then((res) => {
        if (res.success && res.data) setSummary(res.data)
        setSummaryLoading(false)
      }),
      getAffiliateCode().then((res) => {
        if (res.success && res.data) {
          setAffiliateCode(res.data)
          setAffiliateLink(generateAffiliateLink(res.data))
        }
      }),
    ])
  }, [])

  useEffect(() => {
    fetchAll().catch(() => {
      setUserLoading(false)
      setSummaryLoading(false)
    })
  }, [fetchAll])

  const handleRefresh = async () => {
    setRefreshing(true)
    await Promise.all([fetchAll(), cash.refetch()]).catch(() => undefined)
    setRefreshing(false)
  }

  const handleCashChanged = async () => {
    // 资金操作已经成功，后续视图刷新失败不能被当作扣款失败重试。
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: AFFILIATE_CASH_QUERY_KEY }),
      fetchAll(),
    ])
  }

  const claimable = summary?.claimable ?? 0
  const accrued = summary?.accrued ?? 0

  const affCount = user?.aff_count ?? 0

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Referral rebate')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          variant='outline'
          size='sm'
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label={t('Refresh')}
        >
          <RefreshCw
            className={`mr-1.5 size-3.5 ${refreshing ? 'animate-spin' : ''}`}
            aria-hidden='true'
          />
          {t('Refresh')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='mx-auto flex w-full max-w-5xl flex-col gap-4'>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Share your invitation and choose how to claim your consumption rebate.'
            )}
          </p>

          {/* Stat cards */}
          <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5'>
            {userLoading || summaryLoading ? (
              ['rate', 'invitees', 'unclaimed', 'accrued', 'u'].map((name) => (
                <Skeleton key={name} className='h-24 rounded-xl' />
              ))
            ) : (
              <>
                <StatCard
                  tone='orange'
                  icon={<Gift className='size-4' />}
                  label={t('Rebate rate')}
                  value={`${summary?.percent ?? 0}%`}
                  sub={t('Current account effective rate')}
                />
                <StatCard
                  tone='default'
                  icon={<User className='size-4' />}
                  label={t('Invited users')}
                  value={String(summary?.invitees?.length ?? affCount)}
                  sub={t('Completed binding users')}
                />
                <StatCard
                  tone='teal'
                  icon={<Clock className='size-4' />}
                  label={t('Unclaimed rebate')}
                  value={formatQuota(claimable)}
                  sub={t('Subject to current claim limits')}
                />
                <StatCard
                  tone='yellow'
                  icon={<Gift className='size-4' />}
                  label={t('Accrued rebate')}
                  value={formatQuota(accrued)}
                  sub={t('Total rebate earned')}
                />
                <StatCard
                  tone='teal'
                  icon={<Wallet className='size-4' />}
                  label={t('Available U')}
                  value={cash.data ? formatUAmount(cash.data.u_available) : '—'}
                  sub={t('Separate from platform balance')}
                />
              </>
            )}
          </div>

          <div className='grid gap-4 lg:grid-cols-[1fr_320px]'>
            {/* Left: invite code + invitees */}
            <div className='flex flex-col gap-4'>
              <Card>
                <CardContent className='flex flex-col gap-4 p-4'>
                  <div className='flex items-center gap-3'>
                    <div className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/30'>
                      <Gift
                        className='size-5 text-orange-500 dark:text-orange-400'
                        aria-hidden='true'
                      />
                    </div>
                    <div>
                      <h3 className='text-sm font-semibold'>
                        {t('Exclusive invite')}
                      </h3>
                      <p className='text-muted-foreground text-xs'>
                        {t('Copy invite code or register link for new users.')}
                      </p>
                    </div>
                  </div>

                  <div className='flex flex-col gap-2'>
                    <label className='text-xs font-medium'>
                      {t('Invite code')}
                    </label>
                    <div className='flex items-center gap-2'>
                      <Input
                        value={affiliateCode}
                        readOnly
                        className='font-mono text-sm'
                        aria-label={t('Invite code')}
                      />
                      <CopyButton
                        value={affiliateCode}
                        variant='outline'
                        className='size-9 shrink-0'
                        iconClassName='size-4'
                        tooltip={t('Copy invite code')}
                        aria-label={t('Copy invite code')}
                      />
                    </div>
                  </div>

                  <div className='flex flex-col gap-2'>
                    <label className='text-xs font-medium'>
                      {t('Invite link')}
                    </label>
                    <div className='flex items-center gap-2'>
                      <Input
                        value={affiliateLink}
                        readOnly
                        className='font-mono text-xs'
                        aria-label={t('Invite link')}
                      />
                      <CopyButton
                        value={affiliateLink}
                        variant='outline'
                        className='size-9 shrink-0'
                        iconClassName='size-4'
                        tooltip={t('Copy referral link')}
                        aria-label={t('Copy referral link')}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Rebate groups card */}
              {!summaryLoading && summary != null && (
                <Card>
                  <CardContent className='flex flex-col gap-3 p-4'>
                    <h3 className='text-sm font-semibold'>
                      {t('Groups that earn rebate')}
                    </h3>
                    {(summary.rebate_groups ?? []).length === 0 ? (
                      <p className='text-muted-foreground text-sm'>
                        {t('All groups earn rebate')}
                      </p>
                    ) : (
                      <div className='flex flex-wrap gap-1.5'>
                        {summary.rebate_groups.map((group) => (
                          <Badge
                            key={group}
                            variant='secondary'
                            className='text-xs'
                          >
                            {group}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Invitee list */}
              <Card>
                <CardContent className='flex flex-col gap-3 p-4'>
                  <h3 className='text-sm font-semibold'>
                    {t('Invitees')}
                    <span className='text-muted-foreground ml-1.5 text-xs font-normal'>
                      {t('{{count}} records', {
                        count: summary?.invitees?.length ?? 0,
                      })}
                    </span>
                  </h3>
                  {summaryLoading && <Skeleton className='h-20 rounded-lg' />}
                  {!summaryLoading &&
                    (summary?.invitees ?? []).length === 0 && (
                      <div className='flex flex-col items-center gap-2 py-8'>
                        <div className='bg-muted flex size-12 items-center justify-center rounded-full'>
                          <User
                            className='text-muted-foreground size-6'
                            aria-hidden='true'
                          />
                        </div>
                        <p className='text-muted-foreground text-sm'>
                          {t('No invitees yet')}
                        </p>
                      </div>
                    )}
                  {!summaryLoading &&
                    summary?.invitees.map((invitee) => (
                      <div
                        key={invitee.user_id}
                        className='flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm'
                      >
                        <span className='truncate'>{invitee.username}</span>
                        <span className='text-muted-foreground shrink-0'>
                          {t('Paid consumption')}{' '}
                          {formatQuota(invitee.paid_consumed)}
                        </span>
                        <span className='shrink-0 font-semibold tabular-nums'>
                          {formatQuota(invitee.rebate)}
                        </span>
                      </div>
                    ))}
                </CardContent>
              </Card>
            </div>

            {/* 返利领取与 U 提现使用同一个后端账户快照。 */}
            <div className='flex flex-col gap-4'>
              {cash.isError && (
                <ErrorState
                  className='min-h-32'
                  description={getServerErrorMessage(cash.error)}
                  onRetry={() => {
                    void cash.refetch()
                  }}
                />
              )}
              {!cash.isError && !cash.data && (
                <Skeleton className='h-80 rounded-xl' />
              )}
              {!cash.isError && cash.data && (
                <>
                  <AffiliateClaimCard
                    summary={cash.data}
                    onChanged={handleCashChanged}
                  />
                  <AffiliateWithdrawalCard
                    summary={cash.data}
                    onChanged={handleCashChanged}
                  />
                </>
              )}
            </div>
          </div>
          <AffiliateCashHistory />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
