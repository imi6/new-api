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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { INVOICE_QUERY_KEY } from '@/features/invoice/hooks/use-invoice'
import type { Invoice, InvoicePage } from '@/features/invoice/types'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import { deleteAdminInvoice } from '../api'
import { ADMIN_INVOICE_QUERY_KEY } from '../hooks/use-admin-invoices'
import {
  createInvoiceDeleteSchema,
  type InvoiceDeleteForm,
} from '../lib/invoice-delete'

interface InvoiceDeleteDialogProps {
  invoice: Invoice
  onOpenChange: (open: boolean) => void
  onDeleted: (id: number) => void
}

export function InvoiceDeleteDialog(props: InvoiceDeleteDialogProps) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const submitting = useRef(false)
  const form = useForm<InvoiceDeleteForm>({
    resolver: zodResolver(createInvoiceDeleteSchema(t)),
    defaultValues: { reason: '' },
  })
  const mutation = useMutation({
    mutationFn: async (values: InvoiceDeleteForm) => {
      const response = await deleteAdminInvoice(props.invoice.id, values.reason)
      if (!response.success) {
        throw createServerError(
          response,
          t('Failed to delete the invoice application')
        )
      }
      return response.data
    },
    onSuccess: async (result) => {
      const id = props.invoice.id
      props.onDeleted(id)
      if (result?.file_cleanup_pending) {
        toast.warning(
          t('Application deleted. File cleanup will be retried automatically.')
        )
      } else {
        toast.success(t('Invoice application deleted'))
      }
      // 删除后关闭详情并清除缓存，避免继续展示或重新请求已删除的申请。
      const detailKeys = [
        [...ADMIN_INVOICE_QUERY_KEY, 'detail', id],
        [...INVOICE_QUERY_KEY, 'detail', id],
      ]
      const listKeys = [
        [...ADMIN_INVOICE_QUERY_KEY, 'list'],
        [...INVOICE_QUERY_KEY, 'self'],
      ]
      await Promise.all([
        ...detailKeys.map((queryKey) =>
          client.cancelQueries({ queryKey, exact: true })
        ),
        ...listKeys.map((queryKey) => client.cancelQueries({ queryKey })),
      ])
      for (const queryKey of detailKeys) {
        client.removeQueries({ queryKey, exact: true })
      }
      for (const queryKey of listKeys) {
        client.setQueriesData<InvoicePage>({ queryKey }, (previous) => {
          if (!previous?.items?.some((item) => item.id === id)) return previous
          return {
            ...previous,
            items: previous.items.filter((item) => item.id !== id),
            total: Math.max(0, previous.total - 1),
          }
        })
      }
      void client.invalidateQueries({
        queryKey: [...ADMIN_INVOICE_QUERY_KEY, 'list'],
      })
      void client.invalidateQueries({
        queryKey: INVOICE_QUERY_KEY,
        predicate: (query) => query.queryKey[1] !== 'detail',
      })
    },
    onError: (error) =>
      handleServerError(error, t('Failed to delete the invoice application')),
    onSettled: () => {
      submitting.current = false
    },
  })

  function onSubmit(values: InvoiceDeleteForm) {
    if (submitting.current || props.invoice.status !== 'issued') return
    submitting.current = true
    mutation.mutate(values)
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!submitting.current) props.onOpenChange(open)
      }}
      title={t('Permanently delete invoice #{{id}}?', { id: props.invoice.id })}
      desc={
        <div className='space-y-2'>
          <p>
            {t(
              'This permanently removes the application from admin and user lists. The user can no longer download the invoice file.'
            )}
          </p>
          <p>
            {t(
              'No tax is refunded, balances stay unchanged, and the orders cannot be invoiced again. Historical invoice totals and necessary payment records are retained.'
            )}
          </p>
        </div>
      }
      destructive
      confirmText={t('Delete permanently')}
      disabled={props.invoice.status !== 'issued'}
      isLoading={mutation.isPending || form.formState.isSubmitting}
      handleConfirm={() => void form.handleSubmit(onSubmit)()}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FormField
            control={form.control}
            name='reason'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Deletion reason')}</FormLabel>
                <FormControl>
                  <Textarea {...field} rows={4} disabled={mutation.isPending} />
                </FormControl>
                <FormDescription>
                  {t(
                    'The deletion reason is kept in the administrative audit record.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </ConfirmDialog>
  )
}
