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
export const GROUP_LABEL_ICONS = [
  'none',
  'shield',
  'badge-check',
  'award',
  'sparkles',
  'star',
  'zap',
  'heart',
] as const

export const GROUP_LABEL_COLORS = [
  'teal',
  'amber',
  'violet',
  'blue',
  'green',
  'red',
  'slate',
] as const

export const MAX_GROUP_LABELS = 4
export const MAX_GROUP_LABEL_NAME_LENGTH = 12
export const MAX_GROUP_LABEL_CATALOG = 64

export type GroupLabelIcon = (typeof GROUP_LABEL_ICONS)[number]
export type GroupLabelColor = (typeof GROUP_LABEL_COLORS)[number]

export interface GroupLabel {
  id: string
  name: string
  icon: GroupLabelIcon
  color: GroupLabelColor
}

export interface GroupLabelConfig {
  labels: GroupLabel[]
  groups: Record<string, string[]>
}

export function isGroupLabel(value: unknown): value is GroupLabel {
  if (!value || typeof value !== 'object') return false
  const label = value as Partial<GroupLabel>
  return (
    typeof label.id === 'string' &&
    /^[a-zA-Z0-9_-]{1,64}$/.test(label.id) &&
    typeof label.name === 'string' &&
    label.name.trim().length > 0 &&
    label.name === label.name.trim() &&
    !/\p{Cc}/u.test(label.name) &&
    [...label.name].length <= MAX_GROUP_LABEL_NAME_LENGTH &&
    GROUP_LABEL_ICONS.includes(label.icon as GroupLabelIcon) &&
    GROUP_LABEL_COLORS.includes(label.color as GroupLabelColor)
  )
}

export function isGroupLabelConfig(value: unknown): value is GroupLabelConfig {
  if (!value || typeof value !== 'object') return false
  const parsed = value as GroupLabelConfig
  if (
    !Array.isArray(parsed.labels) ||
    parsed.labels.length > MAX_GROUP_LABEL_CATALOG ||
    !parsed.labels.every(isGroupLabel) ||
    !parsed.groups ||
    Array.isArray(parsed.groups) ||
    typeof parsed.groups !== 'object' ||
    Object.keys(parsed.groups).length > 10000
  ) {
    return false
  }
  const ids = new Set(parsed.labels.map((label) => label.id))
  if (ids.size !== parsed.labels.length) return false
  for (const [group, selected] of Object.entries(parsed.groups)) {
    if (
      !group.trim() ||
      [...group].length > 255 ||
      /\p{Cc}/u.test(group) ||
      !Array.isArray(selected) ||
      selected.length > MAX_GROUP_LABELS ||
      new Set(selected).size !== selected.length ||
      selected.some((id) => typeof id !== 'string' || !ids.has(id))
    ) {
      return false
    }
  }
  return true
}

export function parseGroupLabelConfig(value: string): GroupLabelConfig {
  const fallback: GroupLabelConfig = { labels: [], groups: {} }
  if (!value.trim()) return fallback
  try {
    const parsed: unknown = JSON.parse(value)
    return isGroupLabelConfig(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}
