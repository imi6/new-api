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
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { UserGroupHealthData } from '@/features/group-health/types'

const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')
const { api } = await import('@/lib/api')
const { createAppQueryClient } = await import('@/lib/query-client')
const { useAuthStore } = await import('@/stores/auth-store')
const { ApiKeysProvider } = await import('../api-keys-provider')
const { ApiKeyCreateDialog } = await import('../api-key-create-dialog')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

type ApiMethod = (url: string, data?: unknown) => Promise<{ data: unknown }>
type MockableApi = { get: ApiMethod; post: ApiMethod }

const apiClient = api as unknown as MockableApi
const originalPost = apiClient.post
const originalGet = apiClient.get
const originalAuth = useAuthStore.getState().auth
let queryClient: InstanceType<typeof QueryClient> | null = null

const healthSnapshot: UserGroupHealthData = {
  updated_at: 1_800_000_000,
  groups: [
    {
      name: 'default',
      status: 'ok',
      total: {
        start: 1_799_913_600,
        success_rate: 98.5,
        has_data: true,
        avg_latency_ms: 820,
        latency_source: 'ttft',
        cache_hit_rate: -1,
      },
      bars: [],
    },
    {
      name: 'vip',
      status: 'down',
      total: {
        start: 1_799_913_600,
        success_rate: 25,
        has_data: true,
        avg_latency_ms: 1_250,
        latency_source: 'probe',
        cache_hit_rate: -1,
      },
      bars: [],
    },
  ],
}

function renderCreateDialog(
  createdPayloads: Array<Record<string, unknown>>,
  healthReply = async (): Promise<unknown> => ({
    success: true,
    data: healthSnapshot,
  }),
  onInternalServerError = vi.fn()
) {
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'health-user',
    role: 1,
    group: 'default',
  })
  const healthRequests = vi.fn(healthReply)
  apiClient.get = async (url) => {
    if (url === '/api/user/self/group-health') {
      return { data: await healthRequests() }
    }
    throw new Error(`Unexpected GET request: ${url}`)
  }
  apiClient.post = async (url, data) => {
    expect(url).toBe('/api/token/')
    createdPayloads.push(data as Record<string, unknown>)
    return { data: { success: true, data: {} } }
  }

  queryClient = createAppQueryClient(onInternalServerError)
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  })
  const freshAt = Date.now() + 60_000
  queryClient.setQueryData(
    ['user-models'],
    { success: true, data: [] },
    { updatedAt: freshAt }
  )
  queryClient.setQueryData(
    ['user-groups'],
    {
      success: true,
      data: {
        auto: { desc: 'Automatic routing', ratio: 'auto' },
        default: { desc: 'Standard access', ratio: 1 },
        vip: { desc: 'Priority access', ratio: 2 },
      },
    },
    { updatedAt: freshAt }
  )
  queryClient.setQueryData(
    ['token-auto-groups'],
    { success: true, data: { groups: ['vip', 'default'], max_count: 3 } },
    { updatedAt: freshAt }
  )

  render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <ApiKeysProvider>
          <ApiKeyCreateDialog open onOpenChange={() => undefined} />
        </ApiKeysProvider>
      </I18nextProvider>
    </QueryClientProvider>
  )
  return healthRequests
}

function clickGroup(description: string): void {
  const groupButton = screen
    .getAllByRole('button')
    .find((candidate) => candidate.textContent?.includes(description))
  if (!groupButton) {
    throw new Error(`Expected group button containing "${description}"`)
  }
  fireEvent.click(groupButton)
}

afterEach(() => {
  apiClient.post = originalPost
  apiClient.get = originalGet
  queryClient?.clear()
  queryClient = null
  useAuthStore.setState({ auth: originalAuth })
})

