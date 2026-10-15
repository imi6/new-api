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

export type ApiKeyGroupSectionOption = {
  value: string
  label: string
}

export type ApiKeyGroupSection<T extends ApiKeyGroupSectionOption> = {
  id: string
  title: string | null
  options: Array<T & { itemLabel: string }>
}

const FAMILY_SEPARATOR = /[\s/|｜·・\-—]/

function sharedFamily(leftRaw: string, rightRaw: string): string {
  const left = leftRaw.trim()
  const right = rightRaw.trim()
  if (!left || !right || left === right) return ''

  let index = 0
  const limit = Math.min(left.length, right.length)
  while (index < limit && left[index] === right[index]) index += 1
  if (index === 0) return ''

  const slice = left.slice(0, index)
  let boundary = -1
  for (let cursor = slice.length - 1; cursor >= 0; cursor -= 1) {
    if (FAMILY_SEPARATOR.test(slice[cursor])) {
      boundary = cursor
      break
    }
  }
  if (boundary <= 0) return ''

  const prefix = left.slice(0, boundary).trim()
  if (prefix.length < 2) return ''
  const restLeft = stripFamilyLead(left.slice(prefix.length))
  const restRight = stripFamilyLead(right.slice(prefix.length))
  if (!restLeft || !restRight) return ''
  return prefix
}

function stripFamilyLead(value: string): string {
  return value.replace(/^[\s/|｜·・\-—]+/, '').trim()
}

function familyAt(index: number, labels: string[]): string {
  let best = ''
  for (let other = 0; other < labels.length; other += 1) {
    if (other === index) continue
    const prefix = sharedFamily(labels[index], labels[other])
    if (prefix.length > best.length) best = prefix
  }
  return best
}

export function groupApiKeyOptions<T extends ApiKeyGroupSectionOption>(
  options: T[]
): Array<ApiKeyGroupSection<T>> {
  const grouped = options.filter((option) => option.value !== 'auto')
  const labels = grouped.map((option) => option.label.trim())
  const families = labels.map((_, index) => familyAt(index, labels))
  const familyCounts = new Map<string, number>()
  for (const family of families) {
    if (!family) continue
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1)
  }

  const emittedFamilies = new Set<string>()
  const sections: Array<ApiKeyGroupSection<T>> = []

  for (const option of options) {
    if (option.value === 'auto') {
      sections.push({
        id: 'auto',
        title: null,
        options: [{ ...option, itemLabel: option.label }],
      })
      continue
    }

    const index = grouped.indexOf(option)
    const family = families[index] ?? ''
    const familyCount = familyCounts.get(family) ?? 0
    if (!family || familyCount < 2) {
      sections.push({
        id: `single:${option.value}`,
        title: null,
        options: [{ ...option, itemLabel: option.label }],
      })
      continue
    }

    if (emittedFamilies.has(family)) continue
    emittedFamilies.add(family)
    const members = grouped.filter(
      (_, memberIndex) => families[memberIndex] === family
    )
    sections.push({
      id: `family:${family}`,
      title: family,
      options: members.map((member) => {
        const label = member.label.trim()
        const itemLabel = stripFamilyLead(label.slice(family.length)) || label
        return { ...member, itemLabel }
      }),
    })
  }

  return sections
}
