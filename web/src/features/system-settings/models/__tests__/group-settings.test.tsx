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
import { zodResolver } from '@hookform/resolvers/zod'
import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { positiveIntegerSchema } from '../../utils/numeric-field'
import { GroupRatioForm } from '../group-ratio-form'

const defaults = {
  GroupRatio: '{"default":1,"vip":0.8}',
  TopupGroupRatio: '{"vip":1.2}',
  UserUsableGroups: '{"default":"Standard access","vip":"Premium access"}',
  GroupGroupRatio: '{}',
  AutoGroups: '["default","vip"]',
  MaxTokenAutoGroups: 5,
  DefaultUseAutoGroup: false,
  GroupSpecialUsableGroup: '{}',
  GroupPlatformMap: '',
  GroupBadgeConfig: '{"labels":[],"groups":{}}',
}

const schema = z.object({
  GroupRatio: z.string(),
  TopupGroupRatio: z.string(),
  UserUsableGroups: z.string(),
  GroupGroupRatio: z.string(),
  AutoGroups: z.string(),
  MaxTokenAutoGroups: positiveIntegerSchema('Enter a positive integer'),
  DefaultUseAutoGroup: z.boolean(),
  GroupSpecialUsableGroup: z.string(),
  GroupPlatformMap: z.string(),
  GroupBadgeConfig: z.string(),
})

function Fixture(props: {
  onSave?: (values: typeof defaults) => Promise<void>
  initial?: Partial<typeof defaults>
  isSaving?: boolean
}) {
  const [actions, setActions] = useState<HTMLDivElement | null>(null)
  const form = useForm({
    defaultValues: { ...defaults, ...props.initial },
    resolver: zodResolver(schema),
  })
  return (
    <SettingsPageProvider actionsContainer={actions}>
      <div ref={setActions} />
      <GroupRatioForm
        form={form}
        onSave={props.onSave ?? (async () => {})}
        isSaving={props.isSaving ?? false}
      />
    </SettingsPageProvider>
  )
}