describe('API key create dialog group health', () => {
  test('follows the selected group, labels probe latency correctly and creates the selected primary group', async () => {
    const createdPayloads: Array<Record<string, unknown>> = []
    const healthRequests = renderCreateDialog(createdPayloads)
    expect(healthRequests).not.toHaveBeenCalled()

    clickGroup('Standard access')
    const summary = screen.getByRole('region', { name: 'Current group status' })
    expect(await within(summary).findByText('98.50%')).toBeInTheDocument()
    expect(within(summary).getByText('Healthy')).toBeInTheDocument()
    expect(within(summary).getByText('Time to first token')).toBeInTheDocument()
    expect(within(summary).getByText('820ms')).toBeInTheDocument()

    clickGroup('Priority access')
    expect(within(summary).getByText('25.00%')).toBeInTheDocument()
    expect(within(summary).getByText('Abnormal')).toBeInTheDocument()
    expect(within(summary).getByText('Check latency')).toBeInTheDocument()
    expect(within(summary).getByText('1.25s')).toBeInTheDocument()
    expect(within(summary).queryByText('Time to first token')).toBeNull()
    expect(healthRequests).toHaveBeenCalledTimes(1)

    fireEvent.input(screen.getByPlaceholderText('For example: My app'), {
      target: { value: 'primary-vip' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Set as primary channel' })
    )
    await waitFor(() => expect(createdPayloads).toHaveLength(1))
    expect(createdPayloads[0]?.group).toBe('vip')
    expect(createdPayloads[0]?.auto_groups).toEqual([])
  })

  test.each([
    [
      'missing group',
      async () => ({
        success: true,
        data: { updated_at: 1_800_000_000, groups: [] },
      }),
    ],
    [
      'failed request',
      async () => {
        throw Object.assign(new Error('Health service unavailable'), {
          response: { status: 500 },
        })
      },
    ],
  ])(
    'shows no data and still creates a key after a %s',
    async (_case, healthReply) => {
      const createdPayloads: Array<Record<string, unknown>> = []
      const onInternalServerError = vi.fn()
      renderCreateDialog(createdPayloads, healthReply, onInternalServerError)
      clickGroup('Priority access')
      const summary = screen.getByRole('region', {
        name: 'Current group status',
      })
      expect(await within(summary).findByText('No data')).toBeInTheDocument()
      expect(within(summary).queryByText('Abnormal')).toBeNull()
      expect(within(summary).queryByText('0.00%')).toBeNull()
      expect(within(summary).getAllByText('—').length).toBeGreaterThanOrEqual(2)

      fireEvent.input(screen.getByPlaceholderText('For example: My app'), {
        target: { value: 'without-health-data' },
      })
      fireEvent.click(
        screen.getByRole('button', { name: 'Set as primary channel' })
      )
      await waitFor(() => expect(createdPayloads).toHaveLength(1))
      expect(createdPayloads[0]?.group).toBe('vip')
      expect(onInternalServerError).not.toHaveBeenCalled()
    }
  )

  test('does not load a combined status for smart routing and reuses the primary summary after switching back', async () => {
    const healthRequests = renderCreateDialog([])
    fireEvent.click(screen.getByRole('tab', { name: 'Smart routing' }))
    clickGroup('Priority access')
    expect(
      screen.queryByRole('region', { name: 'Current group status' })
    ).toBeNull()
    expect(healthRequests).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('tab', { name: 'Primary channel' }))
    clickGroup('Standard access')
    expect(await screen.findByText('98.50%')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Smart routing' }))
    expect(
      screen.queryByRole('region', { name: 'Current group status' })
    ).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Primary channel' }))
    expect(screen.getByText('98.50%')).toBeInTheDocument()
    expect(healthRequests).toHaveBeenCalledTimes(1)
  })

  test('retains the default server error redirect for queries without an explicit opt-out', async () => {
    const onInternalServerError = vi.fn()
    const failure = Object.assign(new Error('Service unavailable'), {
      response: { status: 500 },
    })
    queryClient = createAppQueryClient(onInternalServerError)

    await expect(
      queryClient.fetchQuery({
        queryKey: ['default-server-error'],
        queryFn: async () => {
          throw failure
        },
        retry: false,
        meta: { errorToast: false },
      })
    ).rejects.toBe(failure)
    expect(onInternalServerError).toHaveBeenCalledTimes(1)
  })
})

describe('API key create dialog cross-group retry', () => {
  test('hides the switch for a single group and shows it, on by default, after valid days for smart routing', () => {
    renderCreateDialog([])

    expect(
      screen.queryByRole('switch', { name: 'Cross-group retry' })
    ).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Smart routing' }))

    const validDaysLabel = screen.getByText('Valid days')
    const retrySwitch = screen.getByRole('switch', {
      name: 'Cross-group retry',
    })

    expect(retrySwitch).toBeChecked()
    expect(
      validDaysLabel.compareDocumentPosition(retrySwitch) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  test('sends cross_group_retry false for a smart route after the switch is turned off', async () => {
    const createdPayloads: Array<Record<string, unknown>> = []
    renderCreateDialog(createdPayloads)

    fireEvent.input(screen.getByPlaceholderText('For example: My app'), {
      target: { value: 'no-retry' },
    })
    fireEvent.click(screen.getByRole('tab', { name: 'Smart routing' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Cross-group retry' }))
    clickGroup('Priority access')
    clickGroup('Standard access')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createdPayloads).toHaveLength(1))
    expect(createdPayloads[0]?.group).toBe('auto')
    expect(createdPayloads[0]?.auto_groups).toEqual(['vip', 'default'])
    expect(createdPayloads[0]?.cross_group_retry).toBe(false)
  })
})
