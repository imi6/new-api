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
import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2, Play, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

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
import { getIntelligenceCheckModels, runIntelligenceChecksNow } from './api'
import type { IntelligenceCheckSettings } from './defaults'
import {
  changedIntelligenceCheckOptions,
  INTELLIGENCE_CHECK_LIMITS,
  intelligenceCheckSchema,
  type IntelligenceCheckTarget,
  type IntelligenceCheckValues,
  toIntelligenceCheckValues,
} from './intelligence-check-schema'

interface IntelligenceCheckSectionProps {
  defaultValues: IntelligenceCheckSettings
}

type NumberField =
  | 'candy_interval_hours'
  | 'candy_max_tokens'
  | 'pelican_interval_hours'
  | 'pelican_max_tokens'

interface TargetRowsProps {
  value: IntelligenceCheckTarget[]
  onChange: (value: IntelligenceCheckTarget[]) => void
  modelsByGroup: Record<string, string[]>
}

/** One row per checked group: the group, then a model enabled in it. */
function TargetRows(props: TargetRowsProps) {
  const { t } = useTranslation()
  const groups = Object.keys(props.modelsByGroup).sort()
  const update = (index: number, next: IntelligenceCheckTarget) =>
    props.onChange(props.value.map((row, i) => (i === index ? next : row)))

  return (
    <div className='flex flex-col gap-2'>
      {props.value.map((row, index) => {
        const models = props.modelsByGroup[row.group] ?? []
        // Keep a saved model selectable even when it left the group.
        const modelItems =
          row.model !== '' && !models.includes(row.model)
            ? [row.model, ...models]
            : models
        return (
          <div
            key={`${index}-${row.group}`}
            className='grid grid-cols-[1fr_1fr_auto] items-center gap-2'
          >
            <Select
              items={groups.map((group) => ({ value: group, label: group }))}
              value={row.group}
              onValueChange={(group) => {
                if (group !== null) update(index, { group, model: '' })
              }}
            >
              <SelectTrigger className='w-full' aria-label={t('Group')}>
                <SelectValue placeholder={t('Choose a group')} />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {groups.map((group) => (
                    <SelectItem key={group} value={group}>
                      {group}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              items={modelItems.map((name) => ({ value: name, label: name }))}
              value={row.model}
              onValueChange={(model) => {
                if (model !== null) update(index, { ...row, model })
              }}
              disabled={row.group === ''}
            >
              <SelectTrigger className='w-full' aria-label={t('Model')}>
                <SelectValue placeholder={t('Choose a model')} />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {modelItems.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              type='button'
              variant='ghost'
              size='icon-sm'
              aria-label={t('Remove')}
              onClick={() =>
                props.onChange(props.value.filter((_, i) => i !== index))
              }
            >
              <Trash2 aria-hidden='true' />
            </Button>
          </div>
        )
      })}
      <Button
        type='button'
        variant='outline'
        size='sm'
        className='self-start'
        disabled={props.value.length >= INTELLIGENCE_CHECK_LIMITS.targets}
        onClick={() =>
          props.onChange([...props.value, { group: '', model: '' }])
        }
      >
        <Plus aria-hidden='true' />
        {t('Add group')}
      </Button>
    </div>
  )
}

export function IntelligenceCheckSection(props: IntelligenceCheckSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const formDefaults = useMemo(
    () => toIntelligenceCheckValues(props.defaultValues),
    [props.defaultValues]
  )
  const savedRef = useRef<IntelligenceCheckValues>(formDefaults)

  const form = useForm<IntelligenceCheckValues>({
    resolver: zodResolver(intelligenceCheckSchema),
    defaultValues: formDefaults,
  })
  useEffect(() => {
    savedRef.current = formDefaults
    form.reset(formDefaults)
  }, [formDefaults, form])

  const models = useQuery({
    queryKey: ['intelligence-check-models'],
    queryFn: getIntelligenceCheckModels,
  })
  const runNow = useMutation({
    mutationFn: runIntelligenceChecksNow,
    onSuccess: () =>
      toast.success(
        t(
          'Intelligence checks started. Results appear on the channel status page.'
        )
      ),
    onError: (error) => handleServerError(error),
    meta: { errorToast: false },
  })

  const { isDirty, isSubmitting } = form.formState
  const saving = updateOption.isPending || isSubmitting

  const onSubmit = async (values: IntelligenceCheckValues) => {
    const updates = changedIntelligenceCheckOptions(savedRef.current, values)
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

  const renderSwitch = (
    name: 'enabled' | 'candy_enabled' | 'pelican_enabled',
    label: string,
    description: string
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <SettingsSwitchItem>
          <SettingsSwitchContent>
            <FormLabel>{label}</FormLabel>
            <FormDescription>{description}</FormDescription>
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
  )

  const renderNumber = (
    name: NumberField,
    label: string,
    limits: { min: number; max: number }
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type='number'
              min={limits.min}
              max={limits.max}
              step={1}
              {...safeNumberFieldProps(field)}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )

  const renderText = (
    name: 'candy_prompt' | 'candy_answer_format' | 'pelican_prompt',
    label: string,
    description: string,
    rows: number
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Textarea rows={rows} {...field} />
          </FormControl>
          <FormDescription>{description}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  )

  return (
    <SettingsSection title={t('Intelligence checks')}>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Ask each group a fixed question on a schedule, routed like a user request, and show the answers on the channel status page. A failed check never disables a channel. Every check is billed by the upstream.'
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

          {renderSwitch(
            'enabled',
            t('Enable intelligence checks'),
            t('Checks run only for the groups listed below.')
          )}

          <FormField
            control={form.control}
            name='targets'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Groups and models to check')}</FormLabel>
                <TargetRows
                  value={field.value}
                  onChange={field.onChange}
                  modelsByGroup={models.data ?? {}}
                />
                <FormDescription>
                  {t(
                    'Each group is checked with one model. A group not listed shows no check button.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className='flex flex-wrap items-center gap-3'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={isDirty || runNow.isPending}
              onClick={() => runNow.mutate()}
            >
              {runNow.isPending ? (
                <Loader2 className='animate-spin' aria-hidden='true' />
              ) : (
                <Play aria-hidden='true' />
              )}
              {t('Check now')}
            </Button>
            <span className='text-muted-foreground text-xs'>
              {isDirty
                ? t('Save the settings first.')
                : t('Runs every enabled question for every listed group now.')}
            </span>
          </div>

          <Separator />
          <h4 className='text-sm font-medium'>{t('Candy question')}</h4>
          {renderSwitch(
            'candy_enabled',
            t('Ask the candy question'),
            t(
              'A logic question with a hidden condition. The stated final answer is compared with the expected one.'
            )
          )}
          <SettingsFormGrid>
            {renderNumber(
              'candy_interval_hours',
              t('Interval (hours)'),
              INTELLIGENCE_CHECK_LIMITS.interval
            )}
            {renderNumber(
              'candy_max_tokens',
              t('Max output tokens'),
              INTELLIGENCE_CHECK_LIMITS.maxTokens
            )}
            {renderText(
              'candy_prompt',
              t('Question'),
              t('Sent as the user message.'),
              8
            )}
            <FormField
              control={form.control}
              name='candy_answer'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Expected answer')}</FormLabel>
                  <FormControl>
                    <Input
                      maxLength={INTELLIGENCE_CHECK_LIMITS.answer}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Change it together with the question.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {renderText(
              'candy_answer_format',
              t('Answer format instruction'),
              t(
                'Added after the question so the answer can be read. Keep the words "最终答案：" or "Final answer:" in it.'
              ),
              2
            )}
          </SettingsFormGrid>

          <Separator />
          <h4 className='text-sm font-medium'>{t('Pelican drawing')}</h4>
          {renderSwitch(
            'pelican_enabled',
            t('Ask for the pelican drawing'),
            t(
              'The model writes an animated SVG page. It passes when the page is complete, animated and self-contained; the drawing is shown for people to judge.'
            )
          )}
          <SettingsFormGrid>
            {renderNumber(
              'pelican_interval_hours',
              t('Interval (hours)'),
              INTELLIGENCE_CHECK_LIMITS.interval
            )}
            {renderNumber(
              'pelican_max_tokens',
              t('Max output tokens'),
              INTELLIGENCE_CHECK_LIMITS.maxTokens
            )}
            {renderText(
              'pelican_prompt',
              t('Question'),
              t('Sent as the user message.'),
              6
            )}
          </SettingsFormGrid>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
