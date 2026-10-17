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
import { describe, expect, test } from 'vitest'

import {
  routeGroupsToApiKeyFields,
  transformFormDataToPayload,
  API_KEY_FORM_DEFAULT_VALUES,
} from '../api-key-form'

describe('routeGroupsToApiKeyFields', () => {
  test('saves one group as that fixed group', () => {
    expect(routeGroupsToApiKeyFields(['满血cc'])).toEqual({
      group: '满血cc',
      auto_groups_mode: 'inherit',
      auto_groups: [],
      cross_group_retry: false,
    })
  })

  test('saves two or more groups as an ordered Auto route', () => {
    const fields = routeGroupsToApiKeyFields(['满血cc', 'CCMAX'])
    expect(fields).toEqual({
      group: 'auto',
      auto_groups_mode: 'custom',
      auto_groups: ['满血cc', 'CCMAX'],
      cross_group_retry: true,
    })
    expect(
      transformFormDataToPayload({
        ...API_KEY_FORM_DEFAULT_VALUES,
        name: 'app',
        ...fields,
      })
    ).toMatchObject({
      group: 'auto',
      auto_groups: ['满血cc', 'CCMAX'],
      cross_group_retry: true,
    })
  })

  test('keeps an empty selection from becoming Auto', () => {
    expect(routeGroupsToApiKeyFields([])).toEqual({
      group: '',
      auto_groups_mode: 'inherit',
      auto_groups: [],
      cross_group_retry: false,
    })
  })

  test('collapses a repeated group back to one fixed group', () => {
    expect(routeGroupsToApiKeyFields(['满血cc', '满血cc'])).toMatchObject({
      group: '满血cc',
      auto_groups: [],
      cross_group_retry: false,
    })
  })
})
