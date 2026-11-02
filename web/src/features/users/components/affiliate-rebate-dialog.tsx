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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'
import { formatQuota, parseQuotaFromDollars, quotaUnitsToDollars } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'

import { adjustUserAffiliateRebate } from '../api'

interface AffiliateRebateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: number
  /** affiliate_rebate_unused = accrued - claimed, what the user can still claim */
  currentClaimable: number
  onSuccess: () => void
}

export function AffiliateRebateDialog(props: AffiliateRebateDialogProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'grant' | 'revoke'>('grant')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)

  const { meta: currencyMeta } = getCurrencyDisplay()
  const currencyLabel = getCurrencyLabel()
  const tokensOnly = currencyMeta.kind === 'tokens'

  const amountValue = Number.parseFloat(amount) || 0
  const quotaValue = parseQuotaFromDollars(Math.abs(amountValue))

  const getPreviewText = () => {
    const current = props.currentClaimable
    const val = quotaValue
    if (mode === 'grant') {
      return t('Claimable balance: {{current}} → {{after}} (rebate transferred to wallet)', {
        current: formatQuota(current),
        after: formatQuota(Math.max(0, current - val)),
      })
    }
    return t('Claimable balance: {{current}} → {{after}} (marked as claimed, wallet unchanged)', {
      current: formatQuota(current),
      after: formatQuota(Math.max(0, current - val)),
    })
  }

  const handleConfirm = async () => {
    if (!amount) return
    if (quotaValue <= 0) return

    setLoading(true)
    try {
      const result = await adjustUserAffiliateRebate({
        id: props.userId,
        action: mode === 'grant' ? 'grant_affiliate_rebate' : 'revoke_affiliate_rebate',
        value: quotaValue,
      })
      if (!result.success) {
        toast.error(result.message || t('Operation failed'))
        return
      }
      toast.success(
        mode === 'grant'
          ? t('Rebate granted to wallet')
          : t('Rebate revoked')
      )
      setAmount('')
      props.onSuccess()
      props.onOpenChange(false)
    } catch (error) {
      handleServerError(error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Adjust invite rebate')}
      description={t('Grant rebate to wallet or revoke unclaimed balance.')}
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={loading}
          >
            {t('Cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={loading || quotaValue <= 0}>
            {loading ? t('Saving...') : t('Confirm')}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-4'>
        {/* Mode selector */}
        <div className='flex gap-2'>
          <Button
            type='button'
            variant={mode === 'grant' ? 'default' : 'outline'}
            size='sm'
            onClick={() => setMode('grant')}
          >
            {t('Grant to wallet')}
          </Button>
          <Button
            type='button'
            variant={mode === 'revoke' ? 'destructive' : 'outline'}
            size='sm'
            onClick={() => setMode('revoke')}
          >
            {t('Revoke')}
          </Button>
        </div>

        {/* Current balance */}
        <p className='text-muted-foreground text-sm'>
          {t('Current claimable')}: {formatQuota(props.currentClaimable)}
        </p>

        {/* Amount input */}
        <div className='flex flex-col gap-1.5'>
          <div className='flex items-center justify-between'>
            <Label htmlFor='affiliate-rebate-amount'>
              {tokensOnly
                ? t('Amount (tokens)')
                : t('Amount ({{currency}})', { currency: currencyLabel })}
            </Label>
            {mode === 'revoke' && props.currentClaimable > 0 && (
              <button
                type='button'
                className='text-muted-foreground hover:text-foreground text-xs underline underline-offset-2'
                onClick={() =>
                  setAmount(
                    tokensOnly
                      ? String(props.currentClaimable)
                      : quotaUnitsToDollars(props.currentClaimable).toFixed(6)
                  )
                }
              >
                {t('Revoke all')}
              </button>
            )}
          </div>
          <Input
            id='affiliate-rebate-amount'
            type='number'
            min={0}
            step={tokensOnly ? '1' : '0.000001'}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder='0'
          />
        </div>

        {/* Preview */}
        {amount && quotaValue > 0 && (
          <p
            className={cn(
              'text-sm',
              mode === 'revoke' ? 'text-destructive' : 'text-muted-foreground'
            )}
          >
            {getPreviewText()}
          </p>
        )}
      </div>
    </Dialog>
  )
}
