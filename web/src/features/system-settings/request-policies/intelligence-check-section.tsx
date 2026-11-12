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
import { useQuery } from '@tanstack/react-query'
import { FlaskConical, Loader2, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

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
import { clearIntelligenceChecks, getIntelligenceCheckModels } from './api'
import type { IntelligenceCheckSettings } from './defaults'
import {
  IntelligenceCheckRunNow,
  type IntelligenceCheckRunState,
  useIntelligenceCheckRun,
} from './intelligence-check-run'
import {
  changedIntelligenceCheckOptions,
  INTELLIGENCE_CHECK_LIMITS,
  intelligenceCheckSchema,
  type IntelligenceCheckTarget,
  type IntelligenceCheckValues,
  toIntelligenceCheckValues,
} from './intelligence-check-schema'
import { type ClearQuickPick, RecordsClear } from './records-clear'

const INTELLIGENCE_CLEAR_PICKS: readonly ClearQuickPick[] = [
  { labelKey: '24 hours ago', minutes: 24 * 60 },
  { labelKey: '7 days ago', minutes: 7 * 24 * 60 },
  { labelKey: '30 days ago', minutes: 30 * 24 * 60 },
]

interface IntelligenceCheckSectionProps {
  defaultValues: IntelligenceCheckSettings
}

type NumberField =
  | 'keep_results'
  | 'candy_interval_hours'
  | 'candy_max_tokens'
  | 'pelican_interval_hours'
  | 'pelican_max_tokens'

interface TargetRowsProps {
  value: IntelligenceCheckTarget[]
  onChange: (value: IntelligenceCheckTarget[]) => void
  modelsByGroup: Record<string, string[]>
  run: IntelligenceCheckRunState
  /** Unsaved changes would not be checked, so a test waits for a save. */
  dirty: boolean
}

/**
 * One card per checked group: the group, a model enabled in it, and the
 * questions it is asked.
 */
function TargetRows(props: TargetRowsProps) {
  const { t } = useTranslation()
  const groups = Object.keys(props.modelsByGroup).sort()
  const update = (index: number, next: IntelligenceCheckTarget) =>
    props.onChange(props.value.map((row, i) => (i === index ? next : row)))

  return (
    <div className='flex flex-col gap-3'>
      {/* Two groups side by side on wide screens, one on narrow ones. */}
      <div className='grid gap-3 xl:grid-cols-2'>
        {props.value.map((row, index) => {
          const models = props.modelsByGroup[row.group] ?? []
          // Keep a saved model selectable even when it left the group.
          const modelItems =
            row.model !== '' && !models.includes(row.model)
              ? [row.model, ...models]
              : models
          const testingThis = props.run.running
            ? props.run.runningGroup === row.group
            : props.run.startingGroup === row.group
          const testDisabled =
            props.dirty ||
            row.group === '' ||
            props.run.running ||
            props.run.starting
          let testLabel = t('Check this group now')
          if (props.dirty) testLabel = t('Save the settings first.')
          return (
            <div
              key={`${index}-${row.group}`}
              className='flex min-w-0 flex-col gap-2 rounded-lg border p-3'
            >
              {/* Group names are long, so the two pickers stack. */}
              <div className='flex min-w-0 flex-col gap-2'>
                <Select
                  items={groups.map((group) => ({
                    value: group,
                    label: group,
                  }))}
                  value={row.group}
                  onValueChange={(group) => {
                    if (group !== null) {
                      update(index, { ...row, group, model: '' })
                    }
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
                  items={modelItems.map((name) => ({
                    value: name,
                    label: name,
                  }))}
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
              </div>
              <div className='flex items-center justify-between gap-2'>
                <div className='flex items-center gap-4 text-sm'>
                  <label className='flex cursor-pointer items-center gap-1.5'>
                    <Checkbox
                      checked={row.candy}
                      onCheckedChange={(value) =>
                        update(index, { ...row, candy: !!value })
                      }
                    />
                    {t('Candy question')}
                  </label>
                  <label className='flex cursor-pointer items-center gap-1.5'>
                    <Checkbox
                      checked={row.pelican}
                      onCheckedChange={(value) =>
                        update(index, { ...row, pelican: !!value })
                      }
                    />
                    {t('Pelican drawing')}
                  </label>
                </div>
                <div className='flex items-center gap-1'>
                  {/* Checks only this group, as "check now" does for all. */}
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon-sm'
                          aria-label={testLabel}
                          disabled={testDisabled}
                          onClick={() => props.run.start(row.group)}
                        >
                          {testingThis ? (
                            <Loader2
                              className='animate-spin'
                              aria-hidden='true'
                            />
                          ) : (
                            <FlaskConical aria-hidden='true' />
                          )}
                        </Button>
                      }
                    />
                    <TooltipContent>{testLabel}</TooltipContent>
                  </Tooltip>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-sm'
                    aria-label={t('Remove')}
                    onClick={() =>
                      props.onChange(
                        props.value.filter((_, i) => i !== index)
                      )
                    }
                  >
                    <Trash2 aria-hidden='true' />
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <Button
        type='button'
        variant='outline'
        size='sm'
        className='self-start'
        disabled={props.value.length >= INTELLIGENCE_CHECK_LIMITS.targets}
        onClick={() =>
          props.onChange([
            ...props.value,
            { group: '', model: '', candy: true, pelican: true },
          ])
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
  const { isDirty, isSubmitting } = form.formState
  const saving = updateOption.isPending || isSubmitting
  // Shared by "check now" and each group's test button: one run at a time.
  const run = useIntelligenceCheckRun()

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
    name: 'enabled' | 'user_test_enabled' | 'candy_enabled' | 'pelican_enabled',
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
            'user_test_enabled',
            t('Let users test on the API keys page'),
            t(
              'Shows an intelligence test entry on the API keys page. Users ask the questions below with their own key, billed at the normal price of its group.'
            )
          )}

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
                  run={run}
                  dirty={isDirty}
                />
                <FormDescription>
                  {t(
                    'Each group is checked with one model and asked only the questions ticked in its row. A group not listed shows no check button.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <IntelligenceCheckRunNow run={run} dirty={isDirty} />

          <Separator />
          <h4 className='text-sm font-medium'>{t('Stored results')}</h4>
          {/* What is kept on the left, clearing by hand on the right; the
              clearing row is wider so its controls fit on one line. */}
          <div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]'>
            <div className='flex flex-col gap-2'>
              {renderNumber(
                'keep_results',
                t('Results kept per group and question'),
                INTELLIGENCE_CHECK_LIMITS.keepResults
              )}
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Older results are deleted as new ones arrive, so the database does not grow. The check dialog shows up to 10.'
                )}
              </p>
            </div>
            <RecordsClear
              title={t('Clear check results')}
              clear={clearIntelligenceChecks}
              invalidateKeys={[['intelligence-checks']]}
              quickPicks={INTELLIGENCE_CLEAR_PICKS}
              defaultMinutes={7 * 24 * 60}
              allDescription={t(
                'All stored check results are deleted, for every group. This cannot be undone.'
              )}
              beforeDescription={(time) =>
                t(
                  'Check results from before {{time}} are deleted, for every group. This cannot be undone.',
                  { time }
                )
              }
              successMessage={(count) =>
                t('Deleted {{count}} check results.', { count })
              }
            />
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
