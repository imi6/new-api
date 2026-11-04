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
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import type { Invoice } from '@/features/invoice/types'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import { rejectAdminInvoice } from '../api'

// Matches the limit in model.RejectInvoice.
const REJECT_REASON_MAX = 500

interface InvoiceRejectDialogProps {
  invoice: Invoice | null
  onOpenChange: (open: boolean) => void
  onRejected: () => void
}

export function InvoiceRejectDialog(props: InvoiceRejectDialogProps) {
  const { t } = useTranslation()
  const id = useId()
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const taxPaid = Number(props.invoice?.tax_amount ?? 0) > 0

  async function handleConfirm() {
    const invoice = props.invoice
    if (!invoice) return
    if (reason.trim() === '') {
      toast.error(t('Enter the rejection reason'))
      return
    }
    setSubmitting(true)
    try {
      const res = await rejectAdminInvoice(invoice.id, reason)
      if (!res.success) {
        handleServerError(
          createServerError(res, t('Failed to reject the application'))
        )
        return
      }
      toast.success(t('Application rejected'))
      setReason('')
      props.onRejected()
    } catch (error) {
      handleServerError(error, t('Failed to reject the application'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ConfirmDialog
      open={props.invoice !== null}
      onOpenChange={(open) => {
        if (!open) setReason('')
        props.onOpenChange(open)
      }}
      title={t('Reject application')}
      desc={
        taxPaid
          ? t(
              'The tax of ¥{{amount}} is returned to the user balance and the orders become invoiceable again.',
              { amount: props.invoice?.tax_amount ?? '' }
            )
          : t('The orders become invoiceable again.')
      }
      handleConfirm={handleConfirm}
      isLoading={submitting}
      disabled={reason.trim() === ''}
      destructive
      confirmText={t('Reject')}
    >
      <Field>
        <FieldLabel htmlFor={`${id}-reason`}>
          {t('Rejection reason')}
        </FieldLabel>
        <Textarea
          id={`${id}-reason`}
          value={reason}
          maxLength={REJECT_REASON_MAX}
          rows={4}
          onChange={(event) => setReason(event.target.value)}
        />
        <FieldDescription>
          {t('The user sees this reason in the invoice center and the email.')}
        </FieldDescription>
      </Field>
    </ConfirmDialog>
  )
}
