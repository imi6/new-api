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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'

import { formatQuota } from '@/lib/format'

import { AffiliateRebateGuide } from '../components/affiliate-rebate-guide'

it('opens the rules without a rebate summary and returns keyboard focus on Escape', async () => {
  const user = userEvent.setup()
  render(<AffiliateRebateGuide summary={null} />)

  const trigger = screen.getByRole('button', { name: 'Rebate rules' })
  await user.tab()
  expect(trigger).toHaveFocus()
  await user.keyboard('{Enter}')

  const dialog = await screen.findByRole('dialog', { name: 'Rebate rules' })
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(
    within(dialog).getByRole('heading', { name: 'How invitations work' })
  ).toBeVisible()
  expect(
    within(dialog).getByRole('heading', {
      name: 'Why usage may earn no rebate',
    })
  ).toBeVisible()
  expect(
    within(dialog).getByRole('heading', { name: 'Claiming your rebate' })
  ).toBeVisible()
  expect(
    within(dialog).queryByText('Invitee paid-usage threshold')
  ).not.toBeInTheDocument()

  await user.keyboard('{Escape}')
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
})

it('shows the current invitee and inviter thresholds when the rebate summary loads', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<AffiliateRebateGuide summary={null} />)
  await user.click(screen.getByRole('button', { name: 'Rebate rules' }))
  const dialog = await screen.findByRole('dialog', { name: 'Rebate rules' })

  rerender(
    <AffiliateRebateGuide
      summary={{
        downstream_threshold: 6_250_000,
        upstream_minimum: 20_000_000,
      }}
    />
  )

  expect(within(dialog).getByText('Invitee paid-usage threshold')).toBeVisible()
  expect(within(dialog).getByText(formatQuota(6_250_000))).toBeVisible()
  expect(
    within(dialog).getByText('Your paid-usage threshold to claim')
  ).toBeVisible()
  expect(within(dialog).getByText(formatQuota(20_000_000))).toBeVisible()
})
