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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { affiliateWithdrawalSchema } from '@/features/affiliate-cash/lib/amount'
import type {
  AffiliateCashSummary,
  AffiliateWithdrawal,
} from '@/features/affiliate-cash/types'
import { api } from '@/lib/api'

import { AffiliateCashDeletionNotice } from '../components/affiliate-cash-deletion-notice'
import { AffiliateCashHistory } from '../components/affiliate-cash-history'
import { AffiliateClaimCard } from '../components/affiliate-claim-card'
import { AffiliateWithdrawalCard } from '../components/affiliate-withdrawal-card'

const summary: AffiliateCashSummary = {
  rebate_unclaimed_quota: 50_000_000,
  max_platform_claim_quota: 10_000_000,
  max_u_exchange_quota: 10_000_000,
  u_available: '20.123456',
  u_frozen: '10',
  pending_withdrawals: 1,
  can_exchange: true,
  can_withdraw: true,
  platform_reason: '',
  exchange_reason: '',
  withdrawal_reason: '',
  config: {
    exchange_enabled: true,
    withdrawal_enabled: true,
    exchange_rate: '0.1',
    minimum_withdrawal: '10',
    fee_mode: 'fixed',
    fee_fixed: '1',
    fee_percent: '0',
    minimum_basis: 'requested',
    cancel_fee_policy: 'refund',
    failed_fee_policy: 'refund',
    version: 'v1',
    currency: 'USDT',
    precision: 6,
    networks: [
      { id: 'tron', name: 'TRON', address_kind: 'tron', enabled: true },
    ],
  },
}
let client: QueryClient

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
})
afterEach(() => {
  client.clear()
  vi.restoreAllMocks()
})

function renderCash(ui: React.ReactNode) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

it('uses the current claim limit for All and keeps an unspecified user choice on platform balance', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: true,
      data: {
        quota: 10_000_000,
        destination: 'platform',
        u_amount: '0',
        exchange_rate: '0.1',
        config_version: 'v1',
        minimum_withdrawal: '10',
        can_submit: true,
        reason: '',
      },
    },
  })
  renderCash(
    <AffiliateClaimCard
      summary={summary}
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'All' }))
  expect(screen.getByLabelText('Amount to claim')).toHaveValue('20')
  await user.click(screen.getByRole('button', { name: 'Review claim' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(post).toHaveBeenCalledWith(
    '/api/user/affiliate_cash/exchange/preview',
    { quota: 10_000_000, destination: 'platform' }
  )
  expect(
    within(dialog).getByRole('button', { name: 'Confirm transfer' })
  ).toBeVisible()
  expect(
    post.mock.calls.some(([url]) => url === '/api/user/affiliate_cash/exchange')
  ).toBe(false)
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(post).toHaveBeenCalledTimes(1)
})

it('shows irreversible U and account deletion restrictions before submission and reuses the request ID on retry', async () => {
  let submitCount = 0
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url.endsWith('/preview')) {
      return {
        data: {
          success: true,
          data: {
            quota: 10_000_000,
            destination: 'u',
            u_amount: '2',
            exchange_rate: '0.1',
            config_version: 'v1',
            minimum_withdrawal: '10',
            can_submit: true,
            reason: '',
          },
        },
      }
    }
    submitCount++
    if (submitCount === 1) throw new Error('Connection interrupted')
    return { data: { success: true, data: {} } }
  })
  const changed = vi.fn().mockResolvedValue(undefined)
  renderCash(<AffiliateClaimCard summary={summary} onChanged={changed} />)
  const user = userEvent.setup()
  await user.click(
    screen.getByRole('radio', { name: 'Convert to withdrawable U' })
  )
  await user.click(screen.getByRole('button', { name: 'All' }))
  await user.click(screen.getByRole('button', { name: 'Review claim' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText(/U cannot be transferred back/)).toBeVisible()
  expect(within(dialog).getByText(/potentially indefinitely/)).toBeVisible()
  expect(submitCount).toBe(0)
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirm conversion' })
  )
  expect(await screen.findByText('Connection interrupted')).toBeVisible()
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirm conversion' })
  )
  await waitFor(() => expect(changed).toHaveBeenCalledOnce())
  const requests = post.mock.calls
    .filter(([url]) => url === '/api/user/affiliate_cash/exchange')
    .map(([, data]) => data)
  expect(requests).toHaveLength(2)
  expect(requests[0]).toEqual(requests[1])
  expect(requests[0]).toMatchObject({
    destination: 'u',
    confirmed: true,
    config_version: 'v1',
    quota: 10_000_000,
  })
})

