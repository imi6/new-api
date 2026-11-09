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
import type { ColumnDef } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import { Button } from '@/components/ui/button'
import { INVOICE_STATUS_META } from '@/features/invoice/lib/invoice'
import type { Invoice } from '@/features/invoice/types'
import { formatTimestampToDate } from '@/lib/format'

export function useInvoiceColumns(
  onOpen: (invoice: Invoice) => void,
  onDelete: (invoice: Invoice) => void
): ColumnDef<Invoice>[] {
  const { t } = useTranslation()
  return [
    {
      accessorKey: 'id',
      header: t('ID'),
      meta: { mobileHidden: true },
      cell: ({ row }) => (
        <TableId value={row.original.id} className='w-[60px]' />
      ),
      size: 80,
    },
    {
      accessorKey: 'title',
      header: t('Invoice title'),
      meta: { mobileTitle: true },
      cell: ({ row }) => (
        <div className='flex min-w-0 flex-col'>
          <span className='truncate font-medium'>{row.original.title}</span>
          {row.original.tax_no && (
            <span className='text-muted-foreground truncate font-mono text-xs'>
              {row.original.tax_no}
            </span>
          )}
        </div>
      ),
      size: 240,
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      meta: { mobileBadge: true },
      cell: ({ row }) => {
        const meta = INVOICE_STATUS_META[row.original.status]
        return (
          <StatusBadge
            label={t(meta.labelKey)}
            variant={meta.variant}
            copyable={false}
            className='-ml-1.5'
          />
        )
      },
      size: 130,
    },
    {
      accessorKey: 'user_id',
      header: t('User ID'),
      cell: ({ row }) => (
        <span className='tabular-nums'>{row.original.user_id}</span>
      ),
      size: 90,
    },
    {
      accessorKey: 'invoice_type',
      header: t('Invoice type'),
      cell: ({ row }) =>
        row.original.invoice_type === 'special'
          ? t('Special VAT invoice')
          : t('General VAT invoice'),
      size: 150,
    },
    {
      accessorKey: 'invoice_amount',
      header: t('Invoice amount'),
      cell: ({ row }) => (
        <span className='font-semibold tabular-nums'>
          ¥{row.original.invoice_amount}
        </span>
      ),
      size: 120,
    },
    {
      accessorKey: 'tax_amount',
      header: t('Tax'),
      meta: { mobileHidden: true },
      cell: ({ row }) => (
        <span className='tabular-nums'>¥{row.original.tax_amount}</span>
      ),
      size: 100,
    },
    {
      accessorKey: 'create_time',
      header: t('Submitted at'),
      meta: { mobileHidden: true },
      cell: ({ row }) => (
        <span className='font-mono text-sm'>
          {formatTimestampToDate(row.original.create_time)}
        </span>
      ),
      size: 180,
    },
    {
      id: 'actions',
      header: () => <span className='sr-only'>{t('Actions')}</span>,
      cell: ({ row }) => (
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => onOpen(row.original)}
          >
            {row.original.status === 'pending_review'
              ? t('Process')
              : t('Details')}
          </Button>
          {row.original.status === 'issued' && (
            <Button
              variant='destructive'
              size='sm'
              onClick={() => onDelete(row.original)}
            >
              {t('Delete')}
            </Button>
          )}
        </div>
      ),
      enableHiding: false,
      size: 180,
    },
  ]
}
