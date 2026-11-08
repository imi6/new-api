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
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import type { Channel } from '../../types'
import { upstreamRateQueryKey } from '../api'
import { UpstreamRateCell, UpstreamRatesProvider } from '../rates-context'
import type { UpstreamRate } from '../types'

const channel = {
  id: 1,
  name: '渠道甲',
  base_url: 'https://upstream.example.com',
} as Channel
const rate: UpstreamRate = {
  channel_id: 1,
  status: 'matched',
  source_id: 'source',
  source_name: '倍率来源',
  upstream_channel_id: 4,
  only_with_keys: true,
  read_at: 1,
  enabled_keys: 1,
  matched_keys: 1,
  refresh_available: true,
  force_refresh_available: true,
  keys: [
    {
      index: 1,
      enabled: true,
      status: 'matched',
      source_id: 'source',
      source_name: '倍率来源',
      upstream_channel_id: 4,
      upstream_channel_name: '上游账号',
      group_name: 'A',
      ratio: 0.0000000123456,
      collected_at: 1,
      key_synced_at: 1,
    },
  ],
}
const originalAuth = useAuthStore.getState().auth

beforeEach(() => {
  useAuthStore.setState({
    auth: {
      ...originalAuth,
      user: { id: 1, username: 'test-admin', role: 100 },
    },
  })
  vi.spyOn(api, 'get').mockImplementation((url) =>
    Promise.resolve({
      data: {
        success: true,
        data: url.endsWith('/config')
          ? { sources: [], encryption_ready: true }
          : [rate],
      },
    } as Awaited<ReturnType<typeof api.get>>)
  )
})
afterEach(() => {
  useAuthStore.setState({ auth: originalAuth })
  vi.restoreAllMocks()
})

function Harness(props: { visible?: boolean; client: QueryClient }) {
  return (
    <QueryClientProvider client={props.client}>
      <UpstreamRatesProvider
        channels={[channel]}
        visible={props.visible ?? true}
      >
        <UpstreamRateCell channel={channel} visible={props.visible ?? true} />
      </UpstreamRatesProvider>
    </QueryClientProvider>
  )
}

test('隐藏敏感信息时不提供详情入口，显示后保留极小倍率精度', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const view = render(<Harness client={client} visible={false} />)
  expect(
    screen.queryByRole('button', { name: /View upstream rates/ })
  ).not.toBeInTheDocument()
  expect(screen.getByText('••••')).toBeVisible()
  view.rerender(<Harness client={client} />)
  expect(await screen.findByText('0.0000000123456')).toBeVisible()
  client.clear()
})

test('强刷必须先确认，取消确认不会向上游提交刷新请求', async () => {
  const user = userEvent.setup()
  const post = vi.spyOn(api, 'post')
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(<Harness client={client} />)
  const cell = await screen.findByRole('button', {
    name: /View upstream rates/,
  })
  cell.focus()
  expect(cell).toHaveFocus()
  await user.keyboard('{Enter}')
  await act(async () => {
    await vi.dynamicImportSettled()
  })
  await user.click(
    await screen.findByRole('button', { name: 'Force refresh upstream' })
  )
  const confirm = await screen.findByRole('alertdialog')
  expect(within(confirm).getByText(/60-second cooldown/)).toBeVisible()
  expect(post).not.toHaveBeenCalled()
  await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
  expect(post).not.toHaveBeenCalled()
  client.clear()
})

test('语言切换后倍率保留有效位，七种界面语言及无效语言均能显示', async () => {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: {} } },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <I18nextProvider i18n={i18n}>
      <Harness client={client} />
    </I18nextProvider>
  )
  await screen.findByRole('button', { name: /View upstream rates/ })
  for (const language of [
    'zhCN',
    'zhTW',
    'en',
    'fr',
    'ja',
    'ru',
    'vi',
    'invalid_locale',
  ]) {
    await act(async () => {
      await i18n.changeLanguage(language)
    })
    const cell = screen.getByRole('button', { name: /View upstream rates/ })
    expect(cell).toHaveTextContent(/^0[.,]0000000123456$/)
  }
  client.clear()
})

test('本地读取失败后列表仅显示占位，历史倍率与错误保留在详情', async () => {
  const user = userEvent.setup()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(<Harness client={client} />)
  await screen.findByText('0.0000000123456')
  vi.mocked(api.get).mockRejectedValue(new Error('offline'))
  await act(async () => {
    await client.refetchQueries({ queryKey: upstreamRateQueryKey })
  })
  const cell = screen.getByRole('button', { name: /View upstream rates/ })
  expect(await within(cell).findByText('—')).toBeVisible()
  expect(cell).toHaveTextContent(/^—$/)
  await user.click(cell)
  await act(async () => {
    await vi.dynamicImportSettled()
  })
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('Historical value')).toBeVisible()
  expect(
    within(dialog).getAllByText('Upstream snapshot read failed').length
  ).toBeGreaterThan(0)
  expect(within(dialog).getByText('A · 0.0000000123456')).toBeVisible()
  client.clear()
})

