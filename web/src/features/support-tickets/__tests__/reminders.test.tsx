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
  focusManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { useTicketReminderStore } from '../reminder-store'
import { TicketReminders } from '../ticket-reminders'
import type { TicketDetail, TicketReminders as ReminderData } from '../types'
import { ticketReminderKey } from '../use-ticket-reminders'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }))

const clients = new Set<QueryClient>()
const observers = new Set<{
  callback: IntersectionObserverCallback
  targets: Set<Element>
}>()
let reminders: ReminderData
let ownerReminders: ReminderData
let failure: unknown
const detail: TicketDetail = {
  ticket: {
    id: 123,
    user_id: 36,
    category: 'api_error',
    status: 'open',
    created_at: 1_800_000_000,
    updated_at: 1_800_000_010,
    last_reply_at: 1_800_000_010,
    message_count: 2,
  },
  messages: [
    {
      id: 101,
      ticket_id: 123,
      author_id: 36,
      is_admin: false,
      content: 'First user question',
      created_at: 1_800_000_000,
      attachments: [],
    },
    {
      id: 102,
      ticket_id: 123,
      author_id: 36,
      is_admin: false,
      content: 'Another user reply below the viewport',
      created_at: 1_800_000_010,
      attachments: [],
    },
  ],
}

beforeEach(() => {
  localStorage.clear()
  failure = null
  reminders = {
    unread_count: 1,
    latest_message_id: 102,
    items: [
      {
        ticket_id: 123,
        user_id: 36,
        category: 'api_error',
        status: 'open',
        kind: 'reply',
        message_id: 102,
        created_at: 1_800_000_010,
        unread_count: 2,
      },
    ],
  }
  ownerReminders = { unread_count: 0, latest_message_id: 0, items: [] }
  useTicketReminderStore.setState({
    dismissedByAccount: {},
    openedDetail: null,
  })
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (String(url) === '/api/support/admin/tickets/reminders') {
      if (failure) throw failure
      return { data: { success: true, data: reminders } } as never
    }
    if (String(url) === '/api/support/tickets/reminders') {
      return { data: { success: true, data: ownerReminders } } as never
    }
    if (String(url).endsWith('/123')) {
      return { data: { success: true, data: detail } } as never
    }
    throw new Error(`Unexpected request: ${url}`)
  })
  vi.mocked(api.post).mockResolvedValue({
    data: { success: true },
  } as Awaited<ReturnType<typeof api.post>>)
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      root = null
      rootMargin = '0px'
      thresholds = [1]
      record: { callback: IntersectionObserverCallback; targets: Set<Element> }
      constructor(callback: IntersectionObserverCallback) {
        this.record = { callback, targets: new Set() }
        observers.add(this.record)
      }
      observe(target: Element) {
        this.record.targets.add(target)
      }
      unobserve(target: Element) {
        this.record.targets.delete(target)
      }
      disconnect() {
        this.record.targets.clear()
      }
      takeRecords() {
        return []
      }
    }
  )
  focusManager.setFocused(true)
})

afterEach(() => {
  cleanup()
  for (const client of clients) client.clear()
  clients.clear()
  observers.clear()
  useTicketReminderStore.setState({
    dismissedByAccount: {},
    openedDetail: null,
  })
  localStorage.clear()
  vi.unstubAllGlobals()
  focusManager.setFocused(undefined)
})

function renderReminders(userId = 10, admin = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.add(client)
  const view = render(
    <QueryClientProvider client={client}>
      <TicketReminders key={userId} userId={userId} admin={admin} />
    </QueryClientProvider>
  )
  return { ...view, client }
}

