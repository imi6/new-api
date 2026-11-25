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
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { CHANNEL_CONNECTION_INFO_TYPE } from '@/lib/channel-connection-info'
import { STATUS_QUERY_KEY, type StatusData } from '@/lib/status-query'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import * as api from '../../../api'
import { apiKeySchema } from '../../../types'
import { ApiKeysProvider, useApiKeys } from '../../api-keys-provider'
import { DataTableRowActions } from '../../data-table-row-actions'
import { IntelligenceTestProvider } from '../../intelligence-test-provider'
import { CopyConnectionDialog } from '../copy-connection-dialog'

let client: QueryClient
const status: StatusData = {
  server_address: 'https://console.example.com',
  api_info: [
    {
      route: 'Global',
      url: 'https://global.example.com',
      description: 'Global API',
    },
    {
      route: 'Regional',
      url: 'https://regional.example.com/gateway/v1/',
      description: 'Regional API',
    },
    {
      route: 'Hidden',
      url: 'https://hidden.example.com',
      description: '',
      show_in_keys: false,
    },
  ],
}

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

function renderDialog(data: StatusData = status, tokenKey = 'sk-complete-key') {
  client.setQueryData(STATUS_QUERY_KEY, data)
  return render(
    <QueryClientProvider client={client}>
      <CopyConnectionDialog open onOpenChange={vi.fn()} tokenKey={tokenKey} />
    </QueryClientProvider>
  )
}

it('选择节点后才复制完整连接信息，保持配置路径且不在页面展示密钥', async () => {
  const user = userEvent.setup()
  const write = vi.spyOn(navigator.clipboard, 'writeText')
  renderDialog()

  expect(
    screen.getByRole('dialog', { name: 'Copy Connection Info' })
  ).toBeVisible()
  expect(write).not.toHaveBeenCalled()
  expect(screen.queryByText('sk-complete-key')).not.toBeInTheDocument()
  await user.click(screen.getByRole('combobox', { name: 'API Node' }))
  expect(
    screen.queryByRole('option', { name: /Hidden/ })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('option', { name: /Regional/ }))
  await user.click(screen.getByRole('button', { name: 'Copy Connection Info' }))

  expect(write).toHaveBeenCalledWith(
    JSON.stringify({
      _type: CHANNEL_CONNECTION_INFO_TYPE,
      key: 'sk-complete-key',
      url: 'https://regional.example.com/gateway/v1/',
    })
  )
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeVisible()
})

it.each([
  {
    data: {
      api_info: [],
      server_address: 'https://default.example.com/proxy/',
    },
    url: 'https://default.example.com/proxy/',
  },
  { data: { api_info: [] }, url: window.location.origin },
])('没有配置节点时复制可用的默认地址：$url', async ({ data, url }) => {
  const user = userEvent.setup()
  const write = vi.spyOn(navigator.clipboard, 'writeText')
  renderDialog(data)
  await user.click(screen.getByRole('button', { name: 'Copy Connection Info' }))
  expect(write).toHaveBeenCalledWith(
    JSON.stringify({
      _type: CHANNEL_CONNECTION_INFO_TYPE,
      key: 'sk-complete-key',
      url,
    })
  )
})

it('节点配置发生变化后不再复制已经失效的地址', async () => {
  const user = userEvent.setup()
  const write = vi.spyOn(navigator.clipboard, 'writeText')
  renderDialog()
  await user.click(screen.getByRole('combobox', { name: 'API Node' }))
  await user.click(screen.getByRole('option', { name: /Regional/ }))
  await act(async () => {
    client.setQueryData(STATUS_QUERY_KEY, {
      api_info: [
        { route: 'New node', url: 'https://new.example.com', description: '' },
      ],
    })
  })
  await waitFor(() =>
    expect(
      screen.getByRole('combobox', { name: 'API Node' })
    ).toHaveTextContent('New node')
  )
  await user.click(screen.getByRole('button', { name: 'Copy Connection Info' }))
  expect(write).toHaveBeenCalledWith(
    JSON.stringify({
      _type: CHANNEL_CONNECTION_INFO_TYPE,
      key: 'sk-complete-key',
      url: 'https://new.example.com',
    })
  )
})

it('未取得完整密钥时禁用复制按钮', () => {
  renderDialog(status, '')
  expect(
    screen.getByRole('button', { name: 'Copy Connection Info' })
  ).toBeDisabled()
})

const developmentKey = apiKeySchema.parse({
  id: 42,
  name: 'Development',
  key: 'masked-key',
  status: 1,
  remain_quota: 0,
  used_quota: 0,
  unlimited_quota: true,
  expired_time: -1,
  created_time: 0,
  accessed_time: 0,
  model_limits_enabled: false,
})
const singleRowData = [developmentKey]
const multipleRowData = [
  developmentKey,
  { ...developmentKey, id: 43, name: 'Second' },
]
const rowActionColumns = [{ accessorKey: 'name' }]

