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
import { Gift, RefreshCw, User, Clock, ChevronRight } from 'lucide-react'
import { Link } from '@tanstack/react-router'

import { SectionPageLayout } from '@/components/layout'
import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatQuota, quotaUnitsToDollars } from '@/lib/format'
import { getSelf } from '@/lib/api'
import { getServerMessage } from '@/lib/server-error-message'
import {
  getAffiliateCode,
  getAffiliateRebate,
  claimAffiliateRebate,
  type AffiliateRebateSummary,
} from '@/features/wallet/api'
import { generateAffiliateLink } from '@/features/wallet/lib'
import { TransferDialog } from '@/features/wallet/components/dialogs/transfer-dialog'
import { useAffiliate } from '@/features/wallet/hooks'
import type { UserWalletData } from '@/features/wallet/types'

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
  const [transferOpen, setTransferOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [claimError, setClaimError] = useState('')

  const { transferQuota, transferring } = useAffiliate()

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
    await fetchAll().catch(() => undefined)
    setRefreshing(false)
  }

  const handleTransfer = async (quota: number): Promise<boolean> => {
    const ok = await transferQuota(quota)
    if (ok) await fetchAll()
    return ok
  }

  const handleClaim = async () => {
    const claimable = summary?.claimable ?? 0
    if (!summary?.can_claim || claimable <= 0) return
    setClaiming(true)
    setClaimError('')
    try {
      const res = await claimAffiliateRebate(claimable)
      if (!res.success) {
        setClaimError(getServerMessage(res) || t('Failed to claim referral rebate'))
        return
      }
      await fetchAll()
    } catch {
      setClaimError(t('Failed to claim referral rebate'))
    } finally {
      setClaiming(false)
    }
  }

  const claimable = summary?.claimable ?? 0
  const accrued = summary?.accrued ?? 0
  const affQuota = user?.aff_quota ?? 0
  const affHistoryQuota = user?.aff_history_quota ?? 0
  const affCount = user?.aff_count ?? 0

  return (
    <>
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
              {t('Share invite code, rebate amount can be transferred to account balance.')}
            </p>

            {/* Stat cards */}
            <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
              {userLoading || summaryLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className='h-24 rounded-xl' />
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
                    value={String(affCount)}
                    sub={t('Completed binding users')}
                  />
                  <StatCard
                    tone='teal'
                    icon={<Clock className='size-4' />}
                    label={t('Claimable rebate')}
                    value={formatQuota(claimable)}
                    sub={t('Transferable to balance')}
                  />
                  <StatCard
                    tone='yellow'
                    icon={<Gift className='size-4' />}
                    label={t('Accrued rebate')}
                    value={formatQuota(accrued)}
                    sub={`${t('Locked')} ${formatQuota(affHistoryQuota - affQuota - (summary?.claimed ?? 0))}`}
                  />
                </>
              )}
            </div>

            <div className='grid gap-4 lg:grid-cols-[1fr_280px]'>
              {/* Left: invite code + invitees */}
              <div className='flex flex-col gap-4'>
                <Card>
                  <CardContent className='flex flex-col gap-4 p-4'>
                    <div className='flex items-center gap-3'>
                      <div className='bg-orange-100 dark:bg-orange-900/30 flex size-9 shrink-0 items-center justify-center rounded-lg'>
                        <Gift
                          className='size-5 text-orange-500 dark:text-orange-400'
                          aria-hidden='true'
                        />
                      </div>
                      <div>
                        <h3 className='text-sm font-semibold'>{t('Exclusive invite')}</h3>
                        <p className='text-muted-foreground text-xs'>
                          {t('Copy invite code or register link for new users.')}
                        </p>
                      </div>
                    </div>

                    <div className='flex flex-col gap-2'>
                      <label className='text-xs font-medium'>{t('Invite code')}</label>
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
                      <label className='text-xs font-medium'>{t('Invite link')}</label>
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
                    {summaryLoading ? (
                      <Skeleton className='h-20 rounded-lg' />
                    ) : (summary?.invitees ?? []).length === 0 ? (
                      <div className='flex flex-col items-center gap-2 py-8'>
                        <div className='bg-muted flex size-12 items-center justify-center rounded-full'>
                          <User className='text-muted-foreground size-6' aria-hidden='true' />
                        </div>
                        <p className='text-muted-foreground text-sm'>
                          {t('No invitees yet')}
                        </p>
                      </div>
                    ) : (
                      summary?.invitees.map((invitee) => (
                        <div
                          key={invitee.user_id}
                          className='flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm'
                        >
                          <span className='truncate'>{invitee.username}</span>
                          <span className='text-muted-foreground shrink-0'>
                            {t('Paid consumption')} {formatQuota(invitee.paid_consumed)}
                          </span>
                          <span className='shrink-0 font-semibold tabular-nums'>
                            {formatQuota(invitee.rebate)}
                          </span>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Right: transfer sidebar */}
              <div className='flex flex-col gap-4'>
                <Card>
                  <CardContent className='flex flex-col gap-4 p-4'>
                    <div className='flex items-center gap-2 text-sm font-medium'>
                      <Gift className='size-4' aria-hidden='true' />
                      {t('Transfer to balance')}
                    </div>

                    <div>
                      <div className='text-muted-foreground text-xs'>{t('Claimable rebate')}</div>
                      <div className='mt-1 text-2xl font-bold tabular-nums text-orange-500 dark:text-orange-400'>
                        {formatQuota(claimable)}
                      </div>
                    </div>

                    <div className='flex flex-col gap-1.5 text-xs'>
                      <div className='flex justify-between'>
                        <span className='text-muted-foreground'>{t('Locked')}</span>
                        <span className='tabular-nums'>
                          {formatQuota(affHistoryQuota - affQuota - (summary?.claimed ?? 0))}
                        </span>
                      </div>
                      <div className='flex justify-between'>
                        <span className='text-muted-foreground'>{t('Accrued rebate')}</span>
                        <span className='tabular-nums'>{formatQuota(accrued)}</span>
                      </div>
                      <div className='flex justify-between'>
                        <span className='text-muted-foreground'>{t('Invited users')}</span>
                        <span className='tabular-nums'>{affCount} {t('person', { count: affCount })}</span>
                      </div>
                    </div>

                    {claimError && (
                      <p className='text-destructive text-xs'>{claimError}</p>
                    )}

                    <Button
                      className='w-full bg-orange-500 text-white hover:bg-orange-600 dark:bg-orange-600 dark:hover:bg-orange-700'
                      onClick={handleClaim}
                      disabled={
                        !summary?.can_claim || claimable <= 0 || claiming
                      }
                    >
                      <Gift className='mr-1.5 size-4' aria-hidden='true' />
                      {t('Claim rebate to balance')}
                    </Button>

                    <Button
                      variant='link'
                      size='sm'
                      className='h-auto px-0 text-xs'
                      render={<Link to='/wallet' />}
                    >
                      {t('View recharge history')}
                      <ChevronRight className='ml-0.5 size-3' aria-hidden='true' />
                    </Button>
                  </CardContent>
                </Card>

                <Button
                  variant='outline'
                  className='w-full'
                  onClick={() => setTransferOpen(true)}
                  disabled={affQuota <= 0 || transferring}
                >
                  {t('Transfer to Balance')}
                </Button>
              </div>
            </div>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        onConfirm={handleTransfer}
        availableQuota={affQuota}
        transferring={transferring}
      />
    </>
  )
}
