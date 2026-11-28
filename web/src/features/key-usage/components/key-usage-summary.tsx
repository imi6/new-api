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

import { CopyButton } from '@/components/copy-button'
import { StatusBadge } from '@/components/status-badge'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { API_KEY_STATUSES } from '@/features/keys/constants'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatTimestampToDate } from '@/lib/format'
import { useSystemConfigStore } from '@/stores/system-config-store'

import type { KeyUsageToken } from '../api'

export function KeyUsageSummary(props: { token: KeyUsageToken }) {
  const { t, i18n } = useTranslation()
  // 公开页首次加载系统设置后，重新应用站点额度单位。
  useSystemConfigStore((state) => state.config?.currency)
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const status = API_KEY_STATUSES[props.token.status]
  const statusLabel = status ? t(status.label) : t('Unknown')
  const unlimited = t('Unlimited')
  const options = { locale, abbreviate: false }
  const summary = [
    {
      label: t('Total Quota'),
      value: props.token.unlimited_quota
        ? unlimited
        : formatQuotaWithCurrency(props.token.total_granted, options),
    },
    {
      label: t('Used Quota'),
      value: formatQuotaWithCurrency(props.token.total_used, options),
    },
    {
      label: t('Remaining quota'),
      value: props.token.unlimited_quota
        ? unlimited
        : formatQuotaWithCurrency(props.token.total_available, options),
    },
    {
      label: t('Expires at'),
      value:
        props.token.expires_at > 0
          ? formatTimestampToDate(props.token.expires_at)
          : t('Never'),
    },
  ]
  const copySummary = [
    ...summary.map((item) => `${item.label} ${item.value}`),
    `${t('Status')} ${statusLabel}`,
  ].join('\n')

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('Key information')}</h2>
        </CardTitle>
        <CardAction>
          <CopyButton
            value={copySummary}
            aria-label={t('Copy summary')}
            variant='outline'
            size='sm'
            notify
          >
            {t('Copy summary')}
          </CopyButton>
        </CardAction>
      </CardHeader>
      <CardContent>
        <dl className='bg-muted/35 grid grid-cols-2 gap-4 rounded-lg px-4 py-3 sm:grid-cols-3 xl:grid-cols-5'>
          {summary.map((item) => (
            <div key={item.label} className='min-w-0 space-y-1'>
              <dt className='text-muted-foreground text-xs'>{item.label}</dt>
              <dd className='font-medium wrap-anywhere tabular-nums'>
                {item.value}
              </dd>
            </div>
          ))}
          <div className='space-y-1'>
            <dt className='text-muted-foreground text-xs'>{t('Status')}</dt>
            <dd>
              <StatusBadge
                label={statusLabel}
                variant={status?.variant ?? 'neutral'}
              />
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}
