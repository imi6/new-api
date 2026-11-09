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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { toast } from 'sonner'
import { beforeEach, expect, test, vi } from 'vitest'

import { INVOICE_QUERY_KEY } from '@/features/invoice/hooks/use-invoice'
import type { Invoice, InvoiceStatus } from '@/features/invoice/types'
import { api } from '@/lib/api'

import { useInvoiceColumns } from '../components/invoice-columns'
import { InvoiceDeleteDialog } from '../components/invoice-delete-dialog'
import { InvoiceDetailDrawer } from '../components/invoice-detail-drawer'
import { ADMIN_INVOICE_QUERY_KEY } from '../hooks/use-admin-invoices'

const invoice: Invoice = {
  id: 17,
  user_id: 9,
  status: 'issued',
  invoice_type: 'normal',
  title_type: 'company',
  title: 'Example company',
  tax_no: 'TAX123',
  reg_address: '',
  reg_phone: '',
  bank_name: '',
  bank_account: '',
  category: 'Service',
  email: 'invoice@example.com',
  order_amount: '100.00',
  tax_rate: '3',
  tax_amount: '3.00',
  invoice_amount: '100.00',
  tax_trade_no: 'INV17',
  tax_payment_method: 'balance',
  tax_gateway: '',
  tax_paid_time: 1,
  reject_reason: '',
  file_name: 'invoice.pdf',
  file_size: 100,
  file_mime: 'application/pdf',
  create_time: 1,
  update_time: 2,
  issued_time: 2,
}

function InvoiceActions(props: {
  status: InvoiceStatus
  onDelete: (invoice: Invoice) => void
}) {
  const columns = useInvoiceColumns(() => {}, props.onDelete)
  const table = useReactTable({
    data: [{ ...invoice, status: props.status }],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })
  const cell = table
    .getRowModel()
    .rows[0].getAllCells()
    .find((item) => item.column.id === 'actions')
  return cell ? (
    <>{flexRender(cell.column.columnDef.cell, cell.getContext())}</>
  ) : null
}

function DeleteDialogHarness(props: { onDeleted: (id: number) => void }) {
  const [open, setOpen] = useState(true)
  if (!open) return <div>Closed</div>
  return (
    <InvoiceDeleteDialog
      invoice={invoice}
      onOpenChange={setOpen}
      onDeleted={(id) => {
        props.onDeleted(id)
        setOpen(false)
      }}
    />
  )
}

function renderDeleteDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const onDeleted = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <DeleteDialogHarness onDeleted={onDeleted} />
    </QueryClientProvider>
  )
  return { client, onDeleted }
}

beforeEach(() => {
  vi.spyOn(toast, 'success').mockImplementation(() => 1)
  vi.spyOn(toast, 'warning').mockImplementation(() => 1)
  vi.spyOn(toast, 'error').mockImplementation(() => 1)
})

test('已开票记录显示删除入口并传递选中的申请', async () => {
  const onDelete = vi.fn()
  render(<InvoiceActions status='issued' onDelete={onDelete} />)
  await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
  expect(onDelete).toHaveBeenCalledWith(invoice)
  expect(screen.getByRole('button', { name: 'Details' })).toBeVisible()
})

test('已开票详情中的删除入口传递当前申请', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { invoice, items: [], username: 'Example' } },
  })
  const onDelete = vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <InvoiceDetailDrawer
        invoiceId={17}
        onOpenChange={vi.fn()}
        onChanged={vi.fn()}
        onDelete={onDelete}
      />
    </QueryClientProvider>
  )
  await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
  expect(onDelete).toHaveBeenCalledWith(invoice)
})

test.each<InvoiceStatus>([
  'pending_payment',
  'pending_review',
  'rejected',
  'cancelled',
])('%s 记录不显示删除入口', (status) => {
  render(<InvoiceActions status={status} onDelete={vi.fn()} />)
  expect(
    screen.queryByRole('button', { name: 'Delete' })
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', {
      name: status === 'pending_review' ? 'Process' : 'Details',
    })
  ).toBeVisible()
})

test('空白原因阻止提交并在字段下提示', async () => {
  const post = vi.spyOn(api, 'post')
  renderDeleteDialog()
  fireEvent.change(screen.getByLabelText('Deletion reason'), {
    target: { value: '   ' },
  })
  await userEvent.click(
    screen.getByRole('button', { name: 'Delete permanently' })
  )
  expect(await screen.findByText('Enter the deletion reason')).toBeVisible()
  expect(screen.getByLabelText('Deletion reason')).toHaveAttribute(
    'aria-invalid',
    'true'
  )
  expect(post).not.toHaveBeenCalled()
})

