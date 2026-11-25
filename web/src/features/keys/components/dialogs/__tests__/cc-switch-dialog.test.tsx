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
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { CCSwitchDialog } from '../cc-switch-dialog'

let queryClient: QueryClient

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  queryClient.setQueryData(STATUS_QUERY_KEY, {
    server_address: 'https://console.example.com',
    api_info: [
      { route: 'Global', url: 'https://global.example.com', description: '' },
      {
        route: 'Regional',
        url: 'https://regional.example.com/gateway/v1/',
        description: 'Regional gateway',
      },
    ],
  })
})

afterEach(() => {
  queryClient.clear()
})

function renderDialog(models = ['gpt-5.4', 'claude-sonnet-4-6']) {
  queryClient.setQueryData(['user-models-ccswitch'], {
    success: true,
    data: models,
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <CCSwitchDialog open onOpenChange={vi.fn()} tokenKey='test-only' />
    </QueryClientProvider>
  )
}

describe('CC Switch model selection', () => {
  it.each(['Claude', 'Codex', 'Gemini'])(
    'opens %s models outside the clipping dialog and keeps the dialog open after selection',
    async (app) => {
      renderDialog()
      const user = userEvent.setup()
      await user.click(screen.getByRole('radio', { name: app }))
      const input = screen.getByRole('combobox', { name: 'Primary Model' })

      await user.click(input)

      expect(input).toHaveAttribute('aria-expanded', 'true')
      const list = await screen.findByRole('listbox')
      const dialog = screen.getByRole('dialog', { name: 'Import to CC Switch' })
      // The dialog is translated and clips overflow. Its popup must escape
      // that containing block to remain aligned and fully visible.
      expect(dialog).not.toContainElement(list)
      await user.click(screen.getByRole('option', { name: 'gpt-5.4' }))
      await waitFor(() => expect(input).toHaveValue('gpt-5.4'))
      expect(input).toHaveAttribute('aria-expanded', 'false')
      expect(dialog).toBeVisible()
    }
  )

  it('filters model names and supports keyboard selection and Escape without closing the dialog', async () => {
    renderDialog()
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: 'Codex' }))
    const input = screen.getByRole('combobox', { name: 'Primary Model' })
    await user.click(input)
    await user.type(input, 'sonnet')

    expect(
      screen.queryByRole('option', { name: 'gpt-5.4' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'claude-sonnet-4-6' })
    ).toBeVisible()
    await user.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(input).toHaveValue('claude-sonnet-4-6'))
    await user.click(input)
    await user.keyboard('{Escape}')

    expect(input).toHaveValue('claude-sonnet-4-6')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('dialog')).toBeVisible()
  })

  it('shows an empty result when no models are available and updates an open dropdown when models arrive', async () => {
    renderDialog([])
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: 'Codex' }))
    const input = screen.getByRole('combobox', { name: 'Primary Model' })
    await user.click(screen.getByRole('button', { name: 'Primary Model' }))

    expect(await screen.findByText('No models found')).toBeVisible()
    await act(async () => {
      queryClient.setQueryData(['user-models-ccswitch'], {
        success: true,
        data: ['gpt-5.4'],
      })
    })
    await user.click(await screen.findByRole('option', { name: 'gpt-5.4' }))
    await waitFor(() => expect(input).toHaveValue('gpt-5.4'))
  })

  it('lets users edit the provider name without opening a model dropdown', async () => {
    renderDialog()
    const user = userEvent.setup()
    const input = screen.getByRole('textbox', { name: 'Name' })

    await user.clear(input)
    await user.type(input, 'Development')

    expect(input).toHaveValue('Development')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

describe('CC Switch API 节点选择', () => {
  it.each([
    {
      app: 'Codex',
      node: 'https://regional.example.com/',
      endpoint: 'https://regional.example.com/v1',
    },
    {
      app: 'Claude',
      node: 'https://regional.example.com/gateway/v1/',
      endpoint: 'https://regional.example.com/gateway/v1',
    },
    {
      app: 'Codex',
      node: 'https://regional.example.com/gateway/',
      endpoint: 'https://regional.example.com/gateway/v1',
    },
    {
      app: 'Codex',
      node: 'https://regional.example.com/gateway/v1/',
      endpoint: 'https://regional.example.com/gateway/v1',
    },
    {
      app: 'Codex',
      node: 'https://regional.example.com/gateway/?route=blue',
      endpoint: 'https://regional.example.com/gateway/v1?route=blue',
    },
    {
      app: 'Codex',
      node: 'https://regional.example.com/gateway/?route=blue/',
      endpoint: 'https://regional.example.com/gateway/v1?route=blue/',
    },
    {
      app: 'Gemini',
      node: 'https://regional.example.com/gateway/v1beta/',
      endpoint: 'https://regional.example.com/gateway/v1beta',
    },
  ])(
    '$app 导入选择的节点并正确处理路径：$node',
    async ({ app, node, endpoint }) => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null)
      const user = userEvent.setup()
      queryClient.setQueryData(STATUS_QUERY_KEY, {
        server_address: 'https://console.example.com',
        api_info: [
          {
            route: 'Global',
            url: 'https://global.example.com',
            description: '',
          },
          { route: 'Regional', url: node, description: 'Regional gateway' },
        ],
      })
      renderDialog()

      await user.click(screen.getByRole('combobox', { name: /API node/i }))
      await user.click(screen.getByRole('option', { name: /Regional/ }))
      await user.click(screen.getByRole('radio', { name: app }))
      await user.click(screen.getByRole('combobox', { name: 'Primary Model' }))
      await user.click(screen.getByRole('option', { name: 'gpt-5.4' }))
      await user.click(screen.getByRole('button', { name: 'Open CC Switch' }))

      expect(open).toHaveBeenCalledTimes(1)
      const imported = new URL(String(open.mock.calls[0][0]))
      expect(imported.protocol).toBe('ccswitch:')
      expect(imported.searchParams.get('app')).toBe(app.toLowerCase())
      expect(imported.searchParams.get('endpoint')).toBe(endpoint)
      expect(imported.searchParams.get('homepage')).toBe(
        'https://console.example.com'
      )
      expect(imported.searchParams.get('apiKey')).toBe('sk-test-only')
      expect(imported.searchParams.get('model')).toBe('gpt-5.4')
    }
  )

  it('选中节点下线时立即回退到当前可见节点', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('combobox', { name: /API node/i }))
    await user.click(screen.getByRole('option', { name: /Regional/ }))
    await user.click(screen.getByRole('combobox', { name: 'Primary Model' }))
    await user.click(screen.getByRole('option', { name: 'gpt-5.4' }))

    await act(async () => {
      queryClient.setQueryData(STATUS_QUERY_KEY, {
        server_address: 'https://console.example.com',
        api_info: [
          {
            route: 'Replacement',
            url: 'https://replacement.example.com/proxy',
            description: '',
          },
        ],
      })
    })
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: /API node/i })
      ).toHaveTextContent('Replacement')
    )
    await user.click(screen.getByRole('button', { name: 'Open CC Switch' }))
    const imported = new URL(String(open.mock.calls[0][0]))
    expect(imported.searchParams.get('endpoint')).toBe(
      'https://replacement.example.com/proxy'
    )
  })

  it('重新打开弹窗后恢复默认节点和模型', async () => {
    const user = userEvent.setup()
    const view = renderDialog()
    await user.click(screen.getByRole('combobox', { name: /API node/i }))
    await user.click(screen.getByRole('option', { name: /Regional/ }))
    await user.click(screen.getByRole('radio', { name: 'Codex' }))
    await user.click(screen.getByRole('combobox', { name: 'Primary Model' }))
    await user.click(screen.getByRole('option', { name: 'gpt-5.4' }))

    view.rerender(
      <QueryClientProvider client={queryClient}>
        <CCSwitchDialog
          open={false}
          onOpenChange={vi.fn()}
          tokenKey='test-only'
        />
      </QueryClientProvider>
    )
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <CCSwitchDialog open onOpenChange={vi.fn()} tokenKey='test-only' />
      </QueryClientProvider>
    )
    await waitFor(() => {
      expect(
        screen.getByRole('combobox', { name: /API node/i })
      ).toHaveTextContent('Global')
      expect(screen.getByRole('radio', { name: 'Claude' })).toBeChecked()
      expect(
        screen.getByRole('combobox', { name: 'Primary Model' })
      ).toHaveValue('')
    })
  })

  it('未选择主模型时保留弹窗并阻止导入', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const warning = vi.spyOn(toast, 'warning')
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Open CC Switch' }))
    expect(warning).toHaveBeenCalledWith('Please select a primary model')
    expect(open).not.toHaveBeenCalled()
    expect(
      screen.getByRole('dialog', { name: 'Import to CC Switch' })
    ).toBeVisible()
  })
})
