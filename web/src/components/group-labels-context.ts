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
import { createContext, useContext } from 'react'

import type { GroupLabel } from '@/lib/group-labels'

// 页面将现有请求结果注入，列表单元格仅消费数据，不额外发送请求。
export const GroupLabelsContext = createContext<Record<string, GroupLabel[]>>(
  {}
)

export function useGroupLabels(
  group?: string | null
): GroupLabel[] | undefined {
  const labels = useContext(GroupLabelsContext)
  return group && Object.hasOwn(labels, group) ? labels[group] : undefined
}
