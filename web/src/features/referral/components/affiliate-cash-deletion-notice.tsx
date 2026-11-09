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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { getAffiliateCash } from '@/features/affiliate-cash/api'
import { formatUAmount } from '@/features/affiliate-cash/lib/amount'
import type { AffiliateCashSummary } from '@/features/affiliate-cash/types'

export function AffiliateCashDeletionNotice(props: { open: boolean }) {
  const { t } = useTranslation()
  const [summary, setSummary] = useState<AffiliateCashSummary | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!props.open) return
    const controller = new AbortController()
    setSummary(null)
    setFailed(false)
    getAffiliateCash(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        if (!result?.config || typeof result.pending_withdrawals !== 'number') {
          setFailed(true)
          return
        }
        setSummary(result)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [props.open])

  return (
    <Alert>
      <AlertDescription className='space-y-2'>
        {summary ? (
          <dl className='space-y-1'>
            <div className='flex justify-between gap-4'>
              <dt>{t('Available U')}</dt>
              <dd>{formatUAmount(summary.u_available)}</dd>
            </div>
            <div className='flex justify-between gap-4'>
              <dt>{t('Frozen for withdrawal')}</dt>
              <dd>{formatUAmount(summary.u_frozen)}</dd>
            </div>
            <div className='flex justify-between gap-4'>
              <dt>{t('Unfinished withdrawals')}</dt>
              <dd>{summary.pending_withdrawals}</dd>
            </div>
            <div className='flex justify-between gap-4'>
              <dt>{t('Minimum withdrawal')}</dt>
              <dd>{formatUAmount(summary.config.minimum_withdrawal)}</dd>
            </div>
          </dl>
        ) : (
          <p>
            {failed
              ? t(
                  'Unable to load U balances. The server will check them before deleting your account.'
                )
              : t('Loading U balances...')}
          </p>
        )}
        <p>
          {t(
            'Any available U, frozen U or unfinished withdrawal prevents account deletion. U cannot return to platform balance or be cleared. Balances below the withdrawal minimum must accumulate and may prevent deletion indefinitely. Financial records remain after account deletion.'
          )}
        </p>
      </AlertDescription>
    </Alert>
  )
}