it('keeps U disabled without removing the eligible platform claim', async () => {
  renderCash(
    <AffiliateClaimCard
      summary={{
        ...summary,
        max_u_exchange_quota: 0,
        can_exchange: false,
        exchange_reason: 'U conversion is disabled',
      }}
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />
  )
  const user = userEvent.setup()
  expect(screen.getByRole('button', { name: 'Review claim' })).toBeEnabled()
  await user.click(
    screen.getByRole('radio', { name: 'Convert to withdrawable U' })
  )
  expect(screen.getByRole('button', { name: 'All' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Review claim' })).toBeDisabled()
  expect(screen.getByText('U conversion is disabled')).toBeVisible()
})

it('previews the freeze, fee, net payment and address before creating a withdrawal', async () => {
  let submitted = 0
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (!url.endsWith('/preview')) {
      submitted++
      if (submitted === 1) throw new Error('Connection interrupted')
    }
    return {
      data: {
        success: true,
        data: {
          amount: '10',
          fee: '1',
          net_amount: '9',
          network: 'tron',
          address: 'TReceivingAddress',
          config_version: 'v1',
          cancel_fee_policy: 'retain',
          failed_fee_policy: 'refund',
          can_submit: true,
          reason: '',
        },
      },
    }
  })
  renderCash(
    <AffiliateWithdrawalCard
      summary={summary}
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />
  )
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Withdrawal amount (U)'), '10')
  await user.click(screen.getByRole('combobox'))
  await user.click(await screen.findByRole('option', { name: 'TRON' }))
  await user.type(
    screen.getByLabelText('Receiving address'),
    'TReceivingAddress'
  )
  await user.click(screen.getByRole('button', { name: 'Review withdrawal' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText('10 U')).toBeVisible()
  expect(within(dialog).getByText('1 U')).toBeVisible()
  expect(within(dialog).getByText('9 U')).toBeVisible()
  expect(within(dialog).getByText('TReceivingAddress')).toBeVisible()
  expect(
    within(dialog).getByText(
      'Cancellation returns the requested amount minus the locked fee.'
    )
  ).toBeVisible()
  expect(
    within(dialog).getByText(
      'A confirmed failed payment returns the full frozen amount.'
    )
  ).toBeVisible()
  expect(post).toHaveBeenCalledTimes(1)
  await user.click(
    within(dialog).getByRole('button', { name: 'Submit withdrawal' })
  )
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
  expect(
    await within(dialog).findByText('Connection interrupted')
  ).toBeVisible()
  await user.click(
    within(dialog).getByRole('button', { name: 'Submit withdrawal' })
  )
  await waitFor(() => expect(post).toHaveBeenCalledTimes(3))
  expect(post.mock.calls[1][1]).toEqual(post.mock.calls[2][1])
  expect(post.mock.calls[1][1]).toMatchObject({
    amount: '10',
    network: 'tron',
    address: 'TReceivingAddress',
    config_version: 'v1',
  })
})

it('shows the distinct server ledger categories and only displays U for conversion entries', async () => {
  const kinds = [
    'opening_accrued',
    'opening_deducted',
    'earned',
    'reversal',
    'claim_platform',
    'claim_u',
    'admin_grant',
    'admin_revoke',
  ]
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: {
        items: url.endsWith('/ledger')
          ? kinds.map((kind, index) => ({
              id: index + 1,
              kind,
              quota: kind === 'earned' ? 500_000 : -500_000,
              u_amount: kind === 'claim_u' ? '0.123456' : '0',
              exchange_rate: kind === 'claim_u' ? '0.123456' : '',
              created_at: 1_000,
              request_id: `entry:${index}`,
              reason: '',
            }))
          : [],
        total: url.endsWith('/ledger') ? kinds.length : 0,
        page: 1,
        page_size: 10,
      },
    },
  }))
  renderCash(<AffiliateCashHistory />)
  await userEvent
    .setup()
    .click(screen.getByRole('tab', { name: 'Rebate ledger' }))
  expect(await screen.findByText('Opening earned rebate')).toBeVisible()
  expect(screen.getByText('Opening claimed adjustment')).toBeVisible()
  expect(screen.getByText('Rebate earned')).toBeVisible()
  expect(screen.getByText('Rebate reversal')).toBeVisible()
  expect(screen.getByText('Transfer to platform balance')).toBeVisible()
  expect(screen.getByText('Convert to withdrawable U')).toBeVisible()
  expect(screen.getByText('Administrator transfer')).toBeVisible()
  expect(screen.getByText('Administrative deduction')).toBeVisible()
  expect(
    screen.getByRole('columnheader', { name: 'U conversion rate' })
  ).toBeVisible()
  expect(screen.getAllByText('0.123456 U')).toHaveLength(2)
  expect(screen.queryByText('0 U')).not.toBeInTheDocument()
})

