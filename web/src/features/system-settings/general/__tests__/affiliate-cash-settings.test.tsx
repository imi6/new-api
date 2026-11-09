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
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18next from 'i18next'
import { afterEach, expect, test, vi } from 'vitest'

import type { AffiliateCashConfig } from '@/features/affiliate-cash/types'
import zhLocale from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { affiliateCashSettingsSchema } from '../affiliate-cash-schema'
import { AffiliateCashSettings } from '../affiliate-cash-settings'

const config: AffiliateCashConfig = {
  exchange_enabled: false,
  withdrawal_enabled: false,
  exchange_rate: '0.1',
  minimum_withdrawal: '10',
  fee_mode: 'fixed',
  fee_fixed: '1',
  fee_percent: '0',
  minimum_basis: 'requested',
  cancel_fee_policy: 'refund',
  failed_fee_policy: 'refund',
  networks: [{ id: 'tron', name: 'TRON', address_kind: 'tron', enabled: true }],
  currency: 'USDT',
  precision: 6,
  version: 'v1',
}

afterEach(async () => {
  useAuthStore.getState().auth.setUser(null)
  await i18next.changeLanguage('en')
})

async function renderSettings(role: number, initial = config) {
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'administrator', role })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: initial },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createRouter({
    routeTree: createRootRoute({ component: AffiliateCashSettings }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return screen.findByRole('textbox', { name: 'Fixed withdrawal fee (USDT)' })
}

test('enabling without the remaining fee policies is rejected instead of guessing defaults', () => {
  const result = affiliateCashSettingsSchema.safeParse({
    ...config,
    withdrawal_enabled: true,
    minimum_basis: '',
    cancel_fee_policy: '',
    failed_fee_policy: '',
  })
  expect(result.success).toBe(false)
  if (!result.success) {
    expect(result.error.issues.map((issue) => issue.path[0])).toEqual(
      expect.arrayContaining([
        'minimum_basis',
        'cancel_fee_policy',
        'failed_fee_policy',
      ])
    )
  }
})

test('network IDs and decimal settings respect the server input limits', () => {
  expect(
    affiliateCashSettingsSchema.safeParse({
      ...config,
      networks: [{ ...config.networks[0], id: 'a'.repeat(32) }],
    }).success
  ).toBe(true)
  expect(
    affiliateCashSettingsSchema.safeParse({
      ...config,
      networks: [{ ...config.networks[0], id: 'a'.repeat(33) }],
    }).success
  ).toBe(false)
  expect(
    affiliateCashSettingsSchema.safeParse({ ...config, fee_fixed: '01' })
      .success
  ).toBe(false)
  expect(
    affiliateCashSettingsSchema.safeParse({
      ...config,
      fee_fixed: '10000000000',
    }).success
  ).toBe(false)
})

test('disabling the final payout network can be saved without changing the feature switches', () => {
  const result = affiliateCashSettingsSchema.safeParse({
    ...config,
    exchange_enabled: true,
    withdrawal_enabled: true,
    networks: [{ ...config.networks[0], enabled: false }],
  })
  expect(result.success).toBe(true)
})

test('network configuration accepts custom networks and strips the legacy address format', () => {
  expect(
    affiliateCashSettingsSchema.parse({
      ...config,
      networks: [{ id: 'custom', name: 'Custom network', enabled: true }],
    }).networks
  ).toEqual([{ id: 'custom', name: 'Custom network', enabled: true }])
  expect(affiliateCashSettingsSchema.parse(config).networks).toEqual([
    { id: 'tron', name: 'TRON', enabled: true },
  ])
})

test('selected fee policies show their localized labels before opening the menus and after changing language', async () => {
  await renderSettings(100, {
    ...config,
    fee_mode: 'percent',
    minimum_basis: 'net',
  })
  const fee = screen.getByRole('combobox', { name: 'Withdrawal fee mode' })
  const minimum = screen.getByRole('combobox', {
    name: 'Minimum withdrawal basis',
  })
  const cancellation = screen.getByRole('combobox', {
    name: 'Fee policy for user cancellation',
  })
  const failure = screen.getByRole('combobox', {
    name: 'Fee policy after confirmed payment failure',
  })
  expect(fee).toHaveTextContent('Percentage fee')
  expect(minimum).toHaveTextContent('Net payout amount')
  expect(cancellation).toHaveTextContent('Refund the full reserved amount')
  expect(failure).toHaveTextContent('Refund the full reserved amount')
  i18next.addResourceBundle('zh', 'translation', zhLocale.translation)
  await act(async () => {
    await i18next.changeLanguage('zh')
  })
  expect(fee).toHaveTextContent('比例手续费')
  expect(minimum).toHaveTextContent('实际到账金额')
  expect(cancellation).toHaveTextContent('退回全部冻结金额')
  expect(failure).toHaveTextContent('退回全部冻结金额')
})

test('network rows have no address-format selector and only new rows can be removed', async () => {
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: {
      success: true,
      data: {
        ...config,
        networks: [{ ...config.networks[0], enabled: false }],
        version: 'v2',
      },
    },
  })
  await renderSettings(100)
  expect(screen.queryByText('Address format')).not.toBeInTheDocument()
  expect(
    screen.getByRole('textbox', { name: 'Network identifier' })
  ).toBeDisabled()
  expect(
    screen.queryByRole('button', { name: 'Remove' })
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Add payout network' }))
  expect(screen.getAllByRole('textbox', { name: 'Network name' })).toHaveLength(
    2
  )
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
  expect(screen.getAllByRole('textbox', { name: 'Network name' })).toHaveLength(
    1
  )
  fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save U settings' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/user/affiliate/cash/settings',
      expect.objectContaining({
        networks: [{ id: 'tron', name: 'TRON', enabled: false }],
      })
    )
  )
})

