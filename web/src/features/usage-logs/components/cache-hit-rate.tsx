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

import { StatusBadge } from '@/components/status-badge'
import { toIntlLocale } from '@/i18n/languages'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { getLogCacheHitRate } from '../lib/cache-hit-rate'
import type { LogOtherData } from '../types'

export function CacheHitRate(props: {
  promptTokens: number
  other?: LogOtherData | null
}) {
  const { t, i18n } = useTranslation()
  const visible = useSystemConfigStore(
    (state) => state.config.logCacheHitRateEnabled !== false
  )
  const rate = getLogCacheHitRate(props.promptTokens, props.other)
  if (!visible || rate === null) return null

  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  // 公共格式化工具不支持固定一位小数，百分比在这里按界面语言格式化。
  const percentage = new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(rate)

  return (
    <div className='flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px]'>
      <span className='text-muted-foreground'>{t('Cache hit rate')}</span>
      <StatusBadge
        label={percentage}
        variant='orange'
        type='badge'
        copyable={false}
        className='h-5 rounded-md border border-orange-200 bg-orange-50 px-1.5 font-mono text-[11px] font-semibold text-orange-700 tabular-nums dark:border-orange-500/35 dark:bg-orange-500/10 dark:text-orange-300'
      />
    </div>
  )
}