it.each(['01', '1e3', '1.0000001', '10000000000', '0', '-1'])(
  'rejects noncanonical or unsupported U amounts before preview: %s',
  (amount) => {
    expect(
      affiliateWithdrawalSchema.safeParse({
        amount,
        network: 'tron',
        address: 'TAddress',
      }).success
    ).toBe(false)
  }
)

it('preserves six decimal U input and rejects an oversized receiving address', () => {
  expect(
    affiliateWithdrawalSchema.parse({
      amount: '0.123456',
      network: 'tron',
      address: 'TAddress',
    }).amount
  ).toBe('0.123456')
  expect(
    affiliateWithdrawalSchema.safeParse({
      amount: '1',
      network: 'tron',
      address: 'T'.repeat(129),
    }).success
  ).toBe(false)
})

it('only allows cancelling pending withdrawals and shows the locked return amount', async () => {
  const order: AffiliateWithdrawal = {
    id: 1,
    version: 1,
    user_id: 1,
    amount: '10',
    fee: '1',
    net_amount: '9',
    network: 'tron',
    address: 'TAddress',
    status: 'pending',
    config_version: 'v1',
    created_at: 1_000,
    updated_at: 1_000,
    paid_at: 0,
    reason: '',
    transaction_id: '',
    cancel_fee_policy: 'retain',
    failed_fee_policy: 'refund',
  }
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        items: [order, { ...order, id: 2, status: 'paying' }],
        total: 2,
        page: 1,
        page_size: 10,
      },
    },
  })
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { ...order, status: 'cancelled' } },
  })
  const refresh = vi
    .spyOn(client, 'invalidateQueries')
    .mockRejectedValue(new Error('Refresh unavailable'))
  renderCash(<AffiliateCashHistory />)
  const user = userEvent.setup()
  const buttons = await screen.findAllByRole('button', {
    name: 'Cancel withdrawal',
  })
  expect(buttons).toHaveLength(1)
  await user.click(buttons[0])
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText('Amount returned: 9 U')).toBeVisible()
  expect(post).not.toHaveBeenCalled()
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirm cancellation' })
  )
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/user/affiliate_cash/withdrawals/1/cancel',
      expect.objectContaining({
        request_id: expect.any(String),
        expected_version: 1,
      })
    )
  )
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(screen.queryByText('Refresh unavailable')).not.toBeInTheDocument()
})

it('withdrawal history separates expected payments from actual fees, payouts and returned funds', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        items: [
          {
            id: 4,
            version: 2,
            user_id: 1,
            amount: '10',
            fee: '1',
            net_amount: '9',
            actual_amount: '0',
            actual_fee: '0',
            refunded_amount: '10',
            network: 'tron',
            address: 'TAddress',
            status: 'rejected',
            config_version: 'v1',
            created_at: 1000,
            updated_at: 1000,
            paid_at: 0,
            reason: '',
            transaction_id: '',
            cancel_fee_policy: 'refund',
            failed_fee_policy: 'refund',
          },
        ],
        total: 1,
        page: 1,
        page_size: 10,
      },
    },
  })
  renderCash(<AffiliateCashHistory />)
  await screen.findByText('Rejected')
  const row = screen.getAllByRole('row')[1]
  expect(
    screen.getByRole('columnheader', { name: 'Expected payout' })
  ).toBeVisible()
  expect(
    screen.getByRole('columnheader', { name: 'Actual payout' })
  ).toBeVisible()
  expect(
    screen.getByRole('columnheader', { name: 'Fee charged' })
  ).toBeVisible()
  expect(
    screen.getByRole('columnheader', { name: 'Amount returned' })
  ).toBeVisible()
  expect(within(row).getAllByText('0 U')).toHaveLength(2)
  expect(within(row).getAllByText('10 U')).toHaveLength(2)
})

it('shows exact available and frozen U with the minimum and long-term deletion restriction', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: summary },
  })
  render(<AffiliateCashDeletionNotice open />)
  expect(await screen.findByText('20.123456 U')).toBeVisible()
  expect(screen.getAllByText('10 U')).toHaveLength(2)
  expect(screen.getByText(/may prevent deletion indefinitely/)).toBeVisible()
})
