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

import { getGroupRatios } from '../api'

// Stable while loading, so memoized table columns are not rebuilt each render.
const NO_RATIOS: Record<string, number> = {}

/**
 * Each group's own ratio, shown beside the group names of a channel. The
 * table and the card view share one request through the query cache.
 */
export function useGroupRatios(): Record<string, number> {
  const { data } = useQuery({
    queryKey: ['group-ratios'],
    queryFn: getGroupRatios,
    staleTime: 60_000,
  })
  return data ?? NO_RATIOS
}
