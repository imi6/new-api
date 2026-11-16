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
import { createServerError, getServerMessage } from '@/lib/server-error-message'

import {
  batchDeleteAdminInvoices,
  deleteAdminInvoice,
  type BatchDeleteInvoiceItem,
} from '../api'
import { ADMIN_INVOICE_QUERY_KEY } from '../hooks/use-admin-invoices'
import {
  createInvoiceDeleteSchema,
  type InvoiceDeleteForm,
} from '../lib/invoice-delete'

type InvoiceDeleteDialogProps = {
  onOpenChange: (open: boolean) => void
} & (
  | {
      mode?: 'single'
      invoice: Invoice
      onDeleted: (id: number) => void
    }
  | {
      mode: 'batch'
      invoices: Invoice[]
      onDeleted: (ids: number[]) => void
    }
)

export function InvoiceDeleteDialog(props: InvoiceDeleteDialogProps) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const submitting = useRef(false)
  const targets = props.mode === 'batch' ? props.invoices : [props.invoice]
  const canDelete =
    targets.length > 0 &&
    targets.length <= 100 &&
    targets.every((invoice) => invoice.status === 'issued')
  const form = useForm<InvoiceDeleteForm>({
    resolver: zodResolver(createInvoiceDeleteSchema(t)),
    defaultValues: { reason: '' },
  })
  const mutation = useMutation({
    mutationFn: async (
      values: InvoiceDeleteForm
    ): Promise<BatchDeleteInvoiceItem[]> => {
      if (props.mode === 'batch') {
        const response = await batchDeleteAdminInvoices(
          targets.map((invoice) => invoice.id),
          values.reason
        )
        if (!response.success || !Array.isArray(response.data?.results)) {
          throw createServerError(
            response,
            t('Failed to delete the invoice application')
          )
        }
        // 仅处理本次提交的申请；缺失的逐项结果不能当作删除成功。
        const results = new Map(
          response.data.results.map((result) => [result.id, result])
        )
        return targets.map(
          (invoice) =>
            results.get(invoice.id) ?? {
              id: invoice.id,
              success: false,
              file_cleanup_pending: false,
              message_key: 'Failed to delete the invoice application',
            }
        )
      }
      const response = await deleteAdminInvoice(props.invoice.id, values.reason)
      if (!response.success) {
        throw createServerError(
          response,
          t('Failed to delete the invoice application')
        )
      }
      return [
        {
          id: props.invoice.id,
          success: true,
          file_cleanup_pending: response.data?.file_cleanup_pending ?? false,
        },
      ]
    },
    onSuccess: async (results) => {
      const successful = results.filter((result) => result.success)
      const failed = results.filter((result) => !result.success)
      const ids = successful.map((result) => result.id)
      const cleanupPending = successful.some(
        (result) => result.file_cleanup_pending
      )
      if (props.mode === 'batch') {
        if (ids.length > 0) {
          props.onDeleted(ids)
          toast.success(
            t('Deleted {{count}} invoice applications', { count: ids.length })
          )
        }
        if (cleanupPending) {
          toast.warning(t('Some invoice files are awaiting automatic cleanup.'))
        }
        if (failed.length > 0) {
          toast.error(
            t(
              'Could not delete {{count}} invoice applications. Review the errors and retry.',
              {
                count: failed.length,
              }
            )
          )
        }
      } else {
        props.onDeleted(props.invoice.id)
        if (cleanupPending) {
          toast.warning(
            t(
              'Application deleted. File cleanup will be retried automatically.'
            )
          )
        } else {
          toast.success(t('Invoice application deleted'))
        }
      }
      if (ids.length === 0) return
      // 删除后关闭详情并清除缓存，避免继续展示或重新请求已删除的申请。
      const deletedIds = new Set(ids)
      const detailKeys = ids.flatMap((id) => [
        [...ADMIN_INVOICE_QUERY_KEY, 'detail', id],
        [...INVOICE_QUERY_KEY, 'detail', id],
      ])
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
          if (!previous?.items) return previous
          const items = previous.items.filter(
            (item) => !deletedIds.has(item.id)
          )
          const removedCount = previous.items.length - items.length
          if (removedCount === 0) return previous
          return {
            ...previous,
            items,
            total: Math.max(0, previous.total - removedCount),
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
    if (submitting.current || !canDelete) return
    submitting.current = true
    mutation.mutate(values)
  }

  const failures = mutation.data?.filter((result) => !result.success) ?? []

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!submitting.current) props.onOpenChange(open)
      }}
      title={
        props.mode === 'batch'
          ? t('Permanently delete {{count}} invoice applications?', {
              count: targets.length,
            })
          : t('Permanently delete invoice #{{id}}?', { id: props.invoice.id })
      }
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
      disabled={!canDelete}
      isLoading={mutation.isPending || form.formState.isSubmitting}
      handleConfirm={() => void form.handleSubmit(onSubmit)()}
    >
      {failures.length > 0 && (
        <div
          role='alert'
          className='bg-destructive/10 text-destructive max-h-40 overflow-y-auto rounded-md p-3 text-sm'
        >
          <ul className='space-y-1'>
            {failures.map((result) => (
              <li key={result.id}>
                {t('Application #{{id}}', { id: result.id })}:{' '}
                {getServerMessage(result) ??
                  t('Failed to delete the invoice application')}
              </li>
            ))}
          </ul>
        </div>
      )}
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
