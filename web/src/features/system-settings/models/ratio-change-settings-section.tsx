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
import { useEffect, useMemo, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
import { Switch } from '@/components/ui/switch'

import {
  SettingsForm,
  SettingsFormGrid,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import { safeNumberFieldProps } from '../utils/numeric-field'

const PREFIX = 'ratio_change_setting.'
const MIN_DAYS = 1
const MAX_DAYS = 30

type RatioChangeValues = {
  enabled: boolean
  days: number
}

interface RatioChangeSettingsSectionProps {
  defaultValues: RatioChangeValues
}

/**
 * Whether users see a mark next to a group ratio an administrator changed
 * recently, or on a new group, and for how many days.
 */
export function RatioChangeSettingsSection(
  props: RatioChangeSettingsSectionProps
) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const schema = useMemo(
    () =>
      z.object({
        enabled: z.boolean(),
        days: z
          .number()
          .int(t('Enter a whole number from 1 to 30'))
          .min(MIN_DAYS, t('Enter a whole number from 1 to 30'))
          .max(MAX_DAYS, t('Enter a whole number from 1 to 30')),
      }),
    [t]
  )
  // The page passes a new object on every render; reset only on new values.
  const savedEnabled = props.defaultValues.enabled
  const savedDays = props.defaultValues.days
  const formDefaults = useMemo<RatioChangeValues>(
    () => ({ enabled: savedEnabled, days: savedDays }),
    [savedEnabled, savedDays]
  )
  const savedRef = useRef<RatioChangeValues>(formDefaults)
  const form = useForm<RatioChangeValues>({
    resolver: zodResolver(schema),
    defaultValues: formDefaults,
  })
  useEffect(() => {
    savedRef.current = formDefaults
    form.reset(formDefaults)
  }, [formDefaults, form])

  const { isDirty, isSubmitting } = form.formState
  const saving = updateOption.isPending || isSubmitting

  const onSubmit = async (values: RatioChangeValues) => {
    const fields = Object.keys(values) as Array<keyof RatioChangeValues>
    const updates = fields
      .filter((field) => values[field] !== savedRef.current[field])
      .map((field) => ({ key: PREFIX + field, value: String(values[field]) }))
    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }
    for (const update of updates) {
      await updateOption.mutateAsync(update)
    }
    savedRef.current = values
    form.reset(values)
  }

  return (
    <SettingsSection title={t('Ratio change notice')}>
      <p className='text-muted-foreground text-sm'>
        {t(
          'When a group ratio is saved with a new value, users see by how much it changed next to the ratio, when creating a key, on the pricing page and on the channel status page.'
        )}
      </p>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)} autoComplete='off'>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            onReset={() => form.reset(savedRef.current)}
            isSaving={saving}
            isResetDisabled={!isDirty}
          />
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Show ratio changes')}</FormLabel>
                  <FormDescription>
                    {t(
                      'A cheaper ratio is marked green with a down arrow, a dearer one orange with an up arrow, and a new group with New. Users with a special ratio for a group see no mark on it.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={saving}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />
          <SettingsFormGrid>
            <FormField
              control={form.control}
              name='days'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Days a change stays marked')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={MIN_DAYS}
                      max={MAX_DAYS}
                      step={1}
                      {...safeNumberFieldProps(field)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Several changes in this time show as one: from the ratio before the first to the ratio now. Changes before this feature was added are not known.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsFormGrid>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
