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
import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  formatQuota,
  parseQuotaFromDollars,
  quotaUnitsToDollars,
} from '@/lib/format'
import { getServerMessage } from '@/lib/server-error-message'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import {
  claimAffiliateRebate,
  getAffiliateRebate,
  type AffiliateRebateSummary,
} from '../api'

export function AffiliateRebatePage(props: { onClaimed?: () => void }) {
  const { t } = useTranslation()
  const quotaPerUnit = useSystemConfigStore(
    (state) => state.config.currency.quotaPerUnit
  )
  const minimumQuota = Math.ceil(
    quotaPerUnit > 0 ? quotaPerUnit : DEFAULT_CURRENCY_CONFIG.quotaPerUnit
  )
  const [summary, setSummary] = useState<AffiliateRebateSummary | null>(null)
  const [amount, setAmount] = useState(0)
  const [claiming, setClaiming] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const body = await getAffiliateRebate()
    if (body.success && body.data) {
      setSummary(body.data)
      setAmount(quotaUnitsToDollars(body.data.claimable))
      setError('')
      return
    }
    setError(getServerMessage(body) || t('Failed to load referral rebate'))
  }, [t])

  useEffect(() => {
    let cancelled = false
    load().catch(() => {
      if (!cancelled) setError(t('Failed to load referral rebate'))
    })
    return () => {
      cancelled = true
    }
  }, [load, t])

  const claimable = summary?.claimable ?? 0
  const fullAmount = quotaUnitsToDollars(claimable)
  const claimQuota = amount === fullAmount ? claimable : parseQuotaFromDollars(amount)
  const percent = summary?.percent ?? 0
  const weekClaimed = summary?.week_claimed ?? 0
  const requiredConsumption =
    percent > 0 && claimQuota > 0
      ? Math.ceil(((weekClaimed + claimQuota) * 100) / percent)
      : 0
  const canSubmit =
    !claiming &&
    summary?.can_claim === true &&
    claimQuota >= minimumQuota &&
    claimQuota <= claimable &&
    (summary?.week_paid_consumed ?? 0) >= requiredConsumption

  const claim = async () => {
    if (!canSubmit) return
    setClaiming(true)
    try {
      const body = await claimAffiliateRebate(claimQuota)
      if (!body.success) {
        setError(getServerMessage(body) || t('Failed to claim referral rebate'))
        return
      }
      props.onClaimed?.()
      await load()
    } catch {
      setError(t('Failed to claim referral rebate'))
    } finally {
      setClaiming(false)
    }
  }

  return (
    <div className='mx-auto flex w-full max-w-3xl flex-col gap-4'>
      <Button
        variant='outline'
        className='w-fit'
        render={<Link to='/wallet' />}
      >
        {t('Back to wallet')}
      </Button>
      <div className='grid gap-3 sm:grid-cols-3'>
        <Stat
          label={t('Claimable rebate')}
          value={formatQuota(summary?.claimable ?? 0)}
        />
        <Stat
          label={t('Accrued rebate')}
          value={formatQuota(summary?.accrued ?? 0)}
        />
        <Stat
          label={t('Claimed rebate')}
          value={formatQuota(summary?.claimed ?? 0)}
        />
      </div>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Rebate is {{percent}}% of paid consumption after an invitee spends {{downstream}}. You can claim it after your own paid consumption reaches {{upstream}}.',
          {
            percent: summary?.percent ?? 0,
            downstream: formatQuota(summary?.downstream_threshold ?? 0),
            upstream: formatQuota(summary?.upstream_minimum ?? 0),
          }
        )}
      </p>
      <p className='text-sm'>
        {t('Your paid consumption')}: {formatQuota(summary?.paid_consumed ?? 0)}
      </p>
      <p className='text-sm'>
        {t('Your last 7 days paid consumption')}:{' '}
        {formatQuota(summary?.week_paid_consumed ?? 0)}
      </p>
      <p className='text-sm'>
        {t('Claimed in the last 7 days')}: {formatQuota(weekClaimed)}
      </p>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Claims in the last 7 days are added together. To claim {{amount}} now, your paid consumption in the last 7 days must be at least {{required}}.',
          {
            amount: formatQuota(claimQuota),
            required: formatQuota(requiredConsumption),
          }
        )}
      </p>
      <div className='flex max-w-xs flex-col gap-2'>
        <Label htmlFor='affiliate-rebate-amount'>{t('Amount to claim')}</Label>
        <Input
          id='affiliate-rebate-amount'
          type='number'
          min={0}
          step='0.01'
          value={Number.isFinite(amount) ? amount : ''}
          onChange={(event) => {
            const next = event.currentTarget.valueAsNumber
            setAmount(Number.isNaN(next) ? 0 : next)
          }}
        />
      </div>
      {claimable > 0 && claimable < minimumQuota ? (
        <p className='text-muted-foreground text-sm'>
          {t('Minimum transfer quota is {{min}}!', {
            min: formatQuota(minimumQuota),
          })}
        </p>
      ) : null}
      {error ? <p className='text-destructive text-sm'>{error}</p> : null}
      <Button className='w-fit' onClick={claim} disabled={!canSubmit}>
        {t('Claim rebate to balance')}
      </Button>
      <div className='flex flex-col gap-2'>
        <h2 className='text-sm font-medium'>{t('Invitees')}</h2>
        {(summary?.invitees ?? []).length === 0 ? (
          <p className='text-muted-foreground text-sm'>{t('No invitees yet')}</p>
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
              <span className='shrink-0 font-medium'>
                {formatQuota(invitee.rebate)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function Stat(props: { label: string; value: string }) {
  return (
    <div className='rounded-lg border p-3'>
      <div className='text-muted-foreground text-xs'>{props.label}</div>
      <div className='mt-1 text-lg font-semibold'>{props.value}</div>
    </div>
  )
}
