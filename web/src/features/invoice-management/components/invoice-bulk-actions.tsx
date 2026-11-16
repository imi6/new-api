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
import type { Table } from '@tanstack/react-table'
import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { DataTableBulkActions } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import type { Invoice } from '@/features/invoice/types'

import { formatInvoiceCopy } from '../lib/invoice-copy'

interface InvoiceBulkActionsProps {
  table: Table<Invoice>
  onDelete: (invoices: Invoice[]) => void
}

export function InvoiceBulkActions(props: InvoiceBulkActionsProps) {
  const { t } = useTranslation()
  const invoices = props.table
    .getFilteredSelectedRowModel()
    .rows.map((row) => row.original)
  const canDelete =
    invoices.length > 0 &&
    invoices.every((invoice) => invoice.status === 'issued')
  const contentToCopy = invoices
    .map((invoice) => formatInvoiceCopy(invoice, t))
    .join('\n\n--------------------\n\n')

  return (
    <DataTableBulkActions
      table={props.table}
      entityName={t('Invoice application')}
    >
      <CopyButton
        value={contentToCopy}
        variant='outline'
        size='sm'
        notify
        aria-label={t('Copy selected invoices')}
      >
        {t('Copy selected invoices')}
      </CopyButton>
      <Button
        variant='destructive'
        size='sm'
        disabled={!canDelete}
        onClick={() => props.onDelete(invoices)}
      >
        <Trash2 aria-hidden='true' />
        {t('Delete selected invoices')}
      </Button>
      {!canDelete && invoices.length > 0 && (
        <span className='text-muted-foreground max-w-48 text-xs'>
          {t('Only issued invoice applications can be deleted')}
        </span>
      )}
    </DataTableBulkActions>
  )
}
