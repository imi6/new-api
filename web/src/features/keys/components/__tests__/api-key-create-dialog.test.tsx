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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'

const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')
const { api } = await import('@/lib/api')
const { ApiKeysProvider } = await import('../api-keys-provider')
const { ApiKeyCreateDialog } = await import('../api-key-create-dialog')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

type ApiMethod = (url: string, data?: unknown) => Promise<{ data: unknown }>
type MockableApi = { post: ApiMethod }

const apiClient = api as unknown as MockableApi
const originalPost = apiClient.post
let queryClient: InstanceType<typeof QueryClient> | null = null

function renderCreateDialog(createdPayloads: Array<Record<string, unknown>>) {
  apiClient.post = async (url, data) => {
    expect(url).toBe('/api/token/')
    createdPayloads.push(data as Record<string, unknown>)
    return { data: { success: true, data: {} } }
  }

  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
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
  queryClient?.clear()
  queryClient = null
})

describe('API key create dialog cross-group retry', () => {
  test('shows the cross-group retry switch, on by default, after the valid days field', () => {
    renderCreateDialog([])

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
    fireEvent.click(screen.getByRole('switch', { name: 'Cross-group retry' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Smart routing' }))
    clickGroup('Priority access')
    clickGroup('Standard access')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createdPayloads).toHaveLength(1))
    expect(createdPayloads[0]?.group).toBe('auto')
    expect(createdPayloads[0]?.auto_groups).toEqual(['vip', 'default'])
    expect(createdPayloads[0]?.cross_group_retry).toBe(false)
  })
})