test('withdrawals can stay enabled without a conversion rate when conversion is disabled', () => {
  expect(
    affiliateCashSettingsSchema.safeParse({
      ...config,
      withdrawal_enabled: true,
      exchange_rate: '',
    }).success
  ).toBe(true)
})

test.each([
  { fee_mode: 'percent', fee_percent: '100' },
  { fee_mode: 'fixed', fee_fixed: '9007199254.740991' },
  {
    fee_mode: 'fixed',
    fee_fixed: '1',
    minimum_basis: 'net',
    minimum_withdrawal: '9007199254.740991',
  },
])(
  'rejects active payout settings that cannot produce a valid positive payout: %o',
  (invalid) => {
    expect(
      affiliateCashSettingsSchema.safeParse({
        ...config,
        withdrawal_enabled: true,
        ...invalid,
      }).success
    ).toBe(false)
  }
)

test('a disabled invalid fee configuration remains editable', () => {
  expect(
    affiliateCashSettingsSchema.safeParse({
      ...config,
      fee_mode: 'percent',
      fee_percent: '100',
    }).success
  ).toBe(true)
})

test('saving preserves the config version and decimal string amounts', async () => {
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: {
      success: true,
      data: { ...config, fee_fixed: '0.123456', version: 'v2' },
    },
  })
  const input = await renderSettings(100)
  fireEvent.change(input, { target: { value: '0.123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save U settings' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/user/affiliate/cash/settings',
      expect.objectContaining({
        version: 'v1',
        fee_fixed: '0.123456',
        networks: [{ id: 'tron', name: 'TRON', enabled: true }],
      })
    )
  )
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Save U settings' })
    ).toBeDisabled()
  )
})

test('an ordinary administrator can read but cannot change payout configuration', async () => {
  const input = await renderSettings(10)
  expect(input).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Save U settings' })).toBeDisabled()
  expect(
    screen.getByText('Only the super administrator can change payout settings.')
  ).toBeInTheDocument()
})
