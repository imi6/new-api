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
import { z } from 'zod'

import type { UpstreamRateConversionRule } from '../types'

export const upstreamRateConversionSchema = z.object({
  site_key: z.string().min(1, 'Choose an upstream site'),
  channel: z.string(),
  group: z.string(),
  factor: z
    .number({ error: 'Enter a conversion factor between 0.000001 and 1000000' })
    .min(0.000001, 'Enter a conversion factor between 0.000001 and 1000000')
    .max(1000000, 'Enter a conversion factor between 0.000001 and 1000000'),
})

export type UpstreamRateConversionFormValues = z.infer<
  typeof upstreamRateConversionSchema
>

export function upstreamRateConversionSiteKey(site: {
  source_id: string
  site_url: string
}): string {
  return JSON.stringify([site.source_id, site.site_url])
}

export function upstreamRateConversionGroupKey(group: {
  id: number
  name: string
}): string {
  return group.id > 0 ? `id:${group.id}` : `name:${group.name}`
}

export function upstreamRateConversionRuleKey(
  rule: UpstreamRateConversionRule
): string {
  const group = upstreamRateConversionGroupKey({
    id: rule.group_id ?? 0,
    name: rule.group_name ?? '',
  })
  return JSON.stringify([
    rule.source_id,
    rule.site_url,
    rule.upstream_channel_id ?? 0,
    group,
  ])
}
