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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { UpstreamRateSourceForm } from '../source-form'
import type { UpstreamRateSource } from '../types'

afterEach(() => vi.restoreAllMocks())

test('修改来源地址而未输入新令牌时阻止保存，避免将原令牌发往新站点', async () => {
  const source: UpstreamRateSource = {
    id: 'saved-source',
    name: '来源甲',
    base_url: 'https://rates.example.com',
    enabled: true,
    token_configured: true,
    poll_seconds: 60,
    scan_minutes: 30,
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
