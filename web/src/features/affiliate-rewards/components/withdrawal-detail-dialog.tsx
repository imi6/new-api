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
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { formatUAmount } from '@/features/affiliate-cash/lib/amount'
import { formatTimestampToDate } from '@/lib/format'

import { getAffiliateWithdrawal } from '../cash-api'
import {
  withdrawalActions,
  type AffiliateWithdrawalActionName,
} from '../cash-types'
import { WithdrawalActionDialog } from './withdrawal-action-dialog'
import { WithdrawalStatus } from './withdrawal-status'

export function WithdrawalDetailDialog(props: {
  id: number
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [action, setAction] = useState<AffiliateWithdrawalActionName | null>(
    null
  )
  const query = useQuery({
    queryKey: ['affiliate-rewards', 'withdrawal', props.id],
    queryFn: () => getAffiliateWithdrawal(props.id),
  })
  const labels: Record<AffiliateWithdrawalActionName, string> = {
    approve: t('Approve withdrawal'),
    reject: t('Reject and return funds'),
    start: t('Begin payment'),
    complete: t('Record successful payment'),
    fail_release: t('Confirmed unpaid: end and release'),
    fail_retry: t('Confirmed unpaid: arrange retry'),
    correct: t('Append correction'),
  }
  const order = query.data?.withdrawal
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !action) props.onClose()
        }}
        title={t('Withdrawal details')}
        contentClassName='sm:max-w-3xl'
      >
        {query.isLoading && <LoadingState />}
        {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
        {order && (
          <div className='space-y-5'>
            <WithdrawalStatus status={order.status} />
            <dl className='grid gap-3 rounded-lg border p-4 sm:grid-cols-3'>
              <div>
                <dt className='text-muted-foreground text-xs'>
                  {t('Requested amount')}
                </dt>
                <dd className='font-semibold'>{formatUAmount(order.amount)}</dd>
              </div>
              <div>
                <dt className='text-muted-foreground text-xs'>
                  {t('Quoted fee')}
                </dt>
                <dd>{formatUAmount(order.fee)}</dd>
              </div>
              <div>
                <dt className='text-muted-foreground text-xs'>
                  {t('Expected payout')}
                </dt>
                <dd className='font-semibold'>
                  {formatUAmount(order.net_amount)}
                </dd>
              </div>
              <div>
                <dt className='text-muted-foreground text-xs'>
                  {t('Fee charged')}
                </dt>
                <dd>{formatUAmount(order.actual_fee)}</dd>
              </div>
              <div>
                <dt className='text-muted-foreground text-xs'>
                  {t('Actual payout')}
                </dt>
                <dd>{formatUAmount(order.actual_amount)}</dd>
              </div>
              <div>
                <dt className='text-muted-foreground text-xs'>
                  {t('Amount returned')}
                </dt>
                <dd>{formatUAmount(order.refunded_amount)}</dd>
              </div>
              <div>
                <dt className='text-muted-foreground text-xs'>
                  {t('User ID')}
                </dt>
                <dd>{order.user_id}</dd>
              </div>
              <div>
                <dt className='text-muted-foreground text-xs'>
                  {t('Network')}
                </dt>
                <dd>{order.network}</dd>
              </div>
              <div>
                <dt className='text-muted-foreground text-xs'>{t('Time')}</dt>
                <dd>{formatTimestampToDate(order.created_at)}</dd>
              </div>
              <div className='sm:col-span-3'>
                <dt className='text-muted-foreground text-xs'>
                  {t('Recipient address')}
                </dt>
                <dd className='flex items-center gap-2'>
                  <span className='break-all'>{order.address}</span>
                  <CopyButton value={order.address} />
                </dd>
              </div>
            </dl>
            {order.reason && (
              <p className='text-sm break-words'>
                {t('Reason')}: {order.reason}
              </p>
            )}
            {order.status === 'paying' && (
              <Alert>
                <AlertDescription>
                  {t(
                    'Payment is in progress. Keep funds frozen while the outcome is uncertain; cancellation and rejection are unavailable.'
                  )}
                </AlertDescription>
              </Alert>
            )}
            <div className='flex flex-wrap gap-2'>
              {withdrawalActions(order.status).map((item) => (
                <Button
                  key={item}
                  variant={
                    item === 'reject' || item === 'fail_release'
                      ? 'destructive'
                      : 'outline'
                  }
                  disabled={query.isFetching}
                  onClick={() => setAction(item)}
                >
                  {labels[item]}
                </Button>
              ))}
            </div>
            <section className='space-y-2'>
              <h3 className='text-sm font-semibold'>{t('Payment attempts')}</h3>
              {query.data?.attempts.length === 0 && (
                <p className='text-muted-foreground text-sm'>
                  {t('No payment attempts yet')}
                </p>
              )}
              {query.data?.attempts.map((attempt) => (
                <div
                  key={attempt.id}
                  className='space-y-1 rounded-lg border p-3 text-sm'
                >
                  <p>
                    {formatTimestampToDate(attempt.created_at)} ·{' '}
                    {t('Operator ID')}: {attempt.operator_id}
                  </p>
                  <WithdrawalStatus status={attempt.status} />
                  {attempt.transaction_id && (
                    <p className='break-all'>
                      {t('Transaction hash')}: {attempt.transaction_id}
                    </p>
                  )}
                  {attempt.actual_amount && (
                    <p>
                      {t('Actual payout')}:{' '}
                      {formatUAmount(attempt.actual_amount)}
                    </p>
                  )}
                  {attempt.reason && (
                    <p className='break-words'>{attempt.reason}</p>
                  )}
                </div>
              ))}
            </section>
            <section className='space-y-2'>
              <h3 className='text-sm font-semibold'>{t('Corrections')}</h3>
              {query.data?.corrections.length === 0 && (
                <p className='text-muted-foreground text-sm'>
                  {t('No corrections')}
                </p>
              )}
              {query.data?.corrections.map((correction) => (
                <div
                  key={correction.id}
                  className='rounded-lg border p-3 text-sm'
                >
                  <p>
                    {formatTimestampToDate(correction.created_at)} ·{' '}
                    {t('Operator ID')}: {correction.operator_id}
                  </p>
                  <p className='mt-1 break-words whitespace-pre-wrap'>
                    {correction.reason}
                  </p>
                </div>
              ))}
            </section>
          </div>
        )}
      </Dialog>
      {order && action && (
        <WithdrawalActionDialog
          key={`${order.id}-${action}`}
          withdrawal={order}
          action={action}
          label={labels[action]}
          onClose={() => setAction(null)}
        />
      )}
    </>
  )
}
