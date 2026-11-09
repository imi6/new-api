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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import type { AffiliateWithdrawal } from '@/features/affiliate-cash/types'
import { api } from '@/lib/api'

import { AffiliateWithdrawalsTab } from '../components/affiliate-withdrawals-tab'
import { WithdrawalActionDialog } from '../components/withdrawal-action-dialog'
import { WithdrawalDetailDialog } from '../components/withdrawal-detail-dialog'

const order: AffiliateWithdrawal = {
  id: 12,
  version: 3,
  user_id: 7,
  amount: '10',
  fee: '1',
  net_amount: '9',
  network: 'tron',
  address: 'TExampleRecipientAddress',
  status: 'paying',
  config_version: 'v1',
  created_at: 100,
  updated_at: 100,
  paid_at: 0,
  reason: '',
  transaction_id: '',
  cancel_fee_policy: 'refund',
  failed_fee_policy: 'refund',
}

function renderAction(
  action: 'complete' | 'fail_release' | 'fail_retry' | 'correct'
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <WithdrawalActionDialog
        withdrawal={order}
        action={action}
        label='Apply withdrawal action'
        onClose={onClose}
      />
    </QueryClientProvider>
  )
  return onClose
}

test('an uncertain payment cannot be released without a reason and explicit unpaid confirmation', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { ...order, status: 'failed' } },
  })
  renderAction('fail_release')
  fireEvent.click(
    screen.getByRole('button', { name: 'Apply withdrawal action' })
  )
  expect(await screen.findByText('Please provide a reason')).toBeInTheDocument()
  expect(post).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), {
    target: {
      value: 'Verified by the payment operator: no transfer was sent.',
    },
  })
  await userEvent.click(
    screen.getByRole('checkbox', {
      name: 'I have verified that this payment did not reach the recipient.',
    })
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Apply withdrawal action' })
  )
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/user/affiliate/cash/withdrawals/12/action',
      expect.objectContaining({
        action: 'fail_release',
        unpaid_confirmed: true,
        request_id: expect.any(String),
        expected_version: 3,
        reason: 'Verified by the payment operator: no transfer was sent.',
      })
    )
  )
})

test('recording payment requires a transaction hash and sends the actual locked payout fields', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { ...order, status: 'completed' } },
  })
  renderAction('complete')
  fireEvent.click(
    screen.getByRole('button', { name: 'Apply withdrawal action' })
  )
  expect(await screen.findByText('This field is required')).toBeInTheDocument()
  expect(post).not.toHaveBeenCalled()
  fireEvent.change(
    screen.getByRole('textbox', {
      name: 'Transaction hash',
    }),
    { target: { value: 'tx-confirmed-12' } }
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Apply withdrawal action' })
  )
  expect(
    await screen.findByText(
      'Enter a 64-character hexadecimal transaction hash, optionally prefixed with 0x'
    )
  ).toBeInTheDocument()
  expect(post).not.toHaveBeenCalled()
  const transactionID = 'ab'.repeat(32)
  fireEvent.change(screen.getByRole('textbox', { name: 'Transaction hash' }), {
    target: { value: transactionID },
  })
  fireEvent.click(
    screen.getByRole('button', { name: 'Apply withdrawal action' })
  )
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/user/affiliate/cash/withdrawals/12/action',
      expect.objectContaining({
        action: 'complete',
        expected_version: 3,
        transaction_id: transactionID,
        actual_amount: '9',
        network: 'tron',
        address: order.address,
      })
    )
  )
})

test('an open payment action keeps its original order version after a background refresh', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { ...order, status: 'paying', version: 4 } },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const onClose = vi.fn()
  const view = render(
    <QueryClientProvider client={client}>
      <WithdrawalActionDialog
        withdrawal={{ ...order, status: 'approved' }}
        action='start'
        label='Begin payment'
        onClose={onClose}
      />
    </QueryClientProvider>
  )
  view.rerender(
    <QueryClientProvider client={client}>
      <WithdrawalActionDialog
        withdrawal={{ ...order, status: 'approved', version: 5 }}
        action='start'
        label='Begin payment'
        onClose={onClose}
      />
    </QueryClientProvider>
  )
  await userEvent.click(screen.getByRole('button', { name: 'Begin payment' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/user/affiliate/cash/withdrawals/12/action',
      expect.objectContaining({ action: 'start', expected_version: 3 })
    )
  )
})

