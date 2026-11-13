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
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
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
  upstreamRateConversionGroupKey,
  upstreamRateConversionRuleKey,
  upstreamRateConversionSchema,
  upstreamRateConversionSiteKey,
  type UpstreamRateConversionFormValues,
} from './lib/conversion-schema'
import type {
  UpstreamRateConversionRule,
  UpstreamRateConversionSite,
} from './types'

export function UpstreamRateConversionForm(props: {
  rule?: UpstreamRateConversionRule
  rules: UpstreamRateConversionRule[]
  sites: UpstreamRateConversionSite[]
  saving: boolean
  onSave: (rule: UpstreamRateConversionRule) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const originalSiteKey = props.rule
    ? upstreamRateConversionSiteKey(props.rule)
    : ''
  const form = useForm<UpstreamRateConversionFormValues>({
    resolver: zodResolver(upstreamRateConversionSchema),
    defaultValues: {
      site_key: originalSiteKey,
      channel: String(props.rule?.upstream_channel_id ?? 0),
      group: upstreamRateConversionGroupKey({
        id: props.rule?.group_id ?? 0,
        name: props.rule?.group_name ?? '',
      }),
      factor: props.rule?.factor ?? 1,
    },
  })
  const siteKey = form.watch('site_key')
  const channelID = Number(form.watch('channel'))
  const site = props.sites.find(
    (item) => upstreamRateConversionSiteKey(item) === siteKey
  )
  const channel = site?.channels.find((item) => item.id === channelID)
  const emptyGroup = upstreamRateConversionGroupKey({ id: 0, name: '' })
  const siteOptions = props.sites.map((item) => ({
    value: upstreamRateConversionSiteKey(item),
    label: `${item.source_name} · ${item.site_url}`,
  }))
  // 快照暂缺时保留已保存的目标，允许继续调整系数或删除规则。
  if (
    props.rule &&
    !siteOptions.some((item) => item.value === originalSiteKey)
  ) {
    siteOptions.push({
      value: originalSiteKey,
      label: `${props.rule.source_id} · ${props.rule.site_url}`,
    })
  }
  const channelOptions = [
    { value: '0', label: t('All upstream channels') },
    ...(site?.channels.map((item) => ({
      value: String(item.id),
      label: `#${item.id} ${item.name}`,
    })) ?? []),
  ]
  const groupOptions = [
    { value: emptyGroup, label: t('All groups') },
    ...(channel?.groups.map((item) => ({
      value: upstreamRateConversionGroupKey(item),
      label: item.id > 0 ? `#${item.id} ${item.name}` : item.name,
    })) ?? []),
  ]
  const originalSite = Boolean(props.rule) && originalSiteKey === siteKey
  if (originalSite && props.rule?.upstream_channel_id && !channel) {
    channelOptions.push({
      value: String(props.rule.upstream_channel_id),
      label: `#${props.rule.upstream_channel_id}`,
    })
  }
  if (
    props.rule &&
    originalSite &&
    channelID === props.rule.upstream_channel_id &&
    (props.rule.group_id || props.rule.group_name)
  ) {
    const value = upstreamRateConversionGroupKey({
      id: props.rule.group_id ?? 0,
      name: props.rule.group_name ?? '',
    })
    if (!groupOptions.some((item) => item.value === value)) {
      groupOptions.push({
        value,
        label: props.rule.group_name || `#${props.rule.group_id}`,
      })
    }
  }

  return (
    <Form {...form}>
      <form
        className='space-y-4'
        onSubmit={form.handleSubmit((values) => {
          const selected = props.sites.find(
            (item) => upstreamRateConversionSiteKey(item) === values.site_key
          )
          const target = selected ?? (originalSite ? props.rule : undefined)
          if (!target) {
            form.setError('site_key', { message: 'Choose an upstream site' })
            return
          }
          const rule: UpstreamRateConversionRule = {
            source_id: target.source_id,
            site_url: target.site_url,
            factor: values.factor,
          }
          if (Number(values.channel) > 0) {
            rule.upstream_channel_id = Number(values.channel)
          }
          if (rule.upstream_channel_id && values.group !== emptyGroup) {
            if (values.group.startsWith('id:')) {
              rule.group_id = Number(values.group.slice(3))
            } else {
              rule.group_name = values.group.slice(5)
            }
            const selectedGroup = channel?.groups.find(
              (item) => upstreamRateConversionGroupKey(item) === values.group
            )
            if (selectedGroup) rule.group_name = selectedGroup.name
            else if (originalSite && props.rule?.group_name) {
              rule.group_name = props.rule.group_name
            }
          }
          const originalKey =
            props.rule && upstreamRateConversionRuleKey(props.rule)
          const nextKey = upstreamRateConversionRuleKey(rule)
          if (
            props.rules.some((item) => {
              const key = upstreamRateConversionRuleKey(item)
              return key !== originalKey && key === nextKey
            })
          ) {
            form.setError('site_key', {
              message: 'A conversion rule already exists for this target',
            })
            return
          }
          props.onSave(rule)
        })}
      >
        <FormField
          control={form.control}
          name='site_key'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Upstream site')}</FormLabel>
              <FormControl>
                <Combobox
                  ref={field.ref}
                  name={field.name}
                  options={siteOptions}
                  value={field.value}
                  disabled={props.saving}
                  onBlur={field.onBlur}
                  onValueChange={(value) => {
                    field.onChange(value ?? '')
                    form.setValue('channel', '0')
                    form.setValue('group', emptyGroup)
                  }}
                  placeholder={t('Choose an upstream site')}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='channel'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Upstream channel')}</FormLabel>
              <FormControl>
                <Combobox
                  ref={field.ref}
                  name={field.name}
                  options={channelOptions}
                  value={field.value}
                  disabled={props.saving || !siteKey}
                  onBlur={field.onBlur}
                  onValueChange={(value) => {
                    field.onChange(value ?? '0')
                    form.setValue('group', emptyGroup)
                  }}
                />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='group'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Group')}</FormLabel>
              <FormControl>
                <Combobox
                  ref={field.ref}
                  name={field.name}
                  options={groupOptions}
                  value={field.value}
                  disabled={props.saving || channelID === 0}
                  onBlur={field.onBlur}
                  onValueChange={(value) => field.onChange(value ?? emptyGroup)}
                />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='factor'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Conversion factor')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type='number'
                  min={0.000001}
                  max={1000000}
                  step='any'
                  disabled={props.saving}
                  value={Number.isFinite(field.value) ? field.value : ''}
                  onChange={(event) =>
                    field.onChange(event.target.valueAsNumber)
                  }
                />
              </FormControl>
              <FormDescription>
                {t(
                  'Effective upstream rate = original rate × factor. Use 0.1 to convert 4 to 0.4.'
                )}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className='flex justify-end gap-2'>
          <Button
            type='button'
            variant='outline'
            disabled={props.saving}
            onClick={props.onCancel}
          >
            {t('Cancel')}
          </Button>
          <Button type='submit' disabled={props.saving}>
            {props.saving ? t('Saving...') : t('Save')}
          </Button>
        </div>
      </form>
    </Form>
  )
}
