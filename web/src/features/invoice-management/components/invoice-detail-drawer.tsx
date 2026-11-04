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
import { Download, Upload } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  SideDrawerSection,
  SideDrawerSectionHeader,
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { downloadInvoiceFile } from '@/features/invoice/api'
import {
  BALANCE_PAY_KEY,
  INVOICE_STATUS_META,
  ORDER_TYPE_LABEL_KEYS,
} from '@/features/invoice/lib/invoice'
import type { Invoice } from '@/features/invoice/types'
import { formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import { issueAdminInvoice, uploadAdminInvoiceFile } from '../api'
import { useAdminInvoice } from '../hooks/use-admin-invoices'
import { InvoiceRejectDialog } from './invoice-reject-dialog'

// Matches the server whitelist in service.SaveInvoiceFile.
const INVOICE_FILE_ACCEPT =
  '.pdf,.png,.jpg,application/pdf,image/png,image/jpeg'

interface InvoiceDetailDrawerProps {
  invoiceId: number | null
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}

interface DetailRow {
  label: string
  value: string
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

export function InvoiceDetailDrawer(props: InvoiceDetailDrawerProps) {
  const { t } = useTranslation()
  const id = useId()
  const query = useAdminInvoice(props.invoiceId)
  const [busy, setBusy] = useState(false)
  const [issueOpen, setIssueOpen] = useState(false)
  const [rejectTarget, setRejectTarget] = useState<Invoice | null>(null)

  const invoice = query.data?.invoice
  const items = query.data?.items ?? []
  const reviewing = invoice?.status === 'pending_review'
  const hasFile = Boolean(invoice?.file_name)

  async function handleUpload(file: File | undefined) {
    if (!file || !invoice) return
    setBusy(true)
    try {
      const res = await uploadAdminInvoiceFile(invoice.id, file)
      if (!res.success) {
        handleServerError(
          createServerError(res, t('Failed to upload the invoice file'))
        )
        return
      }
      toast.success(t('Invoice file uploaded'))
      props.onChanged()
    } catch (error) {
      handleServerError(error, t('Failed to upload the invoice file'))
    } finally {
      setBusy(false)
    }
  }

  async function handleIssue() {
    if (!invoice) return
    setBusy(true)
    try {
      const res = await issueAdminInvoice(invoice.id)
      if (!res.success) {
        handleServerError(
          createServerError(res, t('Failed to issue the invoice'))
        )
        return
      }
      toast.success(t('Invoice issued'))
      setIssueOpen(false)
      props.onChanged()
    } catch (error) {
      handleServerError(error, t('Failed to issue the invoice'))
    } finally {
      setBusy(false)
    }
  }

  async function handleDownload() {
    if (!invoice) return
    setBusy(true)
    try {
      await downloadInvoiceFile(
        invoice.id,
        invoice.file_name || `invoice-${invoice.id}`
      )
    } catch (error) {
      handleServerError(error, t('Failed to download the invoice'))
    } finally {
      setBusy(false)
    }
  }

  const infoRows: DetailRow[] = invoice
    ? [
        {
          label: t('User'),
          value: `${query.data?.username || '-'} (ID ${invoice.user_id})`,
        },
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
        {
          label: t('Submitted at'),
          value: formatTimestampToDate(invoice.create_time),
        },
        {
          label: t('Issued at'),
          value: formatTimestampToDate(invoice.issued_time),
        },
      ].filter((row) => row.value !== '' && row.value !== '-')
    : []

  const taxRows: DetailRow[] = invoice
    ? [
        { label: t('Order amount'), value: `¥${invoice.order_amount}` },
        {
          label: t('Tax ({{rate}}%)', { rate: invoice.tax_rate }),
          value: `¥${invoice.tax_amount}`,
        },
        { label: t('Invoice amount'), value: `¥${invoice.invoice_amount}` },
        { label: t('Tax order number'), value: invoice.tax_trade_no ?? '' },
        {
          label: t('Payment method'),
          value:
            invoice.tax_payment_method === BALANCE_PAY_KEY
              ? t('Balance')
              : invoice.tax_payment_method,
        },
        {
          label: t('Tax paid at'),
          value: formatTimestampToDate(invoice.tax_paid_time),
        },
      ].filter((row) => row.value !== '' && row.value !== '-')
    : []

  const renderRows = (rows: DetailRow[]) => (
    <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm'>
      {rows.map((row) => (
        <div key={row.label} className='contents'>
          <dt className='text-muted-foreground'>{row.label}</dt>
          <dd className='min-w-0 break-all'>{row.value}</dd>
        </div>
      ))}
    </dl>
  )

  return (
    <>
      <Sheet open={props.invoiceId !== null} onOpenChange={props.onOpenChange}>
        <SheetContent
          className={sideDrawerContentClassName('sm:max-w-[600px]')}
        >
          <SheetHeader className={sideDrawerHeaderClassName()}>
            <SheetTitle>
              {t('Application #{{id}}', { id: props.invoiceId ?? '' })}
            </SheetTitle>
            <SheetDescription render={<div />}>
              {invoice && (
                <StatusBadge
                  label={t(INVOICE_STATUS_META[invoice.status].labelKey)}
                  variant={INVOICE_STATUS_META[invoice.status].variant}
                  copyable={false}
                />
              )}
            </SheetDescription>
          </SheetHeader>

          <div className={sideDrawerFormClassName()}>
            {query.isLoading && (
              <div className='flex flex-col gap-3'>
                <Skeleton className='h-5 w-1/2' />
                <Skeleton className='h-48' />
                <Skeleton className='h-32' />
              </div>
            )}
            {invoice && (
              <>
                {invoice.status === 'rejected' && invoice.reject_reason && (
                  <p className='bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm'>
                    {t('Rejection reason: {{reason}}', {
                      reason: invoice.reject_reason,
                    })}
                  </p>
                )}

                <SideDrawerSection>
                  <SideDrawerSectionHeader title={t('Invoice details')} />
                  {renderRows(infoRows)}
                </SideDrawerSection>

                <SideDrawerSection>
                  <SideDrawerSectionHeader
                    title={t('Amount and tax payment')}
                  />
                  {renderRows(taxRows)}
                </SideDrawerSection>

                <SideDrawerSection>
                  <SideDrawerSectionHeader
                    title={t('Orders in this application')}
                    description={t('{{count}} orders', { count: items.length })}
                  />
                  <ul className='flex flex-col gap-1.5'>
                    {items.map((item) => (
                      <li
                        key={item.id}
                        className='flex items-center gap-2 rounded-md border px-3 py-2 text-xs'
                      >
                        <StatusBadge
                          label={t(ORDER_TYPE_LABEL_KEYS[item.order_type])}
                          variant='neutral'
                          size='sm'
                          copyable={false}
                        />
                        <span className='min-w-0 flex-1 truncate font-mono'>
                          {item.trade_no}
                        </span>
                        <span className='text-muted-foreground shrink-0'>
                          {formatTimestampToDate(item.order_time)}
                        </span>
                        <span className='shrink-0 tabular-nums'>
                          ¥{item.amount}
                        </span>
                      </li>
                    ))}
                  </ul>
                </SideDrawerSection>

                <SideDrawerSection>
                  <SideDrawerSectionHeader
                    title={t('Invoice file')}
                    description={t(
                      'PDF, PNG or JPG. Files can be uploaded or replaced while the application is under review.'
                    )}
                  />
                  {hasFile && (
                    <div className='flex items-center gap-2 rounded-md border px-3 py-2 text-sm'>
                      <span className='min-w-0 flex-1 truncate'>
                        {invoice.file_name}
                      </span>
                      <span className='text-muted-foreground shrink-0 text-xs'>
                        {formatFileSize(invoice.file_size)}
                      </span>
                      <Button
                        variant='ghost'
                        size='sm'
                        disabled={busy}
                        onClick={handleDownload}
                      >
                        <Download aria-hidden='true' />
                        {t('Download')}
                      </Button>
                    </div>
                  )}
                  {!hasFile && (
                    <p className='text-muted-foreground text-sm'>
                      {t('No file uploaded yet.')}
                    </p>
                  )}
                  {reviewing && (
                    <label
                      htmlFor={`${id}-file`}
                      className='flex flex-col gap-2 text-sm font-medium'
                    >
                      <span className='flex items-center gap-1.5'>
                        <Upload className='size-4' aria-hidden='true' />
                        {hasFile ? t('Replace file') : t('Upload file')}
                      </span>
                      <Input
                        id={`${id}-file`}
                        type='file'
                        accept={INVOICE_FILE_ACCEPT}
                        disabled={busy}
                        onChange={(event) => {
                          void handleUpload(event.target.files?.[0])
                          event.target.value = ''
                        }}
                      />
                    </label>
                  )}
                </SideDrawerSection>
              </>
            )}
          </div>

          <SheetFooter className={sideDrawerFooterClassName()}>
            <SheetClose render={<Button variant='outline' />}>
              {t('Close')}
            </SheetClose>
            {reviewing && (
              <>
                <Button
                  variant='destructive'
                  disabled={busy}
                  onClick={() => setRejectTarget(invoice ?? null)}
                >
                  {t('Reject')}
                </Button>
                <Button
                  disabled={busy || !hasFile}
                  onClick={() => setIssueOpen(true)}
                >
                  {t('Confirm issued')}
                </Button>
              </>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={issueOpen}
        onOpenChange={setIssueOpen}
        title={t('Confirm issued')}
        desc={t(
          'The user is notified by email and can download the uploaded file. This cannot be undone.'
        )}
        handleConfirm={handleIssue}
        isLoading={busy}
        confirmText={t('Confirm issued')}
      />
      <InvoiceRejectDialog
        invoice={rejectTarget}
        onOpenChange={(open) => {
          if (!open) setRejectTarget(null)
        }}
        onRejected={() => {
          setRejectTarget(null)
          props.onChanged()
        }}
      />
    </>
  )
}
