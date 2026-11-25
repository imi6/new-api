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
  act,
  cleanup,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { STATUS_QUERY_KEY, type StatusData } from '@/lib/status-query'
import { useAuthStore } from '@/stores/auth-store'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
  type CurrencyDisplayType,
} from '@/stores/system-config-store'

import { ApiKeysPrimaryButtons } from '../api-keys-primary-buttons'
import { ApiKeysProvider } from '../api-keys-provider'
import { IntelligenceTestProvider } from '../intelligence-test-provider'

let client: QueryClient

beforeEach(() => {
  localStorage.clear()
  useAuthStore.getState().auth.setUser(null)
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  client = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  })
})

afterEach(() => {
  cleanup()
  client.clear()
  useAuthStore.getState().auth.setUser(null)
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  localStorage.clear()
})

function renderAddresses(status: StatusData) {
  client.setQueryData(STATUS_QUERY_KEY, status)
  return render(
    <QueryClientProvider client={client}>
      <IntelligenceTestProvider>
        <ApiKeysProvider>
          <ApiKeysPrimaryButtons />
        </ApiKeysProvider>
      </IntelligenceTestProvider>
    </QueryClientProvider>
  )
}

it('shows every configured address and copies only the chosen visible URL', async () => {
  const user = userEvent.setup()
  const writeText = vi.spyOn(navigator.clipboard, 'writeText')
  renderAddresses({
    server_address: 'https://console.example.com',
    api_info_enabled: true,
    api_info: [
      {
        route: 'Global',
        description: 'Worldwide access',
        url: 'https://api.example.com/v1',
        color: 'blue',
      },
      {
        route: 'Asia',
        description: 'Regional access',
        url: 'https://asia.example.com/gateway/v1/',
        color: 'green',
      },
    ],
  })

  await user.click(screen.getByRole('button', { name: 'API Addresses' }))
  const dialog = await screen.findByRole('dialog', { name: 'API Addresses' })
  const rows = within(dialog).getAllByRole('listitem')
  expect(rows).toHaveLength(2)
  expect(rows[0]).toHaveTextContent('Global')
  expect(rows[0]).toHaveTextContent('Worldwide access')
  expect(within(rows[0]).getByText('https://api.example.com/v1')).toBeVisible()
  expect(rows[1]).toHaveTextContent('Asia')
  expect(rows[1]).toHaveTextContent('Regional access')
  expect(
    within(rows[1]).getByText('https://asia.example.com/gateway/v1/')
  ).toBeVisible()
  expect(writeText).not.toHaveBeenCalled()

  await user.click(
    within(rows[1]).getByRole('button', {
      name: 'Copy API URL: https://asia.example.com/gateway/v1/',
    })
  )
  expect(writeText).toHaveBeenCalledWith('https://asia.example.com/gateway/v1/')
  expect(
    await within(rows[1]).findByRole('button', { name: 'Copied' })
  ).toBeVisible()
  expect(
    within(rows[0]).getByRole('button', {
      name: 'Copy API URL: https://api.example.com/v1',
    })
  ).toBeVisible()
})

it.each([
  {
    status: {
      api_info: [],
      server_address: 'https://gateway.example.com/proxy/',
    },
    label: 'Default API address',
    url: 'https://gateway.example.com/proxy/',
  },
  {
    status: { api_info: [] },
    label: 'Current domain',
    url: window.location.origin,
  },
  {
    status: {
      api_info_enabled: false,
      api_info: [
        {
          route: 'Hidden',
          description: 'Disabled address',
          url: 'https://hidden.example.com',
          color: 'blue',
        },
      ],
      server_address: 'https://gateway.example.com',
    },
    label: 'Default API address',
    url: 'https://gateway.example.com',
  },
])(
  'shows and copies the fallback $label when no configured addresses are available',
  async ({ status, label, url }) => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    renderAddresses(status)

    await user.tab()
    const trigger = screen.getByRole('button', { name: 'API Addresses' })
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'API Addresses' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(1)
    expect(within(dialog).getByText(label)).toBeVisible()
    expect(within(dialog).getByText(url)).toBeVisible()
    const copy = within(dialog).getByRole('button', {
      name: `Copy API URL: ${url}`,
    })
    await waitFor(() => expect(copy).toHaveFocus())
    await user.keyboard('{Enter}')
    expect(writeText).toHaveBeenCalledWith(url)
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
    )
    expect(trigger).toHaveFocus()
  }
)

it('keeps long addresses readable within the scrollable panel and updates when configuration changes', async () => {
  const user = userEvent.setup()
  const url =
    'https://regional-api-gateway.example.com/organization/production/openai-compatible/v1/'
  renderAddresses({
    api_info: [
      {
        route: 'Regional gateway',
        description: 'Regional production gateway',
        url,
        color: 'blue',
      },
    ],
  })
  await user.click(screen.getByRole('button', { name: 'API Addresses' }))
  const dialog = await screen.findByRole('dialog', { name: 'API Addresses' })
  expect(dialog).toHaveClass('max-w-[calc(100vw-2rem)]', 'overflow-y-auto')
  expect(within(dialog).getByText(url)).toHaveClass('break-all')
  expect(within(dialog).getByText(url)).not.toHaveClass('truncate')

  act(() => {
    client.setQueryData(STATUS_QUERY_KEY, {
      api_info: [
        {
          route: 'Replacement',
          description: 'Updated gateway',
          url: 'https://new.example.com',
          color: 'blue',
        },
      ],
    })
  })
  expect(
    await within(dialog).findByText('https://new.example.com')
  ).toBeVisible()
  expect(within(dialog).queryByText(url)).not.toBeInTheDocument()
  await user.click(
    within(dialog).getByRole('button', {
      name: 'Copy API URL: https://new.example.com',
    })
  )
  expect(await navigator.clipboard.readText()).toBe('https://new.example.com')
})

