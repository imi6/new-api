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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  exchangeAffiliateRebate,
  previewAffiliateExchange,
} from '@/features/affiliate-cash/api'
import { formatUAmount } from '@/features/affiliate-cash/lib/amount'
import type {
  AffiliateCashDestination,
  AffiliateCashSummary,
  AffiliateExchangePreview,
} from '@/features/affiliate-cash/types'
import {
  formatQuota,
  parseQuotaFromDollars,
  quotaUnitsToDollars,
} from '@/lib/format'
import { getServerErrorMessage } from '@/lib/server-error-message'

const claimSchema = z.object({
  amount: z
    .string()
    .trim()
    .refine(
      (value) =>
        value !== '' && Number.isFinite(Number(value)) && Number(value) > 0,
      'Amount must be greater than zero'
    ),
})

interface AffiliateClaimCardProps {
  summary: AffiliateCashSummary
  onChanged: () => Promise<void>
}

export function AffiliateClaimCard(props: AffiliateClaimCardProps) {
  const { t } = useTranslation()
  const id = useId()
  const [destination, setDestination] =
    useState<AffiliateCashDestination>('platform')
  const [confirmation, setConfirmation] = useState<{
    preview: AffiliateExchangePreview
    requestID: string
  } | null>(null)
  const [error, setError] = useState('')
  const attempt = useRef<{ signature: string; id: string } | null>(null)
  const form = useForm<z.infer<typeof claimSchema>>({
    resolver: zodResolver(claimSchema),
    defaultValues: { amount: '' },
  })
  const maximum =
    destination === 'u'
      ? props.summary.max_u_exchange_quota
      : props.summary.max_platform_claim_quota
  const reason =
    destination === 'u'
      ? props.summary.exchange_reason
      : props.summary.platform_reason

  const preview = useMutation({
    mutationFn: previewAffiliateExchange,
    meta: { errorToast: false },
    onSuccess: (result) => {
      if (!result.can_submit) {
        setError(t(result.reason || 'This rebate cannot be claimed right now'))
        return
      }
      const signature = JSON.stringify([
        result.quota,
        result.destination,
        result.config_version,
      ])
      if (attempt.current?.signature !== signature) {
        attempt.current = { signature, id: crypto.randomUUID() }
      }
      setConfirmation({ preview: result, requestID: attempt.current.id })
      setError('')
    },
    onError: (cause) => setError(getServerErrorMessage(cause)),
  })
  const submit = useMutation({
    mutationFn: exchangeAffiliateRebate,
    meta: { errorToast: false },
    onSuccess: async () => {
      setConfirmation(null)
      attempt.current = null
      form.reset()
      setError('')
      await props.onChanged()
    },
    onError: (cause) => setError(getServerErrorMessage(cause)),
  })

  const handlePreview = form.handleSubmit((values) => {
    const entered = Number(values.amount)
    const fullAmount = quotaUnitsToDollars(maximum)
    const quota =
      entered === fullAmount ? maximum : parseQuotaFromDollars(entered)
    if (!Number.isSafeInteger(quota) || quota <= 0 || quota > maximum) {
      form.setError('amount', {
        message: 'The amount exceeds the current claim limit',
      })
      return
    }
    preview.mutate({ quota, destination })
  })
  const busy = preview.isPending || submit.isPending
  const isU = confirmation?.preview.destination === 'u'

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Claim referral rebate')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div>
          <p className='text-muted-foreground text-xs'>
            {t('Unclaimed rebate')}
          </p>
          <p className='text-xl font-semibold tabular-nums'>
            {formatQuota(props.summary.rebate_unclaimed_quota)}
          </p>
        </div>
        <form onSubmit={handlePreview} className='space-y-3'>
          <RadioGroup
            value={destination}
            onValueChange={(value) => {
              if (value === 'platform' || value === 'u') {
                setDestination(value)
                form.clearErrors()
                setError('')
              }
            }}
            aria-label={t('Rebate destination')}
            disabled={busy}
          >
            <Label className='flex items-center gap-2'>
              <RadioGroupItem value='platform' />
              {t('Transfer to platform balance')}
            </Label>
            <Label className='flex items-center gap-2'>
              <RadioGroupItem value='u' />
              {t('Convert to withdrawable U')}
            </Label>
          </RadioGroup>
          <div className='space-y-2'>
            <Label htmlFor={id}>{t('Amount to claim')}</Label>
            <div className='flex gap-2'>
              <Input
                id={id}
                inputMode='decimal'
                {...form.register('amount')}
                disabled={busy}
                aria-invalid={Boolean(form.formState.errors.amount)}
              />
              <Button
                type='button'
                variant='outline'
                disabled={busy || maximum <= 0}
                onClick={() =>
                  form.setValue(
                    'amount',
                    String(quotaUnitsToDollars(maximum)),
                    { shouldValidate: true }
                  )
                }
              >
                {t('All')}
              </Button>
            </div>
            {form.formState.errors.amount && (
              <p role='alert' className='text-destructive text-xs'>
                {t(form.formState.errors.amount.message || 'Invalid amount')}
              </p>
            )}
          </div>
          <p className='text-muted-foreground text-xs'>
            {t('Maximum available now')}: {formatQuota(maximum)}
          </p>
          {maximum <= 0 && (
            <p className='text-muted-foreground text-xs'>
              {t(reason || 'This rebate cannot be claimed right now')}
            </p>
          )}
          {error && !confirmation && (
            <p role='alert' className='text-destructive text-sm'>
              {error}
            </p>
          )}
          <Button
            type='submit'
            className='w-full'
            disabled={busy || maximum <= 0}
          >
            {preview.isPending ? t('Loading...') : t('Review claim')}
          </Button>
        </form>
        <ConfirmDialog
          open={confirmation !== null}
          onOpenChange={(open) => {
            if (!open && !submit.isPending) {
              setConfirmation(null)
              setError('')
            }
          }}
          title={
            isU
              ? t('Confirm conversion to U')
              : t('Confirm transfer to platform balance')
          }
          desc={
            isU
              ? t(
                  'Conversion to U is irreversible. Review the amount and withdrawal restrictions before confirming.'
                )
              : t(
                  'This claim will be credited to your platform balance for consumption.'
                )
          }
          isLoading={submit.isPending}
          confirmText={isU ? t('Confirm conversion') : t('Confirm transfer')}
          handleConfirm={() => {
            if (!confirmation || submit.isPending) return
            submit.mutate({
              quota: confirmation.preview.quota,
              destination: confirmation.preview.destination,
              config_version: confirmation.preview.config_version,
              request_id: confirmation.requestID,
              confirmed: true,
            })
          }}
        >
          {confirmation && (
            <div className='space-y-3 text-sm'>
              <div className='flex justify-between gap-4'>
                <span>{t('Rebate deducted')}</span>
                <strong>{formatQuota(confirmation.preview.quota)}</strong>
              </div>
              <div className='flex justify-between gap-4'>
                <span>{t('Amount credited')}</span>
                <strong>
                  {isU
                    ? formatUAmount(confirmation.preview.u_amount)
                    : formatQuota(confirmation.preview.quota)}
                </strong>
              </div>
              {isU && (
                <>
                  <div className='flex justify-between gap-4'>
                    <span>{t('U conversion rate')}</span>
                    <span>{confirmation.preview.exchange_rate}</span>
                  </div>
                  <div className='flex justify-between gap-4'>
                    <span>{t('Minimum withdrawal')}</span>
                    <span>
                      {formatUAmount(confirmation.preview.minimum_withdrawal)}
                    </span>
                  </div>
                  <Alert>
                    <AlertDescription>
                      {t(
                        'U cannot be transferred back to platform balance. Conversion does not mean payment has been sent. Amounts below the withdrawal minimum must accumulate; no small-balance withdrawal or clearing is available. Any U balance or unfinished withdrawal prevents account deletion, potentially indefinitely if you stop accumulating.'
                      )}
                    </AlertDescription>
                  </Alert>
                </>
              )}
              {error && (
                <p role='alert' className='text-destructive'>
                  {error}
                </p>
              )}
            </div>
          )}
        </ConfirmDialog>
      </CardContent>
    </Card>
  )
}
