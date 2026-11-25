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
import { useTranslation } from 'react-i18next'

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import type { ApiKeyEndpoint } from '../hooks/use-api-key-endpoints'

export function ApiEndpointSelect(props: {
  id: string
  endpoints: ApiKeyEndpoint[]
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const selected = props.endpoints.find(
    (endpoint) => endpoint.url === props.value
  )

  return (
    <div className='flex min-w-0 flex-col gap-2'>
      <Label htmlFor={props.id}>{t('API Node')}</Label>
      <Select
        value={props.value}
        onValueChange={(value) => {
          if (value) props.onValueChange(value)
        }}
        disabled={props.disabled}
      >
        <SelectTrigger
          id={props.id}
          aria-label={t('API Node')}
          className='w-full'
        >
          <SelectValue placeholder={t('Select an API node')}>
            {selected?.route}
          </SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {props.endpoints.map((endpoint) => (
              <SelectItem key={endpoint.url} value={endpoint.url}>
                <span className='flex min-w-0 flex-col gap-0.5'>
                  <span className='break-words'>{endpoint.route}</span>
                  <span className='text-muted-foreground text-xs break-all'>
                    {endpoint.url}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {selected && (
        <div className='text-muted-foreground flex min-w-0 flex-col gap-1 text-xs'>
          <code className='break-all select-text'>{selected.url}</code>
          {selected.description && (
            <p className='break-words'>{selected.description}</p>
          )}
        </div>
      )}
    </div>
  )
}