function revealMessage(id: number) {
  const marker = document.querySelector(
    `[data-ticket-incoming-message-id="${id}"]`
  )
  if (!marker) throw new Error(`Message ${id} is not rendered`)
  for (const observer of observers) {
    if (!observer.targets.has(marker)) continue
    observer.callback(
      [
        {
          target: marker,
          isIntersecting: true,
          intersectionRatio: 1,
        } as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver
    )
  }
}

test('关闭浮窗保留未读，同一批刷新不重弹，真正的新回复重新展开', async () => {
  const user = userEvent.setup()
  const { client } = renderReminders()
  expect(
    await screen.findByRole('complementary', { name: 'Ticket reminders' })
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Close panel' }))
  expect(
    screen.queryByRole('complementary', { name: 'Ticket reminders' })
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Ticket reminders: 1' })
  ).toBeVisible()
  expect(api.post).not.toHaveBeenCalled()

  await act(async () => {
    await client.invalidateQueries({ queryKey: ticketReminderKey(10) })
  })
  expect(
    screen.queryByRole('complementary', { name: 'Ticket reminders' })
  ).not.toBeInTheDocument()
  reminders = {
    ...reminders,
    latest_message_id: 103,
    items: [{ ...reminders.items[0], message_id: 103, unread_count: 3 }],
  }
  await act(async () => {
    await client.invalidateQueries({ queryKey: ticketReminderKey(10) })
  })
  expect(
    await screen.findByRole('complementary', { name: 'Ticket reminders' })
  ).toBeVisible()
})

test('窄屏新消息只显示紧凑入口，点击后才展开', async () => {
  const user = userEvent.setup()
  const original = window.matchMedia
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...original(query),
    matches: query === '(max-width: 639px)',
  }))
  renderReminders()
  expect(
    await screen.findByRole('button', { name: 'Ticket reminders: 1' })
  ).toBeVisible()
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Ticket reminders: 1' }))
  expect(
    screen.getByRole('complementary', { name: 'Ticket reminders' })
  ).toBeVisible()
})

test('账号切换不继承上一账号的收起与详情，卸载清除旧提醒缓存', async () => {
  const user = userEvent.setup()
  const view = renderReminders(10)
  await screen.findByRole('complementary', { name: 'Ticket reminders' })
  await user.click(screen.getByRole('button', { name: 'Close panel' }))
  act(() => useTicketReminderStore.getState().openDetail(10, 123))
  view.rerender(
    <QueryClientProvider client={view.client}>
      <TicketReminders key={11} userId={11} />
    </QueryClientProvider>
  )
  expect(
    await screen.findByRole('complementary', { name: 'Ticket reminders' })
  ).toBeVisible()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(view.client.getQueryData(ticketReminderKey(10))).toBeUndefined()
})

test('管理员权限失效后隐藏缓存摘要并停止重新聚焦请求', async () => {
  const view = renderReminders()
  await screen.findByRole('complementary', { name: 'Ticket reminders' })
  failure = { response: { status: 403, data: { success: false } } }
  await act(async () => {
    await view.client.invalidateQueries({ queryKey: ticketReminderKey(10) })
  })
  await waitFor(() =>
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  )
  const requests = vi
    .mocked(api.get)
    .mock.calls.filter(([url]) => String(url).includes('/admin/')).length
  await act(async () => {
    focusManager.setFocused(false)
    focusManager.setFocused(true)
    await Promise.resolve()
  })
  expect(
    vi
      .mocked(api.get)
      .mock.calls.filter(([url]) => String(url).includes('/admin/'))
  ).toHaveLength(requests)
})

test('打开详情不直接清全部，只有真正展示到的消息ID才确认已读', async () => {
  const user = userEvent.setup()
  renderReminders()
  await user.click(await screen.findByRole('button', { name: 'View' }))
  await screen.findByText('First user question')
  expect(api.post).not.toHaveBeenCalled()
  act(() => revealMessage(101))
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      '/api/support/admin/tickets/123/read',
      { message_id: 101 },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  )
  expect(
    vi
      .mocked(api.post)
      .mock.calls.some(
        (call) => (call[1] as { message_id?: number }).message_id === 102
      )
  ).toBe(false)
})

test('可视消息确认临时失败后，再次阅读同一条允许重试且不自动死循环', async () => {
  const user = userEvent.setup()
  vi.mocked(api.post).mockRejectedValueOnce(new Error('temporary offline'))
  renderReminders()
  await user.click(await screen.findByRole('button', { name: 'View' }))
  await screen.findByText('First user question')
  await act(async () => {
    revealMessage(101)
    await Promise.resolve()
  })
  expect(api.post).toHaveBeenCalledTimes(1)
  await act(async () => {
    revealMessage(101)
    await Promise.resolve()
  })
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2))
})

