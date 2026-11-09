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
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  createAffiliateWithdrawal,
  previewAffiliateWithdrawal,
} from '@/features/affiliate-cash/api'
import {
  affiliateWithdrawalSchema,
  formatUAmount,
  type AffiliateWithdrawalValues,
} from '@/features/affiliate-cash/lib/amount'
import type {
  AffiliateCashSummary,
  AffiliateWithdrawalPreview,
} from '@/features/affiliate-cash/types'
import { getServerErrorMessage } from '@/lib/server-error-message'

interface AffiliateWithdrawalCardProps {
  summary: AffiliateCashSummary
  onChanged: () => Promise<void>
}

export function AffiliateWithdrawalCard(props: AffiliateWithdrawalCardProps) {
  const { t } = useTranslation()
  const id = useId()
  const [confirmation, setConfirmation] = useState<{
    preview: AffiliateWithdrawalPreview
    requestID: string
  } | null>(null)
  const [error, setError] = useState('')
  const attempt = useRef<{ signature: string; id: string } | null>(null)
  const form = useForm<AffiliateWithdrawalValues>({
    resolver: zodResolver(affiliateWithdrawalSchema),
    defaultValues: { amount: '', network: '', address: '' },
  })
  const networks = props.summary.config.networks.filter(
    (network) => network.enabled
  )
  const preview = useMutation({
    mutationFn: previewAffiliateWithdrawal,
    meta: { errorToast: false },
    onSuccess: (result) => {
      if (!result.can_submit) {
        setError(t(result.reason || 'Withdrawal is currently unavailable'))
        return
      }
      const signature = JSON.stringify([
        result.amount,
        result.network,
        result.address,
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
    mutationFn: createAffiliateWithdrawal,
    meta: { errorToast: false },
    onSuccess: async () => {
      setConfirmation(null)
      attempt.current = null
      setError('')
      form.reset()
      await props.onChanged()
    },
    onError: (cause) => setError(getServerErrorMessage(cause)),
  })
  const busy = preview.isPending || submit.isPending
  const available = props.summary.can_withdraw && networks.length > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Withdraw U')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        <dl className='space-y-2 text-sm'>
          <div className='flex justify-between gap-3'>
            <dt>{t('Available U')}</dt>
            <dd className='font-semibold tabular-nums'>
              {formatUAmount(props.summary.u_available)}
            </dd>
          </div>
          <div className='flex justify-between gap-3'>
            <dt>{t('Frozen for withdrawal')}</dt>
            <dd className='tabular-nums'>
              {formatUAmount(props.summary.u_frozen)}
            </dd>
          </div>
          <div className='flex justify-between gap-3'>
            <dt>{t('Minimum withdrawal')}</dt>
            <dd>{formatUAmount(props.summary.config.minimum_withdrawal)}</dd>
          </div>
        </dl>
        {!available && (
          <p className='text-muted-foreground text-xs'>
            {t(
              props.summary.withdrawal_reason ||
                'Withdrawal is currently unavailable'
            )}
          </p>
        )}
        <form
          onSubmit={form.handleSubmit((values) => preview.mutate(values))}
          className='space-y-3'
        >
          <div className='space-y-2'>
            <Label htmlFor={`${id}-amount`}>{t('Withdrawal amount (U)')}</Label>
            <Input
              id={`${id}-amount`}
              inputMode='decimal'
              {...form.register('amount')}
              disabled={busy || !available}
              aria-invalid={Boolean(form.formState.errors.amount)}
            />
            {form.formState.errors.amount && (
              <p role='alert' className='text-destructive text-xs'>
                {t(form.formState.errors.amount.message || 'Invalid amount')}
              </p>
            )}
          </div>
          <div className='space-y-2'>
            <Label htmlFor={`${id}-network`}>{t('Receiving network')}</Label>
            <Controller
              control={form.control}
              name='network'
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={busy || !available}
                  items={networks.map((network) => ({
                    value: network.id,
                    label: network.name,
                  }))}
                >
                  <SelectTrigger
                    id={`${id}-network`}
                    className='w-full'
                    aria-invalid={Boolean(form.formState.errors.network)}
                  >
                    <SelectValue
                      placeholder={t('Select a withdrawal network')}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {networks.map((network) => (
                      <SelectItem key={network.id} value={network.id}>
                        {network.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {form.formState.errors.network && (
              <p role='alert' className='text-destructive text-xs'>
                {t('Select a withdrawal network')}
              </p>
            )}
          </div>
          <div className='space-y-2'>
            <Label htmlFor={`${id}-address`}>{t('Receiving address')}</Label>
            <Input
              id={`${id}-address`}
              autoComplete='off'
              {...form.register('address')}
              disabled={busy || !available}
              aria-invalid={Boolean(form.formState.errors.address)}
            />
            {form.formState.errors.address && (
              <p role='alert' className='text-destructive text-xs'>
                {t(
                  form.formState.errors.address.message ||
                    'Enter the receiving address'
                )}
              </p>
            )}
          </div>
          {error && !confirmation && (
            <p role='alert' className='text-destructive text-sm'>
              {error}
            </p>
          )}
          <Button
            type='submit'
            className='w-full'
            disabled={busy || !available}
          >
            {preview.isPending ? t('Loading...') : t('Review withdrawal')}
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
          title={t('Confirm U withdrawal')}
          desc={t(
            'The requested amount will be frozen. The fee is deducted from that amount. Check the receiving network and address carefully.'
          )}
          confirmText={t('Submit withdrawal')}
          isLoading={submit.isPending}
          handleConfirm={() => {
            if (!confirmation || submit.isPending) return
            submit.mutate({
              amount: confirmation.preview.amount,
              network: confirmation.preview.network,
              address: confirmation.preview.address,
              config_version: confirmation.preview.config_version,
              request_id: confirmation.requestID,
            })
          }}
        >
          {confirmation && (
            <dl className='space-y-3 text-sm'>
              <div className='flex justify-between gap-4'>
                <dt>{t('Amount to freeze')}</dt>
                <dd className='font-semibold'>
                  {formatUAmount(confirmation.preview.amount)}
                </dd>
              </div>
              <div className='flex justify-between gap-4'>
                <dt>{t('Withdrawal fee')}</dt>
                <dd>{formatUAmount(confirmation.preview.fee)}</dd>
              </div>
              <div className='flex justify-between gap-4'>
                <dt>{t('Amount received')}</dt>
                <dd className='font-semibold'>
                  {formatUAmount(confirmation.preview.net_amount)}
                </dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>
                  {t('Receiving network')}
                </dt>
                <dd>
                  {networks.find(
                    (network) => network.id === confirmation.preview.network
                  )?.name ?? confirmation.preview.network}
                </dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>
                  {t('Receiving address')}
                </dt>
                <dd className='font-mono break-all'>
                  {confirmation.preview.address}
                </dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>
                  {t('Cancellation fee policy')}
                </dt>
                <dd>
                  {confirmation.preview.cancel_fee_policy === 'retain'
                    ? t(
                        'Cancellation returns the requested amount minus the locked fee.'
                      )
                    : t('Cancellation returns the full frozen amount.')}
                </dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>
                  {t('Failed payment fee policy')}
                </dt>
                <dd>
                  {confirmation.preview.failed_fee_policy === 'retain'
                    ? t(
                        'A confirmed failed payment returns the requested amount minus the locked fee.'
                      )
                    : t(
                        'A confirmed failed payment returns the full frozen amount.'
                      )}
                </dd>
              </div>
              {error && (
                <div role='alert' className='text-destructive'>
                  {error}
                </div>
              )}
            </dl>
          )}
        </ConfirmDialog>
      </CardContent>
    </Card>
  )
}
