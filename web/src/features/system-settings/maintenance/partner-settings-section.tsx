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
import { zodResolver } from '@hookform/resolvers/zod'
import { Link } from '@tanstack/react-router'
import { useMemo } from 'react'
import type { Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

import { FormDirtyIndicator } from '../components/form-dirty-indicator'
import { FormNavigationGuard } from '../components/form-navigation-guard'
import {
  SettingsForm,
  SettingsFormGrid,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useSettingsForm } from '../hooks/use-settings-form'
import { useUpdateOption } from '../hooks/use-update-option'
import { safeNumberFieldProps } from '../utils/numeric-field'

// The server's ranges, so a bad value shows before it is saved.
const RANGES = {
  max_sites_per_user: { min: 1, max: 100 },
  max_offers_per_site: { min: 1, max: 50 },
  guest_hourly_limit: { min: 1, max: 100 },
} as const
const INTRO_LIMIT = 2000

type LimitName = keyof typeof RANGES

export type PartnerSettingsValues = {
  partner_setting: {
    max_sites_per_user: number
    max_offers_per_site: number
    guest_hourly_limit: number
    intro: string
  }
}

interface PartnerSettingsSectionProps {
  defaultValues: PartnerSettingsValues
}

/**
 * Limits of the supplier application page. Whether it is shown and whether
 * it needs a sign-in are set in the top navigation section.
 */
export function PartnerSettingsSection(props: PartnerSettingsSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const schema = useMemo(() => {
    const limit = (name: LimitName) =>
      z
        .number()
        .int(t('Enter a whole number from {{min}} to {{max}}', RANGES[name]))
        .min(
          RANGES[name].min,
          t('Enter a whole number from {{min}} to {{max}}', RANGES[name])
        )
        .max(
          RANGES[name].max,
          t('Enter a whole number from {{min}} to {{max}}', RANGES[name])
        )
    return z.object({
      partner_setting: z.object({
        max_sites_per_user: limit('max_sites_per_user'),
        max_offers_per_site: limit('max_offers_per_site'),
        guest_hourly_limit: limit('guest_hourly_limit'),
        intro: z
          .string()
          .max(INTRO_LIMIT, t('At most {{max}} characters', { max: INTRO_LIMIT })),
      }),
    })
  }, [t])

  const { form, handleSubmit, handleReset, isDirty, isSubmitting } =
    useSettingsForm<PartnerSettingsValues>({
      resolver: zodResolver(schema) as Resolver<
        PartnerSettingsValues,
        unknown,
        PartnerSettingsValues
      >,
      defaultValues: props.defaultValues,
      onSubmit: async (_data, changedFields) => {
        for (const [key, value] of Object.entries(changedFields)) {
          if (value === undefined || value === null) continue
          await updateOption.mutateAsync({ key, value: String(value) })
        }
      },
    })

  const saving = updateOption.isPending || isSubmitting

  const limitFields: { name: LimitName; label: string; description: string }[] =
    [
      {
        name: 'max_sites_per_user',
        label: t('Sites per signed-in user'),
        description: t('How many sites one signed-in user can submit in total.'),
      },
      {
        name: 'max_offers_per_site',
        label: t('Groups per site'),
        description: t('How many groups one submission can list.'),
      },
      {
        name: 'guest_hourly_limit',
        label: t('Visitor submissions per IP and hour'),
        description: t('Only applies when the page does not need a sign-in.'),
      },
    ]

  return (
    <>
      <FormNavigationGuard when={isDirty} />
      <SettingsSection title={t('Supplier application')}>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Other sites submit the groups and ratios they can supply; administrators compare them on the Supplier quotes page. Turn the page on and choose whether it needs a sign-in in'
          )}{' '}
          <Link
            to='/system-settings/site/$section'
            params={{ section: 'header-navigation' }}
            className='text-primary hover:underline'
          >
            {t('Header navigation')}
          </Link>
          .
        </p>
        <Form {...form}>
          <SettingsForm onSubmit={handleSubmit} autoComplete='off'>
            <SettingsPageFormActions
              onSave={handleSubmit}
              onReset={handleReset}
              isSaving={saving}
              isResetDisabled={!isDirty}
            />
            <FormDirtyIndicator isDirty={isDirty} />
            <SettingsFormGrid>
              {limitFields.map((item) => (
                <FormField
                  key={item.name}
                  control={form.control}
                  name={`partner_setting.${item.name}`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{item.label}</FormLabel>
                      <FormControl>
                        <Input
                          type='number'
                          min={RANGES[item.name].min}
                          max={RANGES[item.name].max}
                          step={1}
                          {...safeNumberFieldProps(field)}
                        />
                      </FormControl>
                      <FormDescription>{item.description}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </SettingsFormGrid>
            <FormField
              control={form.control}
              name='partner_setting.intro'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Page introduction')}</FormLabel>
                  <FormControl>
                    <Textarea rows={4} maxLength={INTRO_LIMIT} {...field} />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Shown at the top of the page as plain text. Leave empty for the default text.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsForm>
        </Form>
      </SettingsSection>
    </>
  )
}
