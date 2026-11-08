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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { UpstreamRateSourceForm } from '../source-form'
import type { UpstreamRateSource } from '../types'

afterEach(() => vi.restoreAllMocks())

test('未配置环境密钥时仍可填写并保存来源令牌', async () => {
  const user = userEvent.setup()
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: { success: true, data: null },
  })
  const onDone = vi.fn()
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <UpstreamRateSourceForm onDone={onDone} encryptionReady={false} />
    </QueryClientProvider>
  )
  const save = screen.getByRole('button', { name: 'Save' })
  expect(save).toBeEnabled()
  expect(
    screen.queryByText(
      'Set CRYPTO_SECRET or SESSION_SECRET before saving upstream rate credentials'
    )
  ).not.toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: 'Name' }), '来源甲')
  await user.type(
    screen.getByRole('textbox', { name: 'Upstream rate source URL' }),
    'https://rates.example.com'
  )
  const token = 'test-only-external-token-0123456789'
  await user.type(screen.getByLabelText('External API token'), token)
  expect(screen.getAllByRole('spinbutton')).toHaveLength(1)
  expect(
    screen.queryByLabelText('Upstream scan interval (minutes)')
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText(
      'Set the scan interval to match UpstreamOps. Expiry is twice this interval plus five minutes; this does not change its scan schedule.'
    )
  ).not.toBeInTheDocument()
  const interval = screen.getByRole('spinbutton', {
    name: 'Snapshot read interval (seconds)',
  })
  await user.clear(interval)
  await user.type(interval, '300')
  await user.click(save)
  await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
  expect(put).toHaveBeenCalledWith('/api/channel/upstream_rates/sources', {
    id: '',
    name: '来源甲',
    base_url: 'https://rates.example.com',
    token,
    enabled: true,
    poll_seconds: 300,
  })
  client.clear()
})

test('修改来源地址而未输入新令牌时阻止保存，避免将原令牌发往新站点', async () => {
  const source: UpstreamRateSource = {
    id: 'saved-source',
    name: '来源甲',
    base_url: 'https://rates.example.com',
    enabled: true,
    token_configured: true,
    poll_seconds: 60,
    read_at: 0,
    error: '',
    complete: false,
  }
  const user = userEvent.setup()
  const put = vi.spyOn(api, 'put')
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <UpstreamRateSourceForm
        source={source}
        onDone={vi.fn()}
        encryptionReady
      />
    </QueryClientProvider>
  )
  const url = screen.getByRole('textbox', { name: 'Upstream rate source URL' })
  await user.clear(url)
  await user.type(url, 'https://different.example.com')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(
    await screen.findByText('Enter a new token when changing the source URL.')
  ).toBeVisible()
  expect(screen.getByLabelText('External API token')).toHaveAttribute(
    'aria-invalid',
    'true'
  )
  expect(put).not.toHaveBeenCalled()
  client.clear()
})
