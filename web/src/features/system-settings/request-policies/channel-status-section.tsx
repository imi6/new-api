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
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import { safeNumberFieldProps } from '../utils/numeric-field'
import { clearChannelStatusCache } from './api'
import type { ChannelStatusSettings } from './defaults'
import { type ClearQuickPick, RecordsClear } from './records-clear'

const PREFIX = 'channel_status_setting.'
const MIN_MINUTES = 5
const MAX_MINUTES = 1440

// The counts are kept for at most a day, so the picks stay within one.
const CACHE_CLEAR_PICKS: readonly ClearQuickPick[] = [
  { labelKey: '10 minutes ago', minutes: 10 },
  { labelKey: '30 minutes ago', minutes: 30 },
  { labelKey: '1 hour ago', minutes: 60 },
]

type ChannelStatusValues = {
  cache_hit_rate_enabled: boolean
  cache_hit_rate_minutes: number
}

interface ChannelStatusSectionProps {
  defaultValues: ChannelStatusSettings
}

/** Display options of the public channel status page. */
export function ChannelStatusSection(props: ChannelStatusSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const schema = useMemo(
    () =>
      z.object({
        cache_hit_rate_enabled: z.boolean(),
        cache_hit_rate_minutes: z
          .number()
          .int(t('Enter a whole number from 5 to 1440'))
          .min(MIN_MINUTES, t('Enter a whole number from 5 to 1440'))
          .max(MAX_MINUTES, t('Enter a whole number from 5 to 1440')),
      }),
    [t]
  )
  const formDefaults = useMemo<ChannelStatusValues>(
    () => ({
      cache_hit_rate_enabled:
        props.defaultValues['channel_status_setting.cache_hit_rate_enabled'],
      cache_hit_rate_minutes:
        props.defaultValues['channel_status_setting.cache_hit_rate_minutes'],
    }),
    [props.defaultValues]
  )
  const savedRef = useRef<ChannelStatusValues>(formDefaults)
  const form = useForm<ChannelStatusValues>({
    resolver: zodResolver(schema),
    defaultValues: formDefaults,
  })
  useEffect(() => {
    savedRef.current = formDefaults
    form.reset(formDefaults)
  }, [formDefaults, form])

  const { isDirty, isSubmitting } = form.formState
  const saving = updateOption.isPending || isSubmitting

  const onSubmit = async (values: ChannelStatusValues) => {
    const fields = Object.keys(values) as Array<keyof ChannelStatusValues>
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
    <SettingsSection title={t('Channel status page')}>
      <p className='text-muted-foreground text-sm'>
        {t(
          'What the channel status page shows. Changes appear within a minute.'
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
            name='cache_hit_rate_enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Show the cache hit rate')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Each group card shows the share of input tokens read from the upstream cache, over real user requests. Turned off, the counts are not kept.'
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
          {/* The window on the left, clearing the counts on the right. */}
          <div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]'>
            <FormField
              control={form.control}
              name='cache_hit_rate_minutes'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Cache hit rate window (minutes)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={MIN_MINUTES}
                      max={MAX_MINUTES}
                      step={1}
                      {...safeNumberFieldProps(field)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'The card shows the rate over this many recent minutes. Counts older than this are deleted, so a longer window fills in over time.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <RecordsClear
              title={t('Clear cache records')}
              clear={clearChannelStatusCache}
              invalidateKeys={[['group-health']]}
              quickPicks={CACHE_CLEAR_PICKS}
              defaultMinutes={30}
              allDescription={t(
                'All stored cache hit rate counts are deleted, for every group. The rates fill in again from new requests. This cannot be undone.'
              )}
              beforeDescription={(time) =>
                t(
                  'Cache hit rate counts from before {{time}} are deleted, for every group. This cannot be undone.',
                  { time }
                )
              }
              successMessage={() => t('Cache records cleared.')}
            />
          </div>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
