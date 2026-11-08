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
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { Wallet } from '..'
import { BillingHistoryCard } from '../components/billing-history-card'

const i18n = createInstance()
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})
const order = {
  id: 1,
  user_id: 1,
  amount: 100,
  money: 90,
  trade_no: 'wallet-order-1',
  payment_method: 'alipay',
  create_time: 1794121200,
  status: 'success',
}

beforeEach(async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'wallet-user', role: 1 })
  await i18n.use(initReactI18next).init({
    lng: 'zh',
    fallbackLng: false,
    nsSeparator: false,
    resources: { en, zh },
    interpolation: { escapeValue: false },
  })
  queryClient.setQueryData(['status'], { price: 1 })
})

afterEach(() => {
  queryClient.clear()
  useAuthStore.getState().auth.reset()
})

it('shows separate recharge cards above inline billing and refreshes history after redeeming', async () => {
  const requests = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/user/topup/info') {
      return {
        data: {
          success: true,
          data: {
            enable_online_topup: true,
            enable_stripe_topup: false,
            enable_redemption: true,
            payment_compliance_confirmed: true,
            pay_methods: [
              { name: 'Alipay', type: 'alipay' },
              { name: 'WeChat Pay', type: 'wxpay' },
            ],
            amount_options: [10, 20, 50, 100, 200, 500],
            discount: { 100: 0.9 },
            min_topup: 1,
            stripe_min_topup: 1,
            topup_link: 'https://example.com/cards',
          },
        },
      }
    }
    if (url === '/api/user/self') {
      return {
        data: {
          success: true,
          data: {
            id: 1,
            quota: 50000000,
            used_quota: 1000000,
            request_count: 20,
            aff_quota: 0,
          },
        },
      }
    }
    if (url === '/api/user/aff') {
      return { data: { success: true, data: 'invite' } }
    }
    if (url === '/api/subscription/plans') {
      return { data: { success: true, data: [] } }
    }
    if (url === '/api/subscription/self') {
      return {
        data: {
          success: true,
          data: { subscriptions: [], all_subscriptions: [] },
        },
      }
    }
    if (url.startsWith('/api/user/topup/self?')) {
      return { data: { success: true, data: { total: 1, items: [order] } } }
    }
    throw new Error(`Unexpected request: ${url}`)
  })
  vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url === '/api/user/amount') {
      return { data: { success: true, data: '1' } }
    }
    if (url === '/api/user/topup') {
      return { data: { success: true, data: 500000 } }
    }
    throw new Error(`Unexpected request: ${url}`)
  })
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
  const rootRoute = createRootRoute()
  const walletRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/wallet',
    component: () => <Wallet initialShowHistory />,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([walletRoute]),
    history: createMemoryHistory({ initialEntries: ['/wallet'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>
  )

  await screen.findByText(order.trade_no)
  const online = screen
    .getByText('站内充值')
    .closest<HTMLElement>('[data-slot=card]')
  const redemption = screen
    .getByText('兑换码充值')
    .closest<HTMLElement>('[data-slot=card]')
  const history = screen
    .getByText('历史账单')
    .closest<HTMLElement>('[data-slot=card]')
  if (!online || !redemption || !history) {
    throw new Error('Wallet sections must render as cards')
  }
  expect(online.parentElement).toBe(redemption.parentElement)
  expect(
    online.compareDocumentPosition(redemption) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(
    redemption.compareDocumentPosition(history) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(within(history).getByRole('table', { name: '历史账单' })).toBeVisible()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: '订单历史' })
  ).not.toBeInTheDocument()
  await waitFor(() => expect(scroll).toHaveBeenCalledOnce())

  const user = userEvent.setup()
  const historyLoads = () =>
    requests.mock.calls.filter(([url]) =>
      url.startsWith('/api/user/topup/self?')
    ).length
  const beforeRedeem = historyLoads()
  await user.type(
    within(redemption).getByLabelText('有兑换码吗？'),
    'redeem-example'
  )
  await user.click(within(redemption).getByRole('button', { name: '兑换额度' }))
  await waitFor(() => expect(historyLoads()).toBe(beforeRedeem + 1))
  expect(screen.getByLabelText('有兑换码吗？')).toHaveValue('')
  expect(scroll).toHaveBeenCalledOnce()
  await user.click(within(online).getByRole('button', { name: 'Alipay' }))
  expect(await screen.findByRole('alertdialog')).toBeVisible()
})

it('keeps the billing table paginated and refreshes filtered snapshots', async () => {
  const user = userEvent.setup()
  let refreshed = false
  const request = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    const params = new URL(url, 'https://example.com').searchParams
    const page = Number(params.get('p'))
    const size = Number(params.get('page_size'))
    let tradeNo = `page-${page}`
    if (size === 100) {
      tradeNo = refreshed ? 'updated-order' : order.trade_no
    }
    const items = [{ ...order, trade_no: tradeNo }]
    return {
      data: { success: true, data: { total: size === 100 ? 1 : 11, items } },
    }
  })
  const view = render(
    <I18nextProvider i18n={i18n}>
      <BillingHistoryCard refreshKey={0} paymentMethods={['alipay']} />
    </I18nextProvider>
  )
  await screen.findByText('page-1')
  await user.click(screen.getByRole('button', { name: '前往下一页' }))
  await screen.findByText('page-2')
  expect(request).toHaveBeenCalledWith('/api/user/topup/self?p=2&page_size=10')
  await user.click(screen.getByRole('combobox', { name: '付款方式' }))
  await user.click(screen.getByRole('option', { name: '支付宝' }))
  await screen.findByText(order.trade_no)
  const scans = request.mock.calls.filter(([url]) =>
    url.includes('page_size=100')
  ).length
  refreshed = true
  view.rerender(
    <I18nextProvider i18n={i18n}>
      <BillingHistoryCard refreshKey={1} paymentMethods={['alipay']} />
    </I18nextProvider>
  )
  await screen.findByText('updated-order')
  expect(
    request.mock.calls.filter(([url]) => url.includes('page_size=100'))
  ).toHaveLength(scans + 1)
  await user.click(screen.getByRole('button', { name: '刷新' }))
  await waitFor(() =>
    expect(
      request.mock.calls.filter(([url]) => url.includes('page_size=100'))
    ).toHaveLength(scans + 2)
  )
  await act(() => i18n.changeLanguage('en'))
  expect(screen.getByRole('table', { name: 'Billing history' })).toBeVisible()
})
