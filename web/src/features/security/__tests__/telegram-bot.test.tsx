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
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import type { UserProfile } from '@/features/profile/types'
import {
  EMPTY_TELEGRAM_PREFERENCES,
  type TelegramBotStatus,
} from '@/features/telegram-bot/types'
import { api } from '@/lib/api'

import { TelegramBotCard } from '../components/telegram-bot-card'

const status: TelegramBotStatus = {
  available: true,
  bot_username: 'site_example_bot',
  connected: false,
  status: 'unconnected',
  telegram_id: '',
  version: 1,
  preferences_version: 2,
  preferences: EMPTY_TELEGRAM_PREFERENCES,
  last_error: '',
  last_connected_at: 0,
  deep_link: 'https://t.me/site_example_bot',
}
const clients: QueryClient[] = []
function fixture(
  overrides: Partial<TelegramBotStatus> = {},
  bound = false,
  fail = false
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  const value = { ...status, ...overrides }
  const get = vi.spyOn(api, 'get')
  if (fail) get.mockRejectedValue(new Error('unavailable'))
  else get.mockResolvedValue({ data: { success: true, data: value } })
  const onAuthorize = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <ul>
        <TelegramBotCard
          profile={
            { id: 1, telegram_id: bound ? '12345678' : '' } as UserProfile
          }
          oauthEnabled
          locked={false}
          onAuthorize={onAuthorize}
        />
      </ul>
    </QueryClientProvider>
  )
  return { onAuthorize, user: userEvent.setup() }
}

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
})

it('defaults to connecting the bot and enabling every notification on first binding', async () => {
  const { user, onAuthorize } = fixture({ preferences_version: 0 })
  const bind = await screen.findByRole('button', { name: 'Bind' })
  await waitFor(() => expect(bind).toBeEnabled())
  await user.click(bind)
  const dialog = await screen.findByRole('dialog', {
    name: 'Bind Telegram Account',
  })
  for (const name of [
    'Connect bot with this authorization',
    'Telegram notifications',
    'Low platform balance',
    'Top-up credited',
    'Subscription activated',
    'Subscription expiring soon',
  ]) {
    expect(within(dialog).getByRole('switch', { name })).toBeChecked()
  }
  expect(onAuthorize).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
  expect(onAuthorize).toHaveBeenCalledWith(
    {
      enabled: true,
      low_balance: true,
      topup: true,
      subscription: true,
      expiry: true,
    },
    false
  )
})

it('allows first binding without bot access when the user turns off the default connection', async () => {
  const { user, onAuthorize } = fixture({ preferences_version: 0 })
  const bind = await screen.findByRole('button', { name: 'Bind' })
  await waitFor(() => expect(bind).toBeEnabled())
  await user.click(bind)
  const dialog = await screen.findByRole('dialog')
  await user.click(
    within(dialog).getByRole('switch', {
      name: 'Connect bot with this authorization',
    })
  )
  expect(
    within(dialog).queryByRole('switch', { name: 'Telegram notifications' })
  ).not.toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
  expect(onAuthorize).toHaveBeenCalledWith(undefined, false)
})

it('keeps the bot connected when the user disables all notifications before binding', async () => {
  const { user, onAuthorize } = fixture({ preferences_version: 0 })
  const bind = await screen.findByRole('button', { name: 'Bind' })
  await waitFor(() => expect(bind).toBeEnabled())
  await user.click(bind)
  const dialog = await screen.findByRole('dialog')
  await user.click(
    within(dialog).getByRole('switch', { name: 'Telegram notifications' })
  )
  expect(
    within(dialog).getByRole('switch', {
      name: 'Connect bot with this authorization',
    })
  ).toBeChecked()
  expect(
    within(dialog).getByRole('switch', { name: 'Top-up credited' })
  ).toHaveAttribute('aria-disabled', 'true')
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
  expect(onAuthorize).toHaveBeenCalledWith(
    {
      enabled: false,
      low_balance: true,
      topup: true,
      subscription: true,
      expiry: true,
    },
    false
  )
})

it.each([0, 2])(
  'uses defaults only for an unsaved preference version when reconnecting, version %s',
  async (preferences_version) => {
    const { user, onAuthorize } = fixture({ preferences_version }, true)
    const enable = await screen.findByRole('button', { name: 'Enable bot' })
    await waitFor(() => expect(enable).toBeEnabled())
    await user.click(enable)
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByRole('switch', { name: 'Telegram notifications' })
    ).toHaveAttribute('aria-checked', String(preferences_version === 0))
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
    expect(onAuthorize).toHaveBeenCalledWith(
      {
        enabled: preferences_version === 0,
        low_balance: preferences_version === 0,
        topup: preferences_version === 0,
        subscription: preferences_version === 0,
        expiry: preferences_version === 0,
      },
      true
    )
  }
)

