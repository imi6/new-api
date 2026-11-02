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
import { formatQuota, parseQuotaFromDollars } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'

import { adjustUserAffQuota } from '../api'

interface AffQuotaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: number
  currentAffQuota: number
  onSuccess: () => void
}

export function AffQuotaDialog(props: AffQuotaDialogProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'add' | 'subtract'>('add')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)

  const { meta: currencyMeta } = getCurrencyDisplay()
  const currencyLabel = getCurrencyLabel()
  const tokensOnly = currencyMeta.kind === 'tokens'

  const amountValue = Number.parseFloat(amount) || 0
  const quotaValue = parseQuotaFromDollars(Math.abs(amountValue))

  const getPreviewText = () => {
    const current = props.currentAffQuota
    const val = quotaValue
    if (mode === 'add') {
      return `${t('Current quota')}: ${formatQuota(current)}  +${formatQuota(val)} = ${formatQuota(current + val)}`
    }
    return `${t('Current quota')}: ${formatQuota(current)}  -${formatQuota(val)} = ${formatQuota(Math.max(0, current - val))}`
  }

  const handleConfirm = async () => {
    if (!amount) return
    if (quotaValue <= 0) return

    setLoading(true)
    try {
      const result = await adjustUserAffQuota({
        id: props.userId,
        action: 'add_aff_quota',
        mode,
        value: quotaValue,
      })
      if (!result.success) {
        toast.error(result.message || t('Operation failed'))
        return
      }
      toast.success(t('Referral program quota updated'))
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
      title={t('Adjust referral program quota')}
      description={t('Add or subtract from the pending referral reward balance.')}
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
          {(['add', 'subtract'] as const).map((m) => (
            <Button
              key={m}
              type='button'
              variant={mode === m ? 'default' : 'outline'}
              size='sm'
              onClick={() => setMode(m)}
            >
              {m === 'add' ? t('Add') : t('Subtract')}
            </Button>
          ))}
        </div>

        {/* Amount input */}
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='aff-quota-amount'>
            {tokensOnly
              ? t('Amount (tokens)')
              : t('Amount ({{currency}})', { currency: currencyLabel })}
          </Label>
          <Input
            id='aff-quota-amount'
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
              mode === 'subtract' ? 'text-destructive' : 'text-muted-foreground'
            )}
          >
            {getPreviewText()}
          </p>
        )}
      </div>
    </Dialog>
  )
}
