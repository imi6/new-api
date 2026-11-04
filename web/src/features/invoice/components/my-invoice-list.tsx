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
import { FileText } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { submitPaymentForm } from '@/features/wallet/lib'
import { formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import { cancelInvoice, downloadInvoiceFile, payInvoice } from '../api'
import { useMyInvoices } from '../hooks/use-invoice'
import {
  BALANCE_PAY_KEY,
  INVOICE_STATUS_FILTERS,
  INVOICE_STATUS_META,
} from '../lib/invoice'
import type { Invoice, InvoiceStatus } from '../types'
import { InvoiceDetailDialog } from './invoice-detail-dialog'

const PAGE_SIZE = 10
const ALL = 'all'

interface MyInvoiceListProps {
  onChanged: () => void
}

export function MyInvoiceList(props: MyInvoiceListProps) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<InvoiceStatus | typeof ALL>(ALL)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [cancelTarget, setCancelTarget] = useState<Invoice | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const query = useMyInvoices({
    page,
    pageSize: PAGE_SIZE,
    status: status === ALL ? undefined : status,
  })
  const invoices = query.data?.items ?? []
  const total = query.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const statusItems = [
    { value: ALL, label: t('All statuses') },
    ...INVOICE_STATUS_FILTERS.map((value) => ({
      value,
      label: t(INVOICE_STATUS_META[value].labelKey),
    })),
  ]

  async function handlePay(invoice: Invoice, withBalance: boolean) {
    setBusyId(invoice.id)
    try {
      // Empty method and gateway reuse the Epay method chosen at submission.
      const res = await payInvoice(invoice.id, {
        payment_method: withBalance ? BALANCE_PAY_KEY : '',
        gateway: '',
      })
      if (!res.success) {
        handleServerError(createServerError(res, t('Failed to start payment')))
        return
      }
      if (withBalance) {
        toast.success(t('The tax was paid with your balance'))
        props.onChanged()
        return
      }
      if (!res.data?.url) {
        handleServerError(createServerError(res, t('Failed to start payment')))
        return
      }
      submitPaymentForm(res.data.url, res.data.params ?? {})
    } catch (error) {
      handleServerError(error, t('Failed to start payment'))
    } finally {
      setBusyId(null)
    }
  }

  async function handleCancel() {
    const target = cancelTarget
    if (!target) return
    setBusyId(target.id)
    try {
      const res = await cancelInvoice(target.id)
      if (!res.success) {
        handleServerError(
          createServerError(res, t('Failed to cancel the application'))
        )
        return
      }
      toast.success(t('Application cancelled'))
      setCancelTarget(null)
      props.onChanged()
    } catch (error) {
      handleServerError(error, t('Failed to cancel the application'))
    } finally {
      setBusyId(null)
    }
  }

  async function handleDownload(invoice: Invoice) {
    setBusyId(invoice.id)
    try {
      await downloadInvoiceFile(
        invoice.id,
        invoice.file_name || `invoice-${invoice.id}`
      )
    } catch (error) {
      handleServerError(error, t('Failed to download the invoice'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('My applications')}</CardTitle>
        <CardAction>
          <Select
            items={statusItems}
            value={status}
            onValueChange={(value) => {
              if (value === null) return
              setStatus(value as InvoiceStatus | typeof ALL)
              setPage(1)
            }}
          >
            <SelectTrigger
              className='h-8 w-36'
              aria-label={t('Filter by status')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {statusItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>
        {query.isLoading && (
          <div className='flex flex-col gap-2'>
            <Skeleton className='h-20 rounded-lg' />
            <Skeleton className='h-20 rounded-lg' />
          </div>
        )}
        {!query.isLoading && invoices.length === 0 && (
          <EmptyState
            icon={FileText}
            title={t('No applications yet')}
            description={t('Applications you submit appear here.')}
            className='min-h-[160px]'
          />
        )}
        {!query.isLoading && invoices.length > 0 && (
          <ul className='flex flex-col gap-2'>
            {invoices.map((invoice) => {
              const meta = INVOICE_STATUS_META[invoice.status]
              const busy = busyId === invoice.id
              return (
                <li
                  key={invoice.id}
                  className='flex flex-col gap-2 rounded-lg border px-3 py-2.5'
                >
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='text-sm font-medium'>#{invoice.id}</span>
                    <StatusBadge
                      label={t(meta.labelKey)}
                      variant={meta.variant}
                      copyable={false}
                      size='sm'
                    />
                    <span className='min-w-0 flex-1 truncate text-sm'>
                      {invoice.title}
                    </span>
                    <span className='shrink-0 font-semibold tabular-nums'>
                      ¥{invoice.invoice_amount}
                    </span>
                  </div>
                  <div className='text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs'>
                    <span>{formatTimestampToDate(invoice.create_time)}</span>
                    <span>
                      {t('Tax: ¥{{amount}}', { amount: invoice.tax_amount })}
                    </span>
                  </div>
                  {invoice.status === 'rejected' && invoice.reject_reason && (
                    <p className='text-destructive text-xs'>
                      {t('Rejection reason: {{reason}}', {
                        reason: invoice.reject_reason,
                      })}
                    </p>
                  )}
                  <div className='flex flex-wrap justify-end gap-2'>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => setDetailId(invoice.id)}
                    >
                      {t('Details')}
                    </Button>
                    {invoice.status === 'pending_payment' && (
                      <>
                        <Button
                          variant='outline'
                          size='sm'
                          disabled={busy}
                          onClick={() => setCancelTarget(invoice)}
                        >
                          {t('Cancel application')}
                        </Button>
                        <Button
                          variant='outline'
                          size='sm'
                          disabled={busy}
                          onClick={() => handlePay(invoice, true)}
                        >
                          {t('Pay with balance')}
                        </Button>
                        <Button
                          size='sm'
                          disabled={busy}
                          onClick={() => handlePay(invoice, false)}
                        >
                          {t('Pay tax')}
                        </Button>
                      </>
                    )}
                    {invoice.status === 'issued' && (
                      <Button
                        size='sm'
                        disabled={busy}
                        onClick={() => handleDownload(invoice)}
                      >
                        {t('Download invoice')}
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {total > PAGE_SIZE && (
          <div className='flex items-center justify-end gap-2 text-sm'>
            <Button
              variant='outline'
              size='sm'
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              {t('Previous')}
            </Button>
            <span className='tabular-nums'>
              {page} / {totalPages}
            </span>
            <Button
              variant='outline'
              size='sm'
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              {t('Next')}
            </Button>
          </div>
        )}
      </CardContent>

      <InvoiceDetailDialog
        invoiceId={detailId}
        onOpenChange={(open) => {
          if (!open) setDetailId(null)
        }}
      />
      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null)
        }}
        title={t('Cancel application')}
        desc={t(
          'The selected orders become invoiceable again. Tax that has not been paid is not charged.'
        )}
        handleConfirm={handleCancel}
        isLoading={cancelTarget !== null && busyId === cancelTarget.id}
        destructive
        confirmText={t('Cancel application')}
      />
    </Card>
  )
}