it('keeps Telegram binding available without bot access when the administrator disables the bot', async () => {
  const { user, onAuthorize } = fixture({ available: false })
  const bind = await screen.findByRole('button', { name: 'Bind' })
  await waitFor(() => expect(bind).toBeEnabled())
  await user.click(bind)
  expect(onAuthorize).toHaveBeenCalledWith()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('keeps account commands available when proactive notifications are disabled', async () => {
  fixture({ connected: true, status: 'connected' }, true)
  expect(await screen.findByRole('button', { name: 'Open bot' })).toBeVisible()
  expect(
    screen.getByText(
      'Bot commands: /balance, /usage, /subs, /checkin, /notify and /help'
    )
  ).toBeVisible()
  expect(
    screen.getByRole('switch', { name: 'Telegram notifications' })
  ).not.toBeChecked()
  expect(
    screen.getByRole('button', { name: 'Send test message' })
  ).toBeEnabled()
})

it('disconnects only the bot after an explicit confirmation and leaves the login binding visible', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  const { user } = fixture({ connected: true, status: 'connected' }, true)
  await user.click(
    await screen.findByRole('button', { name: 'Disconnect bot' })
  )
  expect(post).not.toHaveBeenCalled()
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Disconnect Telegram bot?',
  })
  expect(
    within(dialog).getByText(
      'This stops bot commands and notifications. Your Telegram login remains linked.'
    )
  ).toBeVisible()
  await user.click(
    within(dialog).getByRole('button', { name: 'Disconnect bot' })
  )
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/user/self/telegram-bot/disconnect',
      {}
    )
  )
  expect(screen.getByText(/Linked Telegram ID: …5678/)).toBeVisible()
})

it('shows a recoverable status error instead of claiming the bot is connected', async () => {
  const { user } = fixture({}, false, true)
  expect(
    await screen.findByText(
      'Bot status is unavailable. You can retry without changing your Telegram login.'
    )
  ).toBeVisible()
  expect(screen.queryByText('Bot connected')).not.toBeInTheDocument()
  vi.mocked(api.get).mockResolvedValue({
    data: { success: true, data: status },
  })
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Bind' })).toBeEnabled()
  )
})

it('allows a pending bot connection to be disconnected before verification finishes', async () => {
  fixture({ status: 'connecting' }, true)
  expect(
    await screen.findByRole('button', { name: 'Disconnect bot' })
  ).toBeEnabled()
  expect(
    screen.getByText(
      'Telegram is linked. The bot connection is being verified.'
    )
  ).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Send test message' })
  ).not.toBeInTheDocument()
})

it.each(['', 'Telegram bot connection failed. Please reconnect.'])(
  'offers recovery for an unconnected Telegram identity even when its last error is %s',
  async (last_error) => {
    fixture({ last_error }, true)
    expect(
      await screen.findByRole('button', { name: 'Recover through bot' })
    ).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Enable bot' })).toBeEnabled()
    if (last_error) expect(screen.getByText(last_error)).toBeVisible()
  }
)

it('reloads conflicting notification settings and requires a new review instead of replaying the old draft', async () => {
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: {
      success: false,
      message_key:
        'Telegram bot settings changed. Please reload and try again.',
    },
  })
  const { user } = fixture({ connected: true, status: 'connected' }, true)
  await user.click(
    await screen.findByRole('switch', { name: 'Telegram notifications' })
  )
  vi.mocked(api.get).mockResolvedValue({
    data: {
      success: true,
      data: {
        ...status,
        connected: true,
        status: 'connected',
        preferences_version: 3,
      },
    },
  })
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  expect(
    await screen.findByText(
      'Notification settings changed elsewhere. Review the latest settings before saving.'
    )
  ).toBeVisible()
  await waitFor(() =>
    expect(
      screen.getByRole('switch', { name: 'Telegram notifications' })
    ).not.toBeChecked()
  )
  expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  expect(put).toHaveBeenCalledTimes(1)
  await user.click(
    screen.getByRole('switch', { name: 'Telegram notifications' })
  )
  put.mockResolvedValue({ data: { success: true } })
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(put).toHaveBeenLastCalledWith(
      '/api/user/self/telegram-bot/preferences',
      {
        version: 3,
        preferences: { ...EMPTY_TELEGRAM_PREFERENCES, enabled: true },
      }
    )
  )
})

it('keeps a conflicting draft disabled when loading the latest settings fails and allows a manual refresh', async () => {
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: { success: false, code: 'TELEGRAM_BOT_SETTINGS_CHANGED' },
  })
  const { user } = fixture({ connected: true, status: 'connected' }, true)
  await user.click(
    await screen.findByRole('switch', { name: 'Telegram notifications' })
  )
  vi.mocked(api.get).mockRejectedValue(new Error('unavailable'))
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  expect(
    await screen.findByText(
      'Bot status is unavailable. You can retry without changing your Telegram login.'
    )
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  expect(put).toHaveBeenCalledTimes(1)
  vi.mocked(api.get).mockResolvedValue({
    data: {
      success: true,
      data: {
        ...status,
        connected: true,
        status: 'connected',
        preferences_version: 3,
      },
    },
  })
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() =>
    expect(
      screen.getByRole('switch', { name: 'Telegram notifications' })
    ).not.toBeChecked()
  )
  expect(put).toHaveBeenCalledTimes(1)
})
