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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import { ModelGroupSelector } from '../../model-group-selector'

test('shows group labels in the playground selector and keeps original group values', async () => {
  const user = userEvent.setup()
  const onGroupChange = vi.fn()
  render(
    <ModelGroupSelector
      models={[{ value: 'gpt-model', label: 'GPT Model' }]}
      selectedModel='gpt-model'
      onModelChange={vi.fn()}
      groups={[
        {
          value: 'primary',
          label: 'primary',
          badges: [{ id: 'self', name: '自营', icon: 'shield', color: 'teal' }],
        },
        {
          value: 'secondary',
          label: 'secondary',
          badges: [
            {
              id: 'genuine',
              name: '保真',
              icon: 'badge-check',
              color: 'amber',
            },
          ],
        },
      ]}
      selectedGroup='primary'
      onGroupChange={onGroupChange}
    />
  )
  const trigger = screen.getByRole('combobox')
  expect(within(trigger).getByText('自营')).toBeInTheDocument()
  expect(within(trigger).getByText('primary')).toBeInTheDocument()
  await user.click(trigger)
  const option = await screen.findByRole('button', { name: /保真secondary/ })
  expect(within(option).getByText('保真')).toBeVisible()
  await user.click(option)
  expect(onGroupChange).toHaveBeenCalledWith('secondary')
})

test('keeps a compact selected label summary and shows all long labels in the group list', async () => {
  const user = userEvent.setup()
  const labelNames = [
    '自定义标签最长十二字一号',
    '自定义标签最长十二字二号',
    '自定义标签最长十二字三号',
    '自定义标签最长十二字四号',
  ]
  const group = 'provider-original-group'
  const { rerender } = render(
    <ModelGroupSelector
      models={[{ value: 'gpt-model', label: 'GPT Model' }]}
      selectedModel='gpt-model'
      onModelChange={vi.fn()}
      groups={[
        {
          value: group,
          label: group,
          badges: labelNames.map((name, index) => ({
            id: `custom-${index}`,
            name,
            icon: 'shield' as const,
            color: 'teal' as const,
          })),
        },
      ]}
      selectedGroup={group}
      onGroupChange={vi.fn()}
    />
  )
  const trigger = screen.getByRole('combobox')
  expect(within(trigger).getByText(labelNames[0])).toHaveAttribute(
    'title',
    labelNames[0]
  )
  expect(within(trigger).getByText('+3')).toHaveAttribute(
    'title',
    labelNames.slice(1).join(', ')
  )
  expect(within(trigger).queryByText(labelNames[1])).not.toBeInTheDocument()
  expect(within(trigger).getByText(group)).toHaveAttribute('title', group)
  await user.click(trigger)
  const option = await screen.findByRole('button', {
    name: new RegExp(group),
  })
  for (const name of labelNames) {
    expect(within(option).getByText(name)).toHaveAttribute('title', name)
  }
  await user.click(trigger)
  rerender(
    <ModelGroupSelector
      models={[{ value: 'gpt-model', label: 'GPT Model' }]}
      selectedModel='gpt-model'
      onModelChange={vi.fn()}
      groups={[{ value: group, label: group }]}
      selectedGroup={group}
      onGroupChange={vi.fn()}
    />
  )
  expect(within(screen.getByRole('combobox')).getByText(group)).toBeVisible()
  expect(
    within(screen.getByRole('combobox')).queryByText('+3')
  ).not.toBeInTheDocument()
})
