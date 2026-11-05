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
import { useQuery } from '@tanstack/react-query'

import { requireServerSuccess } from '@/lib/server-error-message'

import { getGroupHealth } from '../api'
import type { GroupHealthRange } from '../types'

/**
 * Group health for a range. The server caches each range for 60 seconds, so
 * refetching faster than that returns the same numbers. The page refreshes it
 * on its own countdown.
 */
export function useGroupHealth(range: GroupHealthRange, enabled = true) {
  return useQuery({
    queryKey: ['group-health', range],
    queryFn: async () => requireServerSuccess(await getGroupHealth(range)).data,
    enabled,
    placeholderData: (previous) => previous,
  })
}
