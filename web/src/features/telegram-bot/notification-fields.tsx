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
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsSwitchField } from '@/features/system-settings/components/settings-form-layout'

import type { TelegramBotPreferences } from './types'

interface TelegramNotificationFieldsProps {
  value: TelegramBotPreferences
  onChange: (value: TelegramBotPreferences) => void
  disabled?: boolean
}

export function TelegramNotificationFields(
  props: TelegramNotificationFieldsProps
) {
  const { t } = useTranslation()
  const id = useId()
  const events = [
    { key: 'low_balance' as const, label: t('Low platform balance') },
    { key: 'topup' as const, label: t('Top-up credited') },
    { key: 'subscription' as const, label: t('Subscription activated') },
    { key: 'expiry' as const, label: t('Subscription expiring soon') },
    { key: 'group_ratio' as const, label: t('Group ratio changes') },
  ]

  return (
    <div className='min-w-0 divide-y'>
      <SettingsSwitchField
        controlId={`${id}-enabled`}
        label={t('Telegram notifications')}
        description={t(
          'Turning off notifications keeps bot commands available.'
        )}
        checked={props.value.enabled}
        disabled={props.disabled}
        onCheckedChange={(enabled) =>
          props.onChange({ ...props.value, enabled })
        }
      />
      <div className='grid gap-x-6 sm:grid-cols-2'>
        {events.map((event) => (
          <SettingsSwitchField
            key={event.key}
            controlId={`${id}-${event.key}`}
            label={event.label}
            checked={props.value[event.key]}
            disabled={props.disabled || !props.value.enabled}
            onCheckedChange={(checked) =>
              props.onChange({ ...props.value, [event.key]: checked })
            }
          />
        ))}
      </div>
    </div>
  )
}
