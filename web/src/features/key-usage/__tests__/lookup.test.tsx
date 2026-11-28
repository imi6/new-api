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
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { KeyUsageResult } from '../api'
import { KeyUsageLookup } from '../components/key-usage-lookup'

const apiKey = 'sk-exampleKeyForUnitTests'
const endTimestamp = 1_770_000_000
const startTimestamp = endTimestamp - 3600

function usageResponse(page = 1): Response {
  const data: KeyUsageResult = {
    token: {
      total_granted: 500_000,
      total_used: 5_000,
      total_available: 495_000,
      unlimited_quota: false,
      expires_at: 0,
      status: 1,
    },
    items: [
      {
        created_at: endTimestamp - page,
        model_name: `model-on-page-${page}`,
        prompt_tokens: 100,
        completion_tokens: 20,
        quota: 5_000,
        type: 2,
      },
    ],
    total: 10_000,
    total_is_capped: true,
    p: page,
    page_size: 20,
    export_enabled: false,
    max_range_days: 7,
    start_timestamp: startTimestamp,
    end_timestamp: endTimestamp,
    consume_log_enabled: false,
  }
  return Response.json({ success: true, data })
}

afterEach(() => vi.unstubAllGlobals())

describe('公开密钥用量查询', () => {
  it('仅在提交后通过同源 Authorization 请求，分页沿用生效的日期', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(usageResponse())
      .mockResolvedValueOnce(usageResponse(2))
    vi.stubGlobal('fetch', fetchMock)
    render(<KeyUsageLookup />)

    const input = screen.getByLabelText('API Key')
    expect(input).toHaveAttribute('type', 'password')
    fireEvent.change(input, { target: { value: apiKey } })
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('model-on-page-1')).toBeVisible()
    expect(screen.getByText('New consumption logs are disabled')).toBeVisible()
    expect(screen.getByText(/Only the latest 10000 records/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/key-usage/?p=1&page_size=20')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      cache: 'no-store',
      credentials: 'omit',
      mode: 'same-origin',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    })
    expect(
      new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')
    ).toBe(`Bearer ${apiKey}`)

    fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }))
    expect(await screen.findByText('model-on-page-2')).toBeVisible()
    expect(fetchMock.mock.calls[1][0]).toBe(
      `/api/key-usage/?start_timestamp=${startTimestamp}&end_timestamp=${endTimestamp}&p=2&page_size=20`
    )
  })

  it('更换密钥后中止请求，旧响应到达时保持结果为空', async () => {
    let completeRequest!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => {
      completeRequest = resolve
    })
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(pending)
    vi.stubGlobal('fetch', fetchMock)
    render(<KeyUsageLookup />)

    const input = screen.getByLabelText('API Key')
    fireEvent.change(input, { target: { value: apiKey } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const request = fetchMock.mock.calls[0][1]

    fireEvent.change(input, { target: { value: 'sk-anotherExampleKey' } })
    expect(request?.signal?.aborted).toBe(true)
    await act(async () => completeRequest(usageResponse()))
    expect(screen.queryByText('model-on-page-1')).toBeNull()
    expect(screen.queryByText('Key information')).toBeNull()
    expect(input).toHaveValue('sk-anotherExampleKey')
  })

  it('查询权限撤销和页面离开时清除已查询的数据', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(usageResponse())
      .mockResolvedValueOnce(
        Response.json(
          { success: false, message_key: 'API key is invalid or unavailable' },
          { status: 401 }
        )
      )
      .mockResolvedValueOnce(usageResponse())
    vi.stubGlobal('fetch', fetchMock)
    render(<KeyUsageLookup />)

    const input = screen.getByLabelText('API Key')
    const query = screen.getByRole('button', { name: 'Search' })
    fireEvent.change(input, { target: { value: apiKey } })
    fireEvent.click(query)
    expect(await screen.findByText('model-on-page-1')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }))
    expect(
      await screen.findByText('API key is invalid or unavailable')
    ).toBeVisible()
    expect(screen.queryByText('Key information')).toBeNull()

    fireEvent.click(query)
    expect(await screen.findByText('model-on-page-1')).toBeVisible()
    fireEvent(window, new Event('pagehide'))
    expect(input).toHaveValue('')
    expect(screen.queryByText('Key information')).toBeNull()
  })
})
