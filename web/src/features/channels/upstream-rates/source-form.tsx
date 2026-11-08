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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

import { saveUpstreamRateSource, upstreamRateQueryKey } from './api'
import {
  upstreamRateSourceSchema,
  type UpstreamRateSourceFormValues,
} from './lib/source-schema'
import type { UpstreamRateSource } from './types'

export function UpstreamRateSourceForm(props: {
  source?: UpstreamRateSource
  onDone: () => void
  encryptionReady: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  const client = useQueryClient()
  const form = useForm<UpstreamRateSourceFormValues>({
    resolver: zodResolver(upstreamRateSourceSchema),
    defaultValues: {
      id: props.source?.id ?? '',
      name: props.source?.name ?? '',
      base_url: props.source?.base_url ?? '',
      token: '',
      enabled: props.source?.enabled ?? true,
      poll_seconds: props.source?.poll_seconds ?? 60,
    },
  })
  const save = useMutation({
    mutationFn: saveUpstreamRateSource,
    onSuccess: () => {
      form.reset()
      void client.invalidateQueries({ queryKey: upstreamRateQueryKey })
      toast.success(t('Upstream rate source saved'))
      props.onDone()
    },
  })

  return (
    <Form {...form}>
      <form
        className='space-y-4'
        onSubmit={form.handleSubmit((value) => {
          if (
            props.source &&
            value.base_url.replace(/\/+$/, '') !== props.source.base_url &&
            !value.token
          ) {
            form.setError('token', {
              message: t('Enter a new token when changing the source URL.'),
            })
            return
          }
          save.mutate(value)
        })}
      >
        <FormField
          control={form.control}
          name='name'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Name')}</FormLabel>
              <FormControl>
                <Input {...field} maxLength={80} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='base_url'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Upstream rate source URL')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type='url'
                  placeholder='https://upos.zzshu.cc'
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='token'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('External API token')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type='password'
                  autoComplete='new-password'
                  spellCheck={false}
                  maxLength={4096}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <p className='text-muted-foreground text-xs'>
          {props.encryptionReady
            ? t(
                'New tokens are encrypted on the server. Leave blank to keep the saved token.'
              )
            : t(
                'New tokens are stored as plain text in the database. Leave blank to keep the saved token.'
              )}
        </p>
        <FormField
          control={form.control}
          name='poll_seconds'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Snapshot read interval (seconds)')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type='number'
                  min={30}
                  max={3600}
                  onChange={(event) =>
                    field.onChange(event.target.valueAsNumber)
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='enabled'
          render={({ field }) => (
            <div className='flex items-center gap-2'>
              <Switch
                id={`${id}-enabled`}
                checked={field.value}
                onCheckedChange={field.onChange}
              />
              <Label htmlFor={`${id}-enabled`}>{t('Enabled')}</Label>
            </div>
          )}
        />
        <div className='flex justify-end gap-2'>
          <Button
            type='button'
            variant='outline'
            onClick={props.onDone}
            disabled={save.isPending}
          >
            {t('Cancel')}
          </Button>
          <Button type='submit' disabled={save.isPending}>
            {t('Save')}
          </Button>
        </div>
      </form>
    </Form>
  )
}