test('原因按 Unicode 字符计数且成功提交时去除首尾空白', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { file_cleanup_pending: false } },
  })
  const { onDeleted } = renderDeleteDialog()
  fireEvent.change(screen.getByLabelText('Deletion reason'), {
    target: { value: '😀'.repeat(501) },
  })
  await userEvent.click(
    screen.getByRole('button', { name: 'Delete permanently' })
  )
  expect(
    await screen.findByText(
      'The deletion reason can have at most 500 characters'
    )
  ).toBeVisible()
  expect(post).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Deletion reason'), {
    target: { value: `  ${'😀'.repeat(500)}  ` },
  })
  await userEvent.click(
    screen.getByRole('button', { name: 'Delete permanently' })
  )
  await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(17))
  expect(post).toHaveBeenCalledWith('/api/invoice/admin/17/delete', {
    reason: '😀'.repeat(500),
  })
})

test('删除成功关闭弹窗并清除详情缓存和刷新两端列表', async () => {
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { file_cleanup_pending: false } },
  })
  const { client, onDeleted } = renderDeleteDialog()
  const adminListKey = [...ADMIN_INVOICE_QUERY_KEY, 'list', 1, 20, 'all', '']
  const userListKey = [...INVOICE_QUERY_KEY, 'self', 1, 20, 'all']
  const adminDetailKey = [...ADMIN_INVOICE_QUERY_KEY, 'detail', 17]
  const userDetailKey = [...INVOICE_QUERY_KEY, 'detail', 17]
  client.setQueryData(adminListKey, { items: [invoice], total: 1 })
  client.setQueryData(userListKey, { items: [invoice], total: 1 })
  client.setQueryData(adminDetailKey, { invoice, items: [] })
  client.setQueryData(userDetailKey, { invoice, items: [] })
  fireEvent.change(screen.getByLabelText('Deletion reason'), {
    target: { value: 'Requested removal' },
  })
  await userEvent.click(
    screen.getByRole('button', { name: 'Delete permanently' })
  )
  await screen.findByText('Closed')
  await waitFor(() =>
    expect(client.getQueryState(adminListKey)?.isInvalidated).toBe(true)
  )
  expect(client.getQueryState(userListKey)?.isInvalidated).toBe(true)
  expect(client.getQueryData(adminListKey)).toMatchObject({
    items: [],
    total: 0,
  })
  expect(client.getQueryData(userListKey)).toMatchObject({
    items: [],
    total: 0,
  })
  expect(client.getQueryData(adminDetailKey)).toBeUndefined()
  expect(client.getQueryData(userDetailKey)).toBeUndefined()
  expect(onDeleted).toHaveBeenCalledWith(17)
  expect(toast.success).toHaveBeenCalledWith('Invoice application deleted')
})

test.each(['business', 'network'] as const)(
  '%s 失败保持弹窗和已填写原因以便重试',
  async (failure) => {
    const post = vi.spyOn(api, 'post')
    if (failure === 'business') {
      post.mockResolvedValue({
        data: {
          success: false,
          message: 'Only issued invoice applications can be deleted',
        },
      })
    } else {
      post.mockRejectedValue(new Error('Network unavailable'))
    }
    const { onDeleted } = renderDeleteDialog()
    fireEvent.change(screen.getByLabelText('Deletion reason'), {
      target: { value: 'Keep this reason' },
    })
    await userEvent.click(
      screen.getByRole('button', { name: 'Delete permanently' })
    )
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(screen.getByLabelText('Deletion reason')).toHaveValue(
      'Keep this reason'
    )
    expect(
      screen.getByRole('button', { name: 'Delete permanently' })
    ).toBeEnabled()
    expect(onDeleted).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  }
)

test('提交中禁止重复提交、取消和键盘关闭', async () => {
  let resolveRequest!: (value: unknown) => void
  const request = new Promise((resolve) => {
    resolveRequest = resolve
  })
  const post = vi.spyOn(api, 'post').mockReturnValue(request)
  const { onDeleted } = renderDeleteDialog()
  fireEvent.change(screen.getByLabelText('Deletion reason'), {
    target: { value: 'Requested removal' },
  })
  await userEvent.dblClick(
    screen.getByRole('button', { name: 'Delete permanently' })
  )
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Delete permanently' })
  ).toBeDisabled()
  expect(screen.getByLabelText('Deletion reason')).toBeDisabled()
  await userEvent.keyboard('{Escape}')
  expect(screen.getByRole('alertdialog')).toBeVisible()
  await act(async () =>
    resolveRequest({
      data: { success: true, data: { file_cleanup_pending: false } },
    })
  )
  await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(17))
})

test('附件待后台清理仍视为删除成功并显示独立提示', async () => {
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { file_cleanup_pending: true } },
  })
  const { onDeleted } = renderDeleteDialog()
  fireEvent.change(screen.getByLabelText('Deletion reason'), {
    target: { value: 'Requested removal' },
  })
  await userEvent.click(
    screen.getByRole('button', { name: 'Delete permanently' })
  )
  await screen.findByText('Closed')
  expect(onDeleted).toHaveBeenCalledWith(17)
  expect(toast.warning).toHaveBeenCalledWith(
    'Application deleted. File cleanup will be retried automatically.'
  )
  expect(toast.error).not.toHaveBeenCalled()
})
