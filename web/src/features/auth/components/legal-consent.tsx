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
import { Info } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

import type { SystemStatus } from '../types'

interface LegalConsentProps {
  status: SystemStatus | null
  checked: boolean
  onCheckedChange: (nextValue: boolean) => void
  className?: string
}

export function LegalConsent({
  status,
  checked,
  onCheckedChange,
  className,
}: LegalConsentProps) {
  const { t } = useTranslation()
  const hintId = useId()
  const hasUserAgreement = Boolean(status?.user_agreement_enabled)
  const hasPrivacyPolicy = Boolean(status?.privacy_policy_enabled)

  if (!hasUserAgreement && !hasPrivacyPolicy) {
    return null
  }

  const handleChange = (value: boolean) => {
    onCheckedChange(value === true)
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border px-3 py-2.5 transition-colors',
        checked
          ? 'border-primary/30 bg-primary/5'
          : 'border-amber-300/70 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-950/20',
        className
      )}
    >
      {!checked && (
        <p
          id={hintId}
          className='flex items-center gap-1.5 text-xs leading-5 text-amber-700 dark:text-amber-300'
        >
          <Info className='size-3.5 shrink-0' aria-hidden='true' />
          {t('Check the box below before you can continue.')}
        </p>
      )}
      <div className='flex items-start gap-3'>
        <Checkbox
          id='legal-consent'
          checked={checked}
          onCheckedChange={handleChange}
          aria-describedby={checked ? undefined : hintId}
          className='mt-0.5'
        />
        <Label
          htmlFor='legal-consent'
          className='text-muted-foreground items-start gap-1 text-left text-xs leading-5 font-normal'
        >
          <span>
            {t('I have read and agree to the')}{' '}
            {hasUserAgreement && (
              <a
                href='/user-agreement'
                target='_blank'
                rel='noopener noreferrer'
                className='text-primary font-medium hover:underline'
              >
                {t('User Agreement')}
              </a>
            )}
            {hasUserAgreement && hasPrivacyPolicy && ` ${t('and the')} `}
            {hasPrivacyPolicy && (
              <a
                href='/privacy-policy'
                target='_blank'
                rel='noopener noreferrer'
                className='text-primary font-medium hover:underline'
              >
                {t('Privacy Policy')}
              </a>
            )}
            .
          </span>
        </Label>
      </div>
    </div>
  )
}
