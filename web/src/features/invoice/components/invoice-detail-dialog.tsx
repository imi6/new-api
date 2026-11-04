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
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { StatusBadge } from '@/components/status-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { formatTimestampToDate } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'

import { getMyInvoice } from '../api'
import { INVOICE_QUERY_KEY } from '../hooks/use-invoice'
import { INVOICE_STATUS_META, ORDER_TYPE_LABEL_KEYS } from '../lib/invoice'

interface InvoiceDetailDialogProps {
  invoiceId: number | null
  onOpenChange: (open: boolean) => void
}

export function InvoiceDetailDialog(props: InvoiceDetailDialogProps) {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: [...INVOICE_QUERY_KEY, 'detail', props.invoiceId],
    queryFn: async () =>
      requireServerSuccess(await getMyInvoice(props.invoiceId ?? 0)).data,
    enabled: props.invoiceId !== null,
  })
  const invoice = query.data?.invoice
  const items = query.data?.items ?? []

  const rows: { label: string; value: string }[] = invoice
    ? [
        {
          label: t('Invoice type'),
          value:
            invoice.invoice_type === 'special'
              ? t('Special VAT invoice')
              : t('General VAT invoice'),
        },
        {
          label: t('Title type'),
          value:
            invoice.title_type === 'company' ? t('Company') : t('Individual'),
        },
        { label: t('Invoice title'), value: invoice.title },
        { label: t('Taxpayer identification number'), value: invoice.tax_no },
        { label: t('Registered address'), value: invoice.reg_address },
        { label: t('Registered phone'), value: invoice.reg_phone },
        { label: t('Bank name'), value: invoice.bank_name },
        { label: t('Bank account'), value: invoice.bank_account },
        { label: t('Product category'), value: invoice.category },
        { label: t('Email for the invoice'), value: invoice.email },
        { label: t('Order amount'), value: `¥${invoice.order_amount}` },
        {
          label: t('Tax ({{rate}}%)', { rate: invoice.tax_rate }),
          value: `¥${invoice.tax_amount}`,
        },
        { label: t('Invoice amount'), value: `¥${invoice.invoice_amount}` },
        {
          label: t('Submitted at'),
          value: formatTimestampToDate(invoice.create_time),
        },
        {
          label: t('Tax paid at'),
          value: formatTimestampToDate(invoice.tax_paid_time),
        },
        {
          label: t('Issued at'),
          value: formatTimestampToDate(invoice.issued_time),
        },
      ].filter((row) => row.value !== '' && row.value !== '-')
    : []

  return (
    <Dialog
      open={props.invoiceId !== null}
      onOpenChange={props.onOpenChange}
      title={t('Application #{{id}}', { id: props.invoiceId ?? '' })}
      contentClassName='sm:max-w-lg'
    >
      {query.isLoading && (
        <div className='flex flex-col gap-2'>
          <Skeleton className='h-5 w-1/2' />
          <Skeleton className='h-40' />
        </div>
      )}
      {invoice && (
        <div className='flex flex-col gap-4'>
          <div className='flex flex-wrap items-center gap-2'>
            <StatusBadge
              label={t(INVOICE_STATUS_META[invoice.status].labelKey)}
              variant={INVOICE_STATUS_META[invoice.status].variant}
            />
          </div>
          {invoice.status === 'rejected' && invoice.reject_reason && (
            <p className='bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm'>
              {t('Rejection reason: {{reason}}', {
                reason: invoice.reject_reason,
              })}
            </p>
          )}
          <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm'>
            {rows.map((row) => (
              <div key={row.label} className='contents'>
                <dt className='text-muted-foreground'>{row.label}</dt>
                <dd className='min-w-0 break-all'>{row.value}</dd>
              </div>
            ))}
          </dl>
          <div className='flex flex-col gap-2'>
            <span className='text-sm font-medium'>
              {t('Orders in this application')}
            </span>
            <ul className='flex max-h-60 flex-col gap-1.5 overflow-y-auto'>
              {items.map((item) => (
                <li
                  key={item.id}
                  className='flex items-center gap-2 rounded-md border px-3 py-2 text-xs'
                >
                  <StatusBadge
                    label={t(ORDER_TYPE_LABEL_KEYS[item.order_type])}
                    variant='neutral'
                    size='sm'
                  />
                  <span className='min-w-0 flex-1 truncate font-mono'>
                    {item.trade_no}
                  </span>
                  <span className='shrink-0 tabular-nums'>¥{item.amount}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Dialog>
  )
}
