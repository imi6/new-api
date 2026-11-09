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
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { AffiliateRebatePage } from '../components/affiliate-rebate-page'

const summary = {
  claimable: 10_000_000,
  max_claim_quota: 10_000_000,
  can_claim: true,
  percent: 10,
  week_claimed: 0,
  week_paid_consumed: 200_000_000,
  accrued: 10_000_000,
  claimed: 0,
  paid_consumed: 200_000_000,
  downstream_threshold: 0,
  upstream_minimum: 0,
  invitees: [],
}

async function renderRebate(onClaimed = vi.fn()) {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <AffiliateRebatePage onClaimed={onClaimed} />,
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(<RouterProvider router={router} />)
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Claim rebate to balance' })
    ).toBeEnabled()
  )
}

test('legacy claims reuse their request identifier after a failed response and rotate it after success', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: summary },
  })
  const post = vi
    .spyOn(api, 'post')
    .mockRejectedValueOnce(new Error('Connection interrupted'))
    .mockResolvedValue({ data: { success: true } })
  await renderRebate()
  const user = userEvent.setup()
  await user.click(
    screen.getByRole('button', { name: 'Claim rebate to balance' })
  )
  await screen.findByText('Failed to claim referral rebate')
  await user.click(
    screen.getByRole('button', { name: 'Claim rebate to balance' })
  )
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
  expect(post.mock.calls[0][1]).toMatchObject({
    quota: 10_000_000,
    request_id: expect.any(String),
  })
  expect(post.mock.calls[1][1]).toEqual(post.mock.calls[0][1])
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Claim rebate to balance' })
    ).toBeEnabled()
  )
  fireEvent.change(screen.getByLabelText('Amount to claim'), {
    target: { value: '10' },
  })
  await user.click(
    screen.getByRole('button', { name: 'Claim rebate to balance' })
  )
  await waitFor(() => expect(post).toHaveBeenCalledTimes(3))
  const retried = post.mock.calls[1][1] as { request_id: string }
  const next = post.mock.calls[2][1] as { request_id: string }
  expect(next.request_id).not.toBe(retried.request_id)
})

test('a successful legacy claim is not reported as failed when its balance refresh fails', async () => {
  vi.spyOn(api, 'get')
    .mockResolvedValueOnce({ data: { success: true, data: summary } })
    .mockRejectedValue(new Error('Refresh unavailable'))
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  const onClaimed = vi.fn(() => {
    throw new Error('Callback unavailable')
  })
  await renderRebate(onClaimed)
  await userEvent.click(
    screen.getByRole('button', { name: 'Claim rebate to balance' })
  )
  expect(
    await screen.findByText(
      'Rebate claimed successfully. Refresh the page to update your balance.'
    )
  ).toBeVisible()
  expect(
    screen.queryByText('Failed to claim referral rebate')
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Claim rebate to balance' })
  ).toBeDisabled()
  expect(post).toHaveBeenCalledTimes(1)
})