it.each([
  {
    name: '单消费门槛未达时隐藏',
    used: 9,
    quota: 100,
    minUsed: 10,
    minQuota: 0,
    showInKeys: true,
    visible: false,
  },
  {
    name: '单余额门槛未达时隐藏',
    used: 100,
    quota: 9,
    minUsed: 0,
    minQuota: 10,
    showInKeys: true,
    visible: false,
  },
  {
    name: '双门槛中消费达标即可显示',
    used: 10,
    quota: 0,
    minUsed: 10,
    minQuota: 50,
    showInKeys: true,
    visible: true,
  },
  {
    name: '双门槛中余额达标即可显示',
    used: 0,
    quota: 50,
    minUsed: 10,
    minQuota: 50,
    showInKeys: true,
    visible: true,
  },
  {
    name: '双门槛均未达时隐藏',
    used: 9,
    quota: 49,
    minUsed: 10,
    minQuota: 50,
    showInKeys: true,
    visible: false,
  },
  {
    name: '关闭节点显示时即使额度达标也隐藏',
    used: 100,
    quota: 100,
    minUsed: 10,
    minQuota: 50,
    showInKeys: false,
    visible: false,
  },
])('$name', async ({ used, quota, minUsed, minQuota, showInKeys, visible }) => {
  const user = userEvent.setup()
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'node-user',
    role: 1,
    used_quota: used * DEFAULT_CURRENCY_CONFIG.quotaPerUnit,
    quota: quota * DEFAULT_CURRENCY_CONFIG.quotaPerUnit,
  })
  renderAddresses({
    api_info: [
      { route: 'Public', url: 'https://public.example.com', description: '' },
      {
        route: 'Restricted',
        url: 'https://restricted.example.com',
        description: '',
        show_in_keys: showInKeys,
        min_used_quota_usd: minUsed,
        min_quota_usd: minQuota,
      },
    ],
  })
  await user.click(screen.getByRole('button', { name: 'API Addresses' }))
  const dialog = await screen.findByRole('dialog', { name: 'API Addresses' })
  expect(within(dialog).getByText('Public')).toBeVisible()
  if (visible) {
    expect(within(dialog).getByText('Restricted')).toBeVisible()
  } else {
    expect(within(dialog).queryByText('Restricted')).not.toBeInTheDocument()
    expect(
      within(dialog).queryByText('https://restricted.example.com')
    ).not.toBeInTheDocument()
  }
})

it.each<CurrencyDisplayType>(['CNY', 'TOKENS'])(
  '%s 展示保持按真实美元额度判断节点门槛',
  async (quotaDisplayType) => {
    const user = userEvent.setup()
    useSystemConfigStore.getState().setConfig({
      currency: {
        ...DEFAULT_CURRENCY_CONFIG,
        quotaDisplayType,
        quotaPerUnit: 1000000,
        usdExchangeRate: 7,
      },
    })
    useAuthStore.getState().auth.setUser({
      id: 1,
      username: 'node-user',
      role: 1,
      used_quota: 2000000,
      quota: 2000000,
    })
    renderAddresses({
      api_info: [
        { route: 'Public', url: 'https://public.example.com', description: '' },
        {
          route: 'Restricted',
          url: 'https://restricted.example.com',
          description: '',
          min_used_quota_usd: 10,
          min_quota_usd: 10,
        },
      ],
    })
    await user.click(screen.getByRole('button', { name: 'API Addresses' }))
    const dialog = await screen.findByRole('dialog', { name: 'API Addresses' })
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(1)
    expect(within(dialog).getByText('Public')).toBeVisible()
    expect(within(dialog).queryByText('Restricted')).not.toBeInTheDocument()
  }
)

it('用户余额与后台门槛更新后立即重新计算打开的节点列表', async () => {
  const user = userEvent.setup()
  const account = {
    id: 1,
    username: 'node-user',
    role: 1,
    used_quota: 0,
    quota: DEFAULT_CURRENCY_CONFIG.quotaPerUnit,
  }
  const publicNode = {
    route: 'Public',
    url: 'https://public.example.com',
    description: '',
  }
  const restrictedNode = {
    route: 'Restricted',
    url: 'https://restricted.example.com',
    description: '',
    min_quota_usd: 10,
  }
  useAuthStore.getState().auth.setUser(account)
  renderAddresses({ api_info: [publicNode, restrictedNode] })
  await user.click(screen.getByRole('button', { name: 'API Addresses' }))
  const dialog = await screen.findByRole('dialog', { name: 'API Addresses' })
  expect(within(dialog).queryByText('Restricted')).not.toBeInTheDocument()

  act(() => {
    useAuthStore.getState().auth.setUser({
      ...account,
      quota: 10 * DEFAULT_CURRENCY_CONFIG.quotaPerUnit,
    })
  })
  expect(await within(dialog).findByText('Restricted')).toBeVisible()

  act(() => {
    client.setQueryData(STATUS_QUERY_KEY, {
      api_info: [publicNode, { ...restrictedNode, min_quota_usd: 20 }],
    })
  })
  await waitFor(() =>
    expect(within(dialog).queryByText('Restricted')).not.toBeInTheDocument()
  )

  act(() => {
    useSystemConfigStore.getState().setConfig({
      currency: {
        ...DEFAULT_CURRENCY_CONFIG,
        quotaPerUnit: DEFAULT_CURRENCY_CONFIG.quotaPerUnit / 2,
      },
    })
  })
  expect(await within(dialog).findByText('Restricted')).toBeVisible()
})