function RowActionsFixture(props: { multiple?: boolean }) {
  const context = useApiKeys()
  const table = useReactTable({
    data: props.multiple ? multipleRowData : singleRowData,
    columns: rowActionColumns,
    getCoreRowModel: getCoreRowModel(),
  })
  return (
    <>
      {table.getRowModel().rows.map((row) => (
        <div key={row.id} role='group' aria-label={row.original.name}>
          <DataTableRowActions row={row} />
        </div>
      ))}
      {context.open === 'update' && <p>Editing {context.currentRow?.name}</p>}
      {context.open === 'copy-connection' && (
        <CopyConnectionDialog
          open
          tokenKey={context.resolvedKey}
          onOpenChange={(open) => !open && context.setOpen(null)}
        />
      )}
    </>
  )
}

it('点击行菜单先打开节点弹窗，确认复制时使用取得的完整密钥', async () => {
  const user = userEvent.setup()
  const write = vi.spyOn(navigator.clipboard, 'writeText')
  const fetchKey = vi.spyOn(api, 'fetchTokenKey').mockResolvedValue({
    success: true,
    data: { key: 'resolved-complete-key' },
  })
  client.setQueryData(STATUS_QUERY_KEY, status)
  render(
    <QueryClientProvider client={client}>
      <IntelligenceTestProvider>
        <ApiKeysProvider>
          <RowActionsFixture />
        </ApiKeysProvider>
      </IntelligenceTestProvider>
    </QueryClientProvider>
  )
  await user.click(screen.getByRole('button', { name: 'Open menu' }))
  await user.click(
    screen.getByRole('menuitem', { name: 'Copy Connection Info' })
  )
  const dialog = await screen.findByRole('dialog', {
    name: 'Copy Connection Info',
  })
  expect(fetchKey).toHaveBeenCalledWith(42)
  expect(write).not.toHaveBeenCalled()
  await user.click(
    within(dialog).getByRole('button', { name: 'Copy Connection Info' })
  )
  expect(write).toHaveBeenCalledWith(
    JSON.stringify({
      _type: CHANNEL_CONNECTION_INFO_TYPE,
      key: 'sk-resolved-complete-key',
      url: 'https://global.example.com',
    })
  )
})

it.each(['copy', 'edit'])(
  '较早的密钥慢响应不能覆盖后续 %s 操作',
  async (action) => {
    const user = userEvent.setup()
    const write = vi.spyOn(navigator.clipboard, 'writeText')
    let resolveFirst!: (
      value: Awaited<ReturnType<typeof api.fetchTokenKey>>
    ) => void
    const first = new Promise<Awaited<ReturnType<typeof api.fetchTokenKey>>>(
      (resolve) => {
        resolveFirst = resolve
      }
    )
    vi.spyOn(api, 'fetchTokenKey').mockImplementation((id) =>
      id === 42
        ? first
        : Promise.resolve({ success: true, data: { key: 'second-key' } })
    )
    client.setQueryData(STATUS_QUERY_KEY, status)
    render(
      <QueryClientProvider client={client}>
        <IntelligenceTestProvider>
          <ApiKeysProvider>
            <RowActionsFixture multiple />
          </ApiKeysProvider>
        </IntelligenceTestProvider>
      </QueryClientProvider>
    )
    await user.click(
      within(screen.getByRole('group', { name: 'Development' })).getByRole(
        'button',
        { name: 'Open menu' }
      )
    )
    await user.click(
      screen.getByRole('menuitem', { name: 'Copy Connection Info' })
    )
    const secondActions = within(screen.getByRole('group', { name: 'Second' }))
    if (action === 'copy') {
      await user.click(secondActions.getByRole('button', { name: 'Open menu' }))
      await user.click(
        screen.getByRole('menuitem', { name: 'Copy Connection Info' })
      )
      await screen.findByRole('dialog', { name: 'Copy Connection Info' })
    } else {
      await user.click(secondActions.getByRole('button', { name: 'Edit' }))
      expect(screen.getByText('Editing Second')).toBeVisible()
    }

    await act(async () => {
      resolveFirst({ success: true, data: { key: 'first-key' } })
      await first
    })
    if (action === 'copy') {
      await user.click(
        screen.getByRole('button', { name: 'Copy Connection Info' })
      )
      expect(write).toHaveBeenCalledWith(
        JSON.stringify({
          _type: CHANNEL_CONNECTION_INFO_TYPE,
          key: 'sk-second-key',
          url: 'https://global.example.com',
        })
      )
    } else {
      expect(screen.getByText('Editing Second')).toBeVisible()
      expect(
        screen.queryByRole('dialog', { name: 'Copy Connection Info' })
      ).not.toBeInTheDocument()
      expect(write).not.toHaveBeenCalled()
    }
  }
)