test('普通用户只请求本人工单，客服回复真正可见后只确认本人接口', async () => {
  const user = userEvent.setup()
  ownerReminders = {
    unread_count: 1,
    latest_message_id: 202,
    items: [
      {
        ...reminders.items[0],
        user_id: 36,
        kind: 'support_reply',
        message_id: 202,
        unread_count: 1,
      },
    ],
  }
  const originalGet = vi.mocked(api.get).getMockImplementation()
  if (!originalGet) throw new Error('工单请求模拟尚未初始化')
  vi.mocked(api.get).mockImplementation(async (url, config) => {
    if (String(url) === '/api/support/tickets/123') {
      return {
        data: {
          success: true,
          data: {
            ...detail,
            messages: [
              detail.messages[0],
              {
                ...detail.messages[1],
                id: 202,
                author_id: 10,
                is_admin: true,
                content: 'Support has replied to you',
              },
            ],
          },
        },
      } as never
    }
    return originalGet(url, config)
  })
  renderReminders(36, false)
  expect(await screen.findByText('New support reply')).toBeVisible()
  expect(screen.queryByText(/User ID/)).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'My support tickets' })
  ).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Open ticket management' })
  ).not.toBeInTheDocument()
  expect(
    vi
      .mocked(api.get)
      .mock.calls.every(([url]) => !String(url).includes('/admin/'))
  ).toBe(true)
  await user.click(screen.getByRole('button', { name: 'View' }))
  await screen.findByText('Support has replied to you')
  expect(api.post).not.toHaveBeenCalled()
  expect(
    document.querySelector('[data-ticket-incoming-message-id="101"]')
  ).toBeNull()
  act(() => revealMessage(202))
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      '/api/support/tickets/123/read',
      { message_id: 202 },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  )
  expect(
    vi
      .mocked(api.get)
      .mock.calls.every(([url]) => !String(url).includes('/admin/'))
  ).toBe(true)
})

test('管理员两种身份合并一个浮窗，关闭分别记忆，任一身份新消息均可再展开', async () => {
  const user = userEvent.setup()
  ownerReminders = {
    unread_count: 1,
    latest_message_id: 90,
    items: [
      {
        ...reminders.items[0],
        ticket_id: 124,
        user_id: 10,
        kind: 'support_reply',
        message_id: 90,
        unread_count: 1,
      },
    ],
  }
  const view = renderReminders()
  await screen.findByText('New support reply')
  expect(
    screen.getAllByRole('complementary', { name: 'Ticket reminders' })
  ).toHaveLength(1)
  expect(screen.getByText('New user reply')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Close panel' }))
  expect(useTicketReminderStore.getState().dismissedByAccount).toEqual({
    '10:admin': 102,
    '10:owner': 90,
  })

  ownerReminders = {
    ...ownerReminders,
    latest_message_id: 91,
    items: [{ ...ownerReminders.items[0], message_id: 91 }],
  }
  await act(async () => {
    await view.client.invalidateQueries({
      queryKey: ticketReminderKey(10, false),
    })
  })
  expect(
    await screen.findByRole('complementary', { name: 'Ticket reminders' })
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Close panel' }))

  reminders = {
    ...reminders,
    latest_message_id: 103,
    items: [{ ...reminders.items[0], message_id: 103 }],
  }
  await act(async () => {
    await view.client.invalidateQueries({
      queryKey: ticketReminderKey(10, true),
    })
  })
  expect(
    await screen.findByRole('complementary', { name: 'Ticket reminders' })
  ).toBeVisible()
})

test('管理身份被拒绝仍保留本人客服回复且正确跳转我的工单', async () => {
  const user = userEvent.setup()
  ownerReminders = {
    unread_count: 1,
    latest_message_id: 202,
    items: [
      {
        ...reminders.items[0],
        user_id: 10,
        kind: 'support_reply',
        message_id: 202,
        unread_count: 1,
      },
    ],
  }
  failure = { response: { status: 403 } }
  renderReminders()
  expect(await screen.findByText('New support reply')).toBeVisible()
  await waitFor(() =>
    expect(screen.queryByText('New user reply')).not.toBeInTheDocument()
  )
  expect(
    screen.queryByRole('button', { name: 'Open ticket management' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'My support tickets' }))
  expect(navigate).toHaveBeenCalledWith({ to: '/support-tickets' })
})