test('a stale payment action displays the server warning and blocks resubmission until the order is reviewed again', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: false,
      message_key: 'The withdrawal state changed. Refresh and try again',
    },
  })
  renderAction('correct')
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Correction details' }),
    {
      target: { value: 'Corrected the record.' },
    }
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Apply withdrawal action' })
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The withdrawal state changed. Refresh and try again'
  )
  expect(
    screen.getByRole('button', { name: 'Apply withdrawal action' })
  ).toBeDisabled()
  expect(post).toHaveBeenCalledTimes(1)
})

test('retrying the same failed request preserves its idempotency identifier', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockRejectedValueOnce(new Error('Network unavailable'))
    .mockResolvedValueOnce({ data: { success: true, data: order } })
  const onClose = renderAction('correct')
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Correction details' }),
    {
      target: {
        value: 'Corrected the operator note; payment remains completed.',
      },
    }
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Apply withdrawal action' })
  )
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Apply withdrawal action' })
    ).toBeEnabled()
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Apply withdrawal action' })
  )
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(post.mock.calls[1]?.[1]).toEqual(post.mock.calls[0]?.[1])
  expect(post.mock.calls[1]?.[1]).toMatchObject({ action: 'correct' })
})

test.each(['paying', 'completed'] as const)(
  'a %s order cannot expose rejection or another start-payment action',
  async (status) => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          withdrawal: { ...order, status },
          attempts: [],
          corrections: [],
        },
      },
    })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <WithdrawalDetailDialog id={12} onClose={vi.fn()} />
      </QueryClientProvider>
    )
    await screen.findByText('No payment attempts yet')
    expect(
      screen.queryByRole('button', { name: 'Reject and return funds' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Begin payment' })
    ).not.toBeInTheDocument()
    if (status === 'completed') {
      expect(
        screen.getByRole('button', { name: 'Append correction' })
      ).toBeEnabled()
      expect(
        screen.queryByRole('button', {
          name: 'Confirmed unpaid: end and release',
        })
      ).not.toBeInTheDocument()
    } else {
      expect(
        screen.getByRole('button', { name: 'Record successful payment' })
      ).toBeEnabled()
    }
  }
)

test('withdrawal totals preserve U precision and refresh with the order list', async () => {
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/summary')
        ? {
            completed_net_amount: '9007199254740991.123456',
            completed_fee: '0.000001',
            u_available_total: '12.5',
            u_frozen_total: '10',
          }
        : { items: [], total: 0, page: 1, page_size: 20 },
    },
  }))
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <AffiliateWithdrawalsTab />
    </QueryClientProvider>
  )
  expect(
    await screen.findByText('9007199254740991.123456 U')
  ).toBeInTheDocument()
  expect(screen.getByText('0.000001 U')).toBeInTheDocument()
  const status = screen.getByRole('combobox', { name: 'Withdrawal status' })
  expect(status).toHaveTextContent('All statuses')
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await waitFor(() =>
    expect(
      get.mock.calls.filter(([url]) => url.endsWith('/summary'))
    ).toHaveLength(2)
  )
  expect(
    get.mock.calls.filter(([url]) => url.endsWith('/withdrawals'))
  ).toHaveLength(2)
  await userEvent.click(status)
  await userEvent.click(
    await screen.findByRole('option', { name: 'Awaiting payment' })
  )
  expect(status).toHaveTextContent('Awaiting payment')
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith('/api/user/affiliate/cash/withdrawals', {
      params: { p: 1, page_size: 20, status: 'approved' },
    })
  )
})
