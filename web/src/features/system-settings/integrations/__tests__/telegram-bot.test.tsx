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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { toast } from 'sonner'
import { afterEach, expect, it, vi } from 'vitest'

import type { TelegramBotConfig } from '@/features/telegram-bot/types'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { TelegramBotSection } from '../telegram-bot-section'

vi.mock('../../components/form-navigation-guard', () => ({
  FormNavigationGuard: () => null,
}))

const config: TelegramBotConfig = {
  enabled: true,
  low_balance_enabled: true,
  group_ratio_change_enabled: false,
  token_configured: true,
  bot_id: '12345678',
  bot_username: 'site_example_bot',
  version: 4,
  webhook_url: 'https://example.com/api/telegram-bot/webhook',
  webhook_status: 'ready',
  last_error: '',
  pending_inbox: 2,
  pending_outbox: 3,
}
const clients: QueryClient[] = []
function SettingsFixture() {
  const [actions, setActions] = useState<HTMLDivElement | null>(null)
  return (
    <SettingsPageProvider actionsContainer={actions}>
      <div ref={setActions} />
      <TelegramBotSection />
    </SettingsPageProvider>
  )
}
function fixture(role = 100, overrides: Partial<TelegramBotConfig> = {}) {
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'administrator', role })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { ...config, ...overrides } },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <SettingsFixture />
    </QueryClientProvider>
  )
  return userEvent.setup()
}
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  useAuthStore.getState().auth.setUser(null)
  vi.restoreAllMocks()
})

it('keeps the saved token hidden and preserves it when saving only the enabled switch', async () => {
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: { success: true, data: { ...config, enabled: false, version: 5 } },
  })
  const user = fixture()
  const token = await screen.findByLabelText('Bot Token', { selector: 'input' })
  expect(token).toHaveValue('')
  expect(token).toHaveAttribute(
    'placeholder',
    'Configured — leave blank to keep'
  )
  await user.click(screen.getByRole('switch', { name: 'Enable Telegram bot' }))
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/telegram-bot/config', {
      enabled: false,
      low_balance_enabled: true,
      group_ratio_change_enabled: false,
      version: 4,
    })
  )
  expect(token).toHaveValue('')
})

it('defaults missing notification settings to low balance on and ratio changes off', async () => {
  fixture(100, {
    low_balance_enabled: undefined,
    group_ratio_change_enabled: undefined,
  })
  expect(
    await screen.findByRole('switch', {
      name: 'Telegram low balance notifications',
    })
  ).toBeChecked()
  expect(
    screen.getByRole('switch', {
      name: 'Telegram group ratio change notifications',
    })
  ).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
})

it('saves independent notification choices and resets later edits to the saved settings', async () => {
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: {
      success: true,
      data: {
        ...config,
        low_balance_enabled: false,
        group_ratio_change_enabled: true,
        version: 5,
      },
    },
  })
  const user = fixture()
  const lowBalance = await screen.findByRole('switch', {
    name: 'Telegram low balance notifications',
  })
  const ratioChanges = screen.getByRole('switch', {
    name: 'Telegram group ratio change notifications',
  })
  await user.click(lowBalance)
  await user.click(ratioChanges)
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/telegram-bot/config', {
      enabled: true,
      low_balance_enabled: false,
      group_ratio_change_enabled: true,
      version: 4,
    })
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  )
  expect(lowBalance).not.toBeChecked()
  expect(ratioChanges).toBeChecked()
  await user.click(lowBalance)
  await user.click(ratioChanges)
  await user.click(screen.getByRole('button', { name: 'Reset' }))
  expect(lowBalance).not.toBeChecked()
  expect(ratioChanges).toBeChecked()
  expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
})

it('lets administrators read diagnostics while restricting token changes to the root account', async () => {
  fixture(10)
  expect(
    await screen.findByLabelText('Bot Token', { selector: 'input' })
  ).toBeDisabled()
  expect(
    screen.getByRole('switch', { name: 'Enable Telegram bot' })
  ).toHaveAttribute('aria-disabled', 'true')
  expect(
    screen.getByRole('switch', { name: 'Telegram low balance notifications' })
  ).toHaveAttribute('aria-disabled', 'true')
  expect(
    screen.getByRole('switch', {
      name: 'Telegram group ratio change notifications',
    })
  ).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByText('Connected')).toBeVisible()
  expect(screen.getByText('Pending incoming messages')).toBeVisible()
})

it.each(['error', 'pending'])(
  'retries a %s webhook without changing the saved form or resending the token',
  async (webhook_status) => {
    const put = vi.spyOn(api, 'put').mockResolvedValue({
      data: {
        success: true,
        data: {
          ...config,
          low_balance_enabled: false,
          group_ratio_change_enabled: true,
          version: 5,
        },
      },
    })
    const user = fixture(100, {
      webhook_status,
      low_balance_enabled: false,
      group_ratio_change_enabled: true,
    })
    const retry = await screen.findByRole('button', {
      name: 'Retry webhook registration',
    })
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
    await user.click(retry)
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/api/telegram-bot/config', {
        enabled: true,
        low_balance_enabled: false,
        group_ratio_change_enabled: true,
        version: 4,
      })
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Retry webhook registration' })
      ).not.toBeInTheDocument()
    )
  }
)

it('prevents administrators from retrying webhook registration without root access', async () => {
  fixture(10, { webhook_status: 'error' })
  expect(
    await screen.findByRole('button', { name: 'Retry webhook registration' })
  ).toBeDisabled()
})

it('keeps the retry available and reports failure when webhook registration still fails', async () => {
  const success = vi.spyOn(toast, 'success')
  const failure = vi.spyOn(toast, 'error')
  vi.spyOn(api, 'put').mockResolvedValue({
    data: {
      success: true,
      data: { ...config, webhook_status: 'error', version: 5 },
    },
  })
  const user = fixture(100, { webhook_status: 'error' })
  await user.click(
    await screen.findByRole('button', { name: 'Retry webhook registration' })
  )
  await waitFor(() =>
    expect(failure).toHaveBeenCalledWith(
      'Webhook registration failed. Please retry.'
    )
  )
  expect(success).not.toHaveBeenCalled()
  expect(
    screen.getByRole('button', { name: 'Retry webhook registration' })
  ).toBeEnabled()
})
