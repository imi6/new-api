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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import type { AffiliateCashConfig } from '@/features/affiliate-cash/types'
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

afterEach(() => useAuthStore.getState().auth.setUser(null))

async function renderSettings(role: number) {
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'administrator', role })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: config },
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
      expect.objectContaining({ version: 'v1', fee_fixed: '0.123456' })
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