test('仅有读取权限时不能更新或强刷上游', async () => {
  useAuthStore.setState({
    auth: {
      ...originalAuth,
      user: {
        id: 1,
        username: 'test-reader',
        role: 10,
        permissions: { admin_permissions: { channel: { read: true } } },
      },
    },
  })
  const user = userEvent.setup()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(<Harness client={client} />)
  await user.click(
    await screen.findByRole('button', { name: /View upstream rates/ })
  )
  await act(async () => {
    await vi.dynamicImportSettled()
  })
  expect(
    await screen.findByRole('button', { name: 'Force refresh upstream' })
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Update display' })).toBeDisabled()
  client.clear()
})

test('自动匹配详情显示上游归属且无需逐渠道配置', async () => {
  const user = userEvent.setup()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(<Harness client={client} />)
  await user.click(
    await screen.findByRole('button', { name: /View upstream rates/ })
  )
  await act(async () => {
    await vi.dynamicImportSettled()
  })
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText(/倍率来源 \/ #4 上游账号/)).toBeVisible()
  expect(within(dialog).getByText('Groups with keys only: Yes')).toBeVisible()
  expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()
  expect(
    within(dialog).queryByRole('button', { name: 'Save upstream binding' })
  ).not.toBeInTheDocument()
  client.clear()
})

test('旧接口返回部分同步且 Key 未命中时列表仅显示占位，详情显示未同步', async () => {
  const unmatched: UpstreamRate = {
    channel_id: 1,
    status: 'partial',
    only_with_keys: true,
    read_at: 0,
    enabled_keys: 1,
    matched_keys: 0,
    refresh_available: true,
    force_refresh_available: false,
    keys: [
      {
        index: 1,
        enabled: true,
        status: 'partial',
        collected_at: 0,
        key_synced_at: 0,
      },
    ],
  }
  vi.mocked(api.get).mockResolvedValue({
    data: { success: true, data: [unmatched] },
  } as Awaited<ReturnType<typeof api.get>>)
  const user = userEvent.setup()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(<Harness client={client} />)
  const cell = await screen.findByRole('button', {
    name: /View upstream rates/,
  })
  expect(cell).toHaveTextContent(/^—$/)
  await user.click(cell)
  await act(async () => {
    await vi.dynamicImportSettled()
  })
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getAllByText('Not yet synchronized')).toHaveLength(2)
  expect(
    within(dialog).queryByText('Partial upstream synchronization')
  ).not.toBeInTheDocument()
  expect(within(dialog).getByText('Enabled key coverage: 0/1')).toBeVisible()
  expect(
    within(dialog).getByText('Groups with keys only: Unknown')
  ).toBeVisible()
  expect(within(dialog).getByText('— · —')).toBeVisible()
  client.clear()
})

test('其他上游不完整但当前 Key 已命中时列表仅显示倍率，详情显示已命中', async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      success: true,
      data: [
        {
          ...rate,
          status: 'partial',
          keys: [{ ...rate.keys[0], ratio: 1.9 }],
        },
      ],
    },
  } as Awaited<ReturnType<typeof api.get>>)
  const user = userEvent.setup()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(<Harness client={client} />)
  const cell = await screen.findByRole('button', {
    name: /View upstream rates/,
  })
  expect(cell).toHaveTextContent(/^1\.9$/)
  await user.click(cell)
  await act(async () => {
    await vi.dynamicImportSettled()
  })
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getAllByText('Matched')).toHaveLength(2)
  expect(within(dialog).getByText('A · 1.9')).toBeVisible()
  expect(
    within(dialog).queryByText('Partial upstream synchronization')
  ).not.toBeInTheDocument()
  client.clear()
})

test('多个 Key 的倍率不同时列表仅显示当前倍率范围', async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      success: true,
      data: [
        {
          ...rate,
          enabled_keys: 2,
          matched_keys: 2,
          keys: [
            {
              ...rate.keys[0],
              ratio: 0.1,
              change: { from: 0.08, to: 0.1, at: 1 },
              moved_from: 'C',
              moved_at: 1,
            },
            { ...rate.keys[0], index: 2, group_name: 'B', ratio: 0.2 },
          ],
        },
      ],
    },
  } as Awaited<ReturnType<typeof api.get>>)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(<Harness client={client} />)
  const cell = await screen.findByRole('button', {
    name: /View upstream rates/,
  })
  expect(cell).toHaveTextContent(/^0\.1–0\.2$/)
  client.clear()
})

test('多上游归属时仍可更新展示，但不允许任意选择一个账号强刷', async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      success: true,
      data: [{ ...rate, force_refresh_available: false }],
    },
  } as Awaited<ReturnType<typeof api.get>>)
  const user = userEvent.setup()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(<Harness client={client} />)
  await user.click(
    await screen.findByRole('button', { name: /View upstream rates/ })
  )
  await act(async () => {
    await vi.dynamicImportSettled()
  })
  expect(screen.getByRole('button', { name: 'Update display' })).toBeEnabled()
  const force = screen.getByRole('button', { name: 'Force refresh upstream' })
  expect(force).toBeDisabled()
  expect(force).toHaveAttribute(
    'title',
    'Force refresh requires a uniquely identified upstream account channel.'
  )
  client.clear()
})
