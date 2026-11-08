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

const error = 'Invalid upstream rate configuration'
export const upstreamRateSourceSchema = z
  .object({
    id: z.string(),
    name: z.string().trim().min(1, error).max(80, error),
    base_url: z
      .string()
      .trim()
      .max(1024, error)
      .url(error)
      .refine((value) => {
        try {
          const url = new URL(value)
          return (
            url.protocol === 'https:' &&
            !url.username &&
            !url.password &&
            !value.includes('?') &&
            !value.includes('#') &&
            (!url.port || url.port === '443')
          )
        } catch {
          return false
        }
      }, error),
    token: z
      .string()
      .refine(
        (value) => value === '' || /^[\x21-\x7e]{32,4096}$/.test(value),
        error
      ),
    enabled: z.boolean(),
    poll_seconds: z
      .number({ error })
      .int(error)
      .min(30, error)
      .max(3600, error),
    scan_minutes: z.number({ error }).int(error).min(1, error).max(1440, error),
  })
  .refine((value) => value.id !== '' || value.token !== '', {
    path: ['token'],
    error,
  })

export type UpstreamRateSourceFormValues = z.infer<
  typeof upstreamRateSourceSchema
>
