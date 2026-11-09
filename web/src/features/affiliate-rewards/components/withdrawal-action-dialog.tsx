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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { isStaleAffiliateWithdrawal } from '@/features/affiliate-cash/api'
import { formatUAmount } from '@/features/affiliate-cash/lib/amount'
import type { AffiliateWithdrawal } from '@/features/affiliate-cash/types'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { updateAffiliateWithdrawal } from '../cash-api'
import type { AffiliateWithdrawalActionName } from '../cash-types'

type ActionValues = {
  reason: string
  transaction_id: string
  actual_amount: string
  network: string
  address: string
  unpaid_confirmed: boolean
}

export function WithdrawalActionDialog(props: {
  withdrawal: AffiliateWithdrawal
  action: AffiliateWithdrawalActionName
  label: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [requestId] = useState(() => crypto.randomUUID())
  // 确认操作只能作用于打开弹窗时核实的订单版本。
  const [withdrawal] = useState(props.withdrawal)
  const [stale, setStale] = useState(false)
  const [error, setError] = useState('')
  const needsFailureConfirmation =
    props.action === 'fail_release' || props.action === 'fail_retry'
  const needsReason =
    props.action === 'reject' ||
    props.action === 'correct' ||
    needsFailureConfirmation
  const schema = z
    .object({
      reason: z.string().trim().max(2000),
      transaction_id: z.string().trim().max(200),
      actual_amount: z.string().trim(),
      network: z.string().trim(),
      address: z.string().trim(),
      unpaid_confirmed: z.boolean(),
    })
    .superRefine((value, context) => {
      if (needsReason && !value.reason) {
        context.addIssue({
          code: 'custom',
          path: ['reason'],
          message: t('Please provide a reason'),
        })
      }
      if (needsFailureConfirmation && !value.unpaid_confirmed) {
        context.addIssue({
          code: 'custom',
          path: ['unpaid_confirmed'],
          message: t(
            'Confirm that no funds were paid before releasing or retrying'
          ),
        })
      }
      if (props.action === 'complete') {
        for (const key of [
          'transaction_id',
          'actual_amount',
          'network',
          'address',
        ] as const) {
          if (!value[key]) {
            context.addIssue({
              code: 'custom',
              path: [key],
              message: t('This field is required'),
            })
          }
        }
        if (
          value.transaction_id &&
          !/^(0x)?[0-9a-fA-F]{64}$/.test(value.transaction_id)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['transaction_id'],
            message: t(
              'Enter a 64-character hexadecimal transaction hash, optionally prefixed with 0x'
            ),
          })
        }
      }
    })
  const form = useForm<ActionValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      reason: '',
      transaction_id: '',
      actual_amount: withdrawal.net_amount,
      network: withdrawal.network,
      address: withdrawal.address,
      unpaid_confirmed: false,
    },
  })
  const mutation = useMutation({
    mutationFn: (values: ActionValues) =>
      updateAffiliateWithdrawal(withdrawal.id, {
        action: props.action,
        request_id: requestId,
        expected_version: withdrawal.version,
        reason: values.reason,
        ...(needsFailureConfirmation
          ? { unpaid_confirmed: values.unpaid_confirmed }
          : {}),
        ...(props.action === 'complete'
          ? {
              transaction_id: values.transaction_id,
              actual_amount: values.actual_amount,
              network: values.network,
              address: values.address,
            }
          : {}),
      }),
    meta: { errorToast: false },
    onError: async (cause) => {
      setError(getServerErrorMessage(cause))
      if (isStaleAffiliateWithdrawal(cause)) {
        setStale(true)
        await Promise.allSettled([
          queryClient.invalidateQueries({ queryKey: ['affiliate-rewards'] }),
        ])
      }
    },
    onSuccess: async () => {
      toast.success(t('Operation successful'))
      props.onClose()
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ['affiliate-rewards'] }),
        queryClient.invalidateQueries({ queryKey: ['affiliate-cash'] }),
      ])
    },
  })
  let description = t('This action applies only to the selected withdrawal.')
  if (props.action === 'start') {
    description = t(
      'Move this order to paying before making the transfer. An uncertain result must stay frozen; never send a second payment until the first is verified unpaid.'
    )
  }
  if (needsFailureConfirmation) {
    description = t(
      'Only continue after verifying that no funds reached the recipient. A timeout or missing transaction is not proof of failure.'
    )
  }
  if (props.action === 'complete') {
    description = t(
      'Verify the actual payment against the locked network, address and net amount. Completing this order consumes its reserved balance.'
    )
  }
  if (props.action === 'correct') {
    description = t(
      'This appends a correction to the completed order. It does not refund, unlock funds or arrange another payment.'
    )
  }
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) props.onClose()
      }}
      title={props.label}
      desc={description}
      confirmText={props.label}
      isLoading={mutation.isPending}
      disabled={stale}
      destructive={props.action === 'reject' || props.action === 'fail_release'}
      handleConfirm={() =>
        !stale &&
        !mutation.isPending &&
        void form.handleSubmit((values) => mutation.mutate(values))()
      }
      className='sm:max-w-xl'
    >
      <div className='rounded-lg border p-3 text-sm'>
        <p>
          {t('Requested amount')}: {formatUAmount(withdrawal.amount)}
        </p>
        <p>
          {t('Net payout amount')}: {formatUAmount(withdrawal.net_amount)}
        </p>
        <p className='break-all'>
          {withdrawal.network} · {withdrawal.address}
        </p>
      </div>
      <Form {...form}>
        <form
          className='space-y-3'
          onSubmit={form.handleSubmit((values) => {
            if (!stale && !mutation.isPending) mutation.mutate(values)
          })}
        >
          {props.action === 'complete' &&
            [
              {
                name: 'transaction_id' as const,
                label: t('Transaction hash'),
              },
              {
                name: 'actual_amount' as const,
                label: t('Actual payout amount (USDT)'),
              },
              { name: 'network' as const, label: t('Actual payout network') },
              {
                name: 'address' as const,
                label: t('Actual recipient address'),
              },
            ].map((item) => (
              <FormField
                key={item.name}
                control={form.control}
                name={item.name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{item.label}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        disabled={mutation.isPending}
                        autoComplete='off'
                        maxLength={
                          item.name === 'transaction_id' ? 66 : undefined
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
          {needsReason && (
            <FormField
              control={form.control}
              name='reason'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {props.action === 'correct'
                      ? t('Correction details')
                      : t('Reason')}
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      maxLength={2000}
                      disabled={mutation.isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          {needsFailureConfirmation && (
            <FormField
              control={form.control}
              name='unpaid_confirmed'
              render={({ field }) => (
                <FormItem>
                  <div className='flex items-start gap-2'>
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(value) =>
                          field.onChange(value === true)
                        }
                        disabled={mutation.isPending}
                      />
                    </FormControl>
                    <FormLabel>
                      {t(
                        'I have verified that this payment did not reach the recipient.'
                      )}
                    </FormLabel>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </form>
      </Form>
      {error && (
        <p role='alert' className='text-destructive text-sm'>
          {error}
        </p>
      )}
    </ConfirmDialog>
  )
}