describe('group settings workspace', () => {
  it.each([
    ['a', 'b'],
    ['b', 'a'],
  ])(
    'preserves both groups when renaming through a duplicate name in %s/%s order',
    async (first, second) => {
      const user = userEvent.setup()
      const onSave = vi.fn(async (_values: typeof defaults) => {})
      render(
        <Fixture
          onSave={onSave}
          initial={{
            GroupRatio: JSON.stringify(
              Object.fromEntries(
                [first, second].map((name) => [name, name === 'a' ? 1 : 0.8])
              )
            ),
            UserUsableGroups: '{"a":"First","b":"Second"}',
            TopupGroupRatio: '{"b":1.2}',
            GroupBadgeConfig:
              '{"labels":[{"id":"first","name":"First","icon":"shield","color":"teal"},{"id":"second","name":"Second","icon":"star","color":"amber"}],"groups":{"a":["first"],"b":["second"],"auto":["first"]}}',
          }}
        />
      )
      const input = screen.getByDisplayValue('b')
      const row = input.closest('tr')
      if (!row) throw new Error('Group row was not found')
      await user.clear(input)
      expect(
        screen.getByRole('button', { name: 'Save group settings' })
      ).toBeDisabled()
      await user.type(input, 'a')
      expect(
        screen.getAllByRole('textbox', { name: 'Group name' })
      ).toHaveLength(2)
      expect(
        screen.getByRole('button', { name: 'Save group settings' })
      ).toBeDisabled()
      expect(
        within(row).getByRole('button', { name: 'Edit labels for a' })
      ).toBeDisabled()
      expect(
        screen.getByRole('button', { name: 'Switch to JSON' })
      ).toBeDisabled()
      await user.type(input, 'bc')
      expect(input).toHaveValue('abc')
      await user.click(
        screen.getByRole('button', { name: 'Save group settings' })
      )
      await waitFor(() => expect(onSave).toHaveBeenCalled())
      const saved = onSave.mock.calls[0][0]
      expect(JSON.parse(saved.GroupRatio)).toEqual({ a: 1, abc: 0.8 })
      expect(JSON.parse(saved.TopupGroupRatio)).toEqual({ abc: 1.2 })
      expect(JSON.parse(saved.UserUsableGroups)).toEqual({
        a: 'First',
        abc: 'Second',
      })
      expect(JSON.parse(saved.GroupBadgeConfig).groups).toEqual({
        a: ['first'],
        abc: ['second'],
        auto: ['first'],
      })
    }
  )

  it('restores saving and editor switching after cancelling an invalid name draft', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    render(<Fixture onSave={onSave} />)
    const input = screen.getByDisplayValue('vip')
    await user.clear(input)
    await user.type(input, 'default')
    const save = screen.getByRole('button', { name: 'Save group settings' })
    expect(save).toBeDisabled()
    await user.click(save)
    expect(onSave).not.toHaveBeenCalled()
    await user.clear(input)
    await user.type(input, 'vip')
    expect(save).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Switch to JSON' })).toBeEnabled()
    await user.click(save)
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(JSON.parse(onSave.mock.calls[0][0].GroupRatio)).toEqual({
      default: 1,
      vip: 0.8,
    })
  })

  it('deletes only the committed group when its name draft duplicates another group', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    render(
      <Fixture
        onSave={onSave}
        initial={{
          GroupRatio: '{"a":1,"b":0.8}',
          UserUsableGroups: '{"a":"First","b":"Second"}',
          TopupGroupRatio: '{}',
          GroupBadgeConfig:
            '{"labels":[{"id":"first","name":"First","icon":"shield","color":"teal"},{"id":"second","name":"Second","icon":"star","color":"amber"}],"groups":{"a":["first"],"b":["second"],"auto":["first"]}}',
        }}
      />
    )
    const input = screen.getByDisplayValue('b')
    const row = input.closest('tr')
    if (!row) throw new Error('Group row was not found')
    await user.clear(input)
    await user.type(input, 'a')
    await user.click(within(row).getByRole('button', { name: 'Delete' }))
    await user.click(
      screen.getByRole('button', { name: 'Save group settings' })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(JSON.parse(onSave.mock.calls[0][0].GroupRatio)).toEqual({ a: 1 })
    expect(JSON.parse(onSave.mock.calls[0][0].GroupBadgeConfig).groups).toEqual(
      { a: ['first'], auto: ['first'] }
    )
  })

  it('creates and applies a custom label without crypto.randomUUID', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    const originalCrypto = globalThis.crypto
    vi.stubGlobal('crypto', {
      getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto),
      randomUUID: undefined,
    })
    try {
      render(<Fixture onSave={onSave} />)
      await user.click(
        screen.getByRole('button', { name: 'Edit labels for default' })
      )
      const dialog = screen.getByRole('dialog', { name: 'Group labels' })
      await user.type(
        within(dialog).getByRole('textbox', { name: 'Label name' }),
        'Custom'
      )
      await user.click(
        within(dialog).getByRole('button', { name: 'Create label' })
      )
      await user.click(
        within(dialog).getByRole('button', { name: 'Apply labels' })
      )
      await user.click(
        screen.getByRole('button', { name: 'Save group settings' })
      )
      await waitFor(() => expect(onSave).toHaveBeenCalled())
      const config = JSON.parse(onSave.mock.calls[0][0].GroupBadgeConfig)
      expect(config.labels).toHaveLength(1)
      expect(config.labels[0]).toEqual(
        expect.objectContaining({
          name: 'Custom',
          id: expect.stringMatching(/^[a-zA-Z0-9_-]{1,64}$/),
        })
      )
      expect(config.groups).toEqual({ default: [config.labels[0].id] })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('chooses presets, creates reusable labels, orders them and follows group renaming', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    render(<Fixture onSave={onSave} />)
    await user.click(
      screen.getByRole('button', { name: 'Edit labels for default' })
    )
    const dialog = screen.getByRole('dialog', { name: 'Group labels' })
    await user.click(within(dialog).getByRole('button', { name: 'Self-run' }))
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Label name' }),
      'Premium'
    )
    await user.click(
      within(dialog).getByRole('button', { name: 'Create label' })
    )
    await user.click(
      within(dialog).getByRole('button', { name: 'Move Premium up' })
    )
    const selected = within(dialog).getByRole('list', {
      name: 'Selected labels',
    })
    expect(within(selected).getAllByRole('listitem')[0]).toHaveTextContent(
      'Premium'
    )
    await user.click(
      within(dialog).getByRole('button', { name: 'Apply labels' })
    )
    await user.click(
      screen.getByRole('button', { name: 'Edit labels for vip' })
    )
    await user.click(screen.getByRole('button', { name: 'Premium' }))
    await user.click(screen.getByRole('button', { name: 'Apply labels' }))
    await user.clear(screen.getAllByRole('textbox', { name: 'Group name' })[0])
    await user.type(
      screen.getAllByRole('textbox', { name: 'Group name' })[0],
      'standard'
    )
    await user.click(
      screen.getByRole('button', { name: 'Save group settings' })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const config = JSON.parse(onSave.mock.calls[0][0].GroupBadgeConfig)
    const premium = config.labels.find(
      (label: { name: string }) => label.name === 'Premium'
    )
    expect(config.groups).toEqual({
      standard: [premium.id, 'self'],
      vip: [premium.id],
    })
    expect(config.labels).toHaveLength(2)
    expect(JSON.parse(onSave.mock.calls[0][0].GroupRatio)).toEqual({
      standard: 1,
      vip: 0.8,
    })
  })

  it('cancels pending label edits without saving a reusable label', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    render(<Fixture onSave={onSave} />)
    await user.click(
      screen.getByRole('button', { name: 'Edit labels for default' })
    )
    const dialog = screen.getByRole('dialog', { name: 'Group labels' })
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Label name' }),
      'Discarded'
    )
    await user.click(
      within(dialog).getByRole('button', { name: 'Create label' })
    )
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await user.click(
      screen.getByRole('button', { name: 'Save group settings' })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(JSON.parse(onSave.mock.calls[0][0].GroupBadgeConfig)).toEqual({
      labels: [],
      groups: {},
    })
  })

  it('keeps pricing and visibility JSON unchanged when only applying labels', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    const initial = {
      GroupRatio: '{ "default": 1, "vip": 0.8 }',
      TopupGroupRatio: '{ "vip": 1.2 }',
      UserUsableGroups:
        '{ "default": "Standard", "vip": "Premium", "extra": "Extra" }',
      GroupPlatformMap: '{ "default": "1" }',
    }
    render(<Fixture onSave={onSave} initial={initial} />)
    await user.click(
      screen.getByRole('button', { name: 'Edit labels for default' })
    )
    await user.click(screen.getByRole('button', { name: 'Self-run' }))
    await user.click(screen.getByRole('button', { name: 'Apply labels' }))
    await user.click(
      screen.getByRole('button', { name: 'Save group settings' })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining(initial))
    expect(JSON.parse(onSave.mock.calls[0][0].GroupBadgeConfig).groups).toEqual(
      { default: ['self'] }
    )
  })

  it('preserves an unchanged group identifier with surrounding spaces when applying labels', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    const initial = {
      GroupRatio: '{ " padded ": 1 }',
      UserUsableGroups: '{ " padded ": "Legacy group" }',
      TopupGroupRatio: '{}',
    }
    render(<Fixture onSave={onSave} initial={initial} />)
    expect(
      screen.getByRole('button', { name: 'Save group settings' })
    ).toBeEnabled()
    const edit = screen.getByRole('button', { name: /Edit labels for.*padded/ })
    expect(edit).toBeEnabled()
    expect(screen.getByRole('textbox', { name: 'Group name' })).toHaveValue(
      ' padded '
    )
    expect(screen.getByRole('textbox', { name: 'Group name' })).toHaveAttribute(
      'aria-invalid',
      'false'
    )
    await user.click(edit)
    await user.click(screen.getByRole('button', { name: 'Self-run' }))
    await user.click(screen.getByRole('button', { name: 'Apply labels' }))
    await user.click(
      screen.getByRole('button', { name: 'Save group settings' })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining(initial))
    expect(JSON.parse(onSave.mock.calls[0][0].GroupBadgeConfig).groups).toEqual(
      { ' padded ': ['self'] }
    )
  })

  it('preserves labels for groups outside the pricing table during ordinary pricing edits', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    const config =
      '{"labels":[{"id":"self","name":"Self-run","icon":"shield","color":"teal"}],"groups":{"default":["self"],"auto":["self"],"constructor":["self"]}}'
    render(<Fixture onSave={onSave} initial={{ GroupBadgeConfig: config }} />)
    fireEvent.change(screen.getAllByRole('spinbutton', { name: 'Ratio' })[0], {
      target: { value: '0.9' },
    })
    await user.click(
      screen.getByRole('button', { name: 'Save group settings' })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0].GroupBadgeConfig).toBe(config)
    expect(JSON.parse(onSave.mock.calls[0][0].GroupRatio).default).toBe(0.9)
  })

  it('rejects invalid label names and enforces the selection limit', async () => {
    const user = userEvent.setup()
    render(<Fixture />)
    await user.click(
      screen.getByRole('button', { name: 'Edit labels for default' })
    )
    const dialog = screen.getByRole('dialog', { name: 'Group labels' })
    const name = within(dialog).getByRole('textbox', { name: 'Label name' })
    fireEvent.change(name, { target: { value: 'bad\u007fname' } })
    await user.click(
      within(dialog).getByRole('button', { name: 'Create label' })
    )
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(
      within(dialog).queryByRole('list', { name: 'Selected labels' })
    ).not.toBeInTheDocument()
    await user.clear(name)
    await user.type(name, 'Premium')
    await user.click(
      within(dialog).getByRole('button', { name: 'Create label' })
    )
    for (const label of ['Self-run', 'Authentic', 'Guarantee']) {
      await user.click(within(dialog).getByRole('button', { name: label }))
    }
    expect(
      within(dialog).getByRole('button', { name: 'Create label' })
    ).toBeDisabled()
    expect(
      within(
        within(dialog).getByRole('list', { name: 'Selected labels' })
      ).getAllByRole('listitem')
    ).toHaveLength(4)
  })

  it('removes the deleted group mapping while retaining reusable labels', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    render(
      <Fixture
        onSave={onSave}
        initial={{
          GroupBadgeConfig:
            '{"labels":[{"id":"self","name":"Self-run","icon":"shield","color":"teal"}],"groups":{"default":["self"],"vip":["self"],"auto":["self"]}}',
        }}
      />
    )
    const row = screen.getByDisplayValue('default').closest('tr')
    if (!row) throw new Error('Default group row was not found')
    await user.click(within(row).getByRole('button', { name: 'Delete' }))
    await user.click(
      screen.getByRole('button', { name: 'Save group settings' })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const config = JSON.parse(onSave.mock.calls[0][0].GroupBadgeConfig)
    expect(config.groups).toEqual({ vip: ['self'], auto: ['self'] })
    expect(config.labels).toHaveLength(1)
  })

  it('blocks visual edits when the label config contains an unknown reference', () => {
    render(
      <Fixture
        initial={{
          GroupBadgeConfig: '{"labels":[],"groups":{"default":["missing"]}}',
        }}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Group label configuration is invalid.'
    )
    expect(screen.getByRole('button', { name: 'Add group' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Edit labels for default' })
    ).toBeDisabled()
  })

  it('filters by description and clears search without discarding edits', async () => {
    const user = userEvent.setup()
    render(<Fixture />)
    const search = screen.getByRole('textbox', {
      name: 'Search groups by name or description',
    })
    await user.type(search, 'PREMIUM')
    expect(screen.getAllByRole('textbox', { name: 'Group name' })).toHaveLength(
      1
    )
    expect(screen.getByRole('textbox', { name: 'Group name' })).toHaveValue(
      'vip'
    )
    await user.clear(screen.getByRole('spinbutton', { name: 'Ratio' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Ratio' }), '0.6')
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getAllByRole('textbox', { name: 'Group name' })).toHaveLength(
      2
    )
    expect(screen.getAllByRole('spinbutton', { name: 'Ratio' })[1]).toHaveValue(
      0.6
    )
    await user.type(search, 'missing')
    expect(screen.getByText('No results found')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Add group' }))
    expect(search).toHaveValue('')
    expect(
      screen
        .getAllByRole<HTMLInputElement>('textbox', { name: 'Group name' })
        .map((input) => input.value)
    ).toEqual(['group_1', 'default', 'vip'])
    expect(screen.getAllByRole('spinbutton', { name: 'Ratio' })[2]).toHaveValue(
      0.6
    )
  })

  it('prepends consecutive new groups and saves them without changing existing settings', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    render(<Fixture onSave={onSave} />)

    await user.click(screen.getByRole('button', { name: 'Add group' }))
    await user.click(screen.getByRole('button', { name: 'Add group' }))
    expect(
      screen
        .getAllByRole<HTMLInputElement>('textbox', { name: 'Group name' })
        .map((input) => input.value)
    ).toEqual(['group_2', 'group_1', 'default', 'vip'])

    await user.click(
      screen.getByRole('button', { name: 'Save group settings' })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const saved = onSave.mock.calls[0][0]
    expect(JSON.parse(saved.GroupRatio)).toEqual({
      group_2: 1,
      group_1: 1,
      default: 1,
      vip: 0.8,
    })
    expect(JSON.parse(saved.UserUsableGroups)).toEqual({
      group_2: '',
      group_1: '',
      default: 'Standard access',
      vip: 'Premium access',
    })
    expect(JSON.parse(saved.TopupGroupRatio)).toEqual({ vip: 1.2 })
    expect(saved.AutoGroups).toBe(defaults.AutoGroups)
  })

  it('keeps unfinished visibility rules while switching sections and supports keyboard tabs', async () => {
    const user = userEvent.setup()
    render(
      <Fixture
        initial={{
          GroupSpecialUsableGroup: '{"vip":{"+:default":"Standard"}}',
        }}
      />
    )
    const pricing = screen.getByRole('tab', { name: 'Pricing groups' })
    pricing.focus()
    await user.keyboard('{ArrowRight}{Enter}')
    expect(
      screen.getByRole('tab', { name: 'Special ratio rules' })
    ).toHaveAttribute('aria-selected', 'true')
    expect(
      screen.queryByRole('table', { name: 'Pricing groups' })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Group visibility' }))
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(
      screen.getAllByRole('combobox', { name: 'Group name' })
    ).toHaveLength(2)
    await user.click(pricing)
    await user.click(screen.getByRole('tab', { name: 'Group visibility' }))
    expect(
      screen.getAllByRole('combobox', { name: 'Group name' })
    ).toHaveLength(2)
    const toggle = screen.getByRole('button', { name: 'Rules for vip' })
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })

  it('reorders and removes auto groups with named controls and saves across sections', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    render(<Fixture onSave={onSave} />)
    await user.click(screen.getByRole('tab', { name: 'Auto group order' }))
    const list = screen.getByRole('list', { name: 'Auto group order' })
    expect(
      screen.getByRole('button', { name: 'Move default up' })
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move vip down' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Move vip up' }))
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('vip')
    await user.click(
      screen.getByRole('switch', { name: 'Default to auto groups' })
    )
    await user.click(screen.getByRole('button', { name: 'Remove default' }))
    expect(screen.getByRole('button', { name: 'Move vip up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move vip down' })).toBeDisabled()
    await user.click(screen.getByRole('tab', { name: 'Pricing groups' }))
    await user.click(
      screen.getByRole('button', { name: 'Save group settings' })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        AutoGroups: '[\n  "vip"\n]',
        DefaultUseAutoGroup: true,
      })
    )
  })

  it('reorders from the drag handle with arrow keys, preserves unknown groups and saves the new order', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    render(
      <Fixture
        onSave={onSave}
        initial={{
          AutoGroups: '["default","vip","retired"]',
          MaxTokenAutoGroups: 1,
        }}
      />
    )
    await user.click(screen.getByRole('tab', { name: 'Auto group order' }))
    const list = screen.getByRole('list', { name: 'Auto group order' })
    const handle = screen.getByRole('button', {
      name: 'Drag default to reorder',
    })
    handle.focus()
    await user.keyboard('{ArrowUp}')
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(
      'default'
    )
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    expect(within(list).getAllByRole('listitem')[2]).toHaveTextContent(
      'default'
    )
    expect(handle).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent(
      'default'
    )
    expect(screen.getByText('Not in pricing table')).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Pricing groups' }))
    await user.click(
      screen.getByRole('button', { name: 'Save group settings' })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(JSON.parse(onSave.mock.calls[0][0].AutoGroups)).toEqual([
      'vip',
      'default',
      'retired',
    ])
  })

  it('keeps a single auto group unchanged when using its drag handle keyboard controls', async () => {
    const user = userEvent.setup()
    render(<Fixture initial={{ AutoGroups: '["default"]' }} />)
    await user.click(screen.getByRole('tab', { name: 'Auto group order' }))
    const handle = screen.getByRole('button', {
      name: 'Drag default to reorder',
    })
    handle.focus()
    await user.keyboard('{ArrowUp}{ArrowDown}')
    const list = screen.getByRole('list', { name: 'Auto group order' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByRole('listitem')).toHaveTextContent('default')
    expect(handle).toHaveFocus()
    expect(
      screen.getByRole('button', { name: 'Move default up' })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Move default down' })
    ).toBeDisabled()
  })

  it('opens the auto section and focuses its invalid limit when saving from another section', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    render(<Fixture onSave={onSave} />)
    await user.click(screen.getByRole('tab', { name: 'Auto group order' }))
    fireEvent.change(
      screen.getByRole('spinbutton', {
        name: 'Maximum custom groups per token',
      }),
      { target: { value: '0' } }
    )
    await user.click(screen.getByRole('tab', { name: 'Pricing groups' }))
    await user.click(
      screen.getByRole('button', { name: 'Save group settings' })
    )
    await waitFor(() =>
      expect(
        screen.getByRole('tab', { name: 'Auto group order' })
      ).toHaveAttribute('aria-selected', 'true')
    )
    const input = screen.getByRole('spinbutton', {
      name: 'Maximum custom groups per token',
    })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(input).toHaveFocus())
    expect(screen.getByText('Enter a positive integer')).toBeVisible()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('shows empty state guidance and disables save during a pending request', async () => {
    const user = userEvent.setup()
    render(
      <Fixture
        isSaving
        initial={{
          GroupRatio: '{}',
          TopupGroupRatio: '{}',
          UserUsableGroups: '{}',
          AutoGroups: '[]',
        }}
      />
    )
    expect(
      screen.getByText('No groups yet. Add a group to get started.')
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled()
    await user.click(screen.getByRole('tab', { name: 'Special ratio rules' }))
    expect(
      screen.getByText('Base group ratios apply until you add an override.')
    ).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Auto group order' }))
    expect(screen.getByText('No auto groups configured')).toBeVisible()
  })

  it('preserves pricing edits when switching between visual and JSON editors', async () => {
    const user = userEvent.setup()
    render(<Fixture />)
    await user.clear(
      screen.getAllByRole('textbox', { name: 'Group description' })[1]
    )
    await user.type(
      screen.getAllByRole('textbox', { name: 'Group description' })[1],
      'Updated description'
    )
    await user.click(screen.getByRole('button', { name: 'Switch to JSON' }))
    await user.click(screen.getByRole('button', { name: 'Switch to Visual' }))
    expect(
      screen.getAllByRole('textbox', { name: 'Group description' })[1]
    ).toHaveValue('Updated description')
  })
})
