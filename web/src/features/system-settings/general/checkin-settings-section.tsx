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
import { RefreshCw } from 'lucide-react'
import { useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

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
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import { formatQuota } from '@/lib/format'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const schema = z.object({
  enabled: z.boolean(),
  minQuota: z.coerce.number().int().min(0),
  maxQuota: z.coerce.number().int().min(0),
})

type Values = z.infer<typeof schema>

export function CheckinSettingsSection({
  defaultValues,
}: {
  defaultValues: {
    enabled: boolean
    minQuota: number
    maxQuota: number
  }
}) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const form = useForm<Values>({
    resolver: zodResolver(schema) as unknown as Resolver<Values>,
    defaultValues: {
      enabled: defaultValues.enabled,
      minQuota: defaultValues.minQuota,
      maxQuota: defaultValues.maxQuota,
    },
  })

  const { isDirty, isSubmitting } = form.formState
  const enabled = form.watch('enabled')

  async function onSubmit(values: Values) {
    const updates: Array<{ key: string; value: string }> = []

    if (values.enabled !== defaultValues.enabled) {
      updates.push({
        key: 'checkin_setting.enabled',
        value: String(values.enabled),
      })
    }

    if (values.minQuota !== defaultValues.minQuota) {
      updates.push({
        key: 'checkin_setting.min_quota',
        value: String(values.minQuota),
      })
    }

    if (values.maxQuota !== defaultValues.maxQuota) {
      updates.push({
        key: 'checkin_setting.max_quota',
        value: String(values.maxQuota),
      })
    }

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const update of updates) {
      await updateOption.mutateAsync(update)
    }

    form.reset(values)
  }

  return (
    <>
    <SettingsSection title={t('Check-in Settings')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)} autoComplete='off'>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending || isSubmitting}
            isSaveDisabled={!isDirty}
            saveLabel='Save check-in settings'
          />
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable check-in feature')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Allow users to check in daily for random quota rewards'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={updateOption.isPending || isSubmitting}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          {enabled && (
            <div className='grid gap-6 sm:grid-cols-2'>
              <FormField
                control={form.control}
                name='minQuota'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Minimum check-in quota')}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={0}
                        placeholder={t('1000')}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('Minimum quota amount awarded for check-in')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='maxQuota'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Maximum check-in quota')}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={0}
                        placeholder={t('10000')}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('Maximum quota amount awarded for check-in')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}
        </SettingsForm>
      </Form>
    </SettingsSection>

    <TodayCheckinList />
    </>
  )
}

interface AdminCheckinRecord {
  id: number
  user_id: number
  username: string
  checkin_date: string
  quota_awarded: number
  created_at: number
}

interface AdminCheckinResponse {
  success: boolean
  data: {
    items: AdminCheckinRecord[]
    total: number
    page: number
    page_size: number
  }
}

async function fetchTodayCheckins(): Promise<AdminCheckinResponse> {
  const today = new Date().toISOString().slice(0, 10)
  const res = await api.get(`/api/user/checkin/admin?date=${today}&p=1&page_size=100`)
  return res.data
}

function TodayCheckinList() {
  const { t } = useTranslation()
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin-checkins-today'],
    queryFn: fetchTodayCheckins,
    refetchInterval: 60_000,
  })

  const records = data?.data?.items ?? []
  const total = data?.data?.total ?? 0
  const totalQuota = records.reduce((s, r) => s + r.quota_awarded, 0)

  return (
    <SettingsSection title={t("Today's check-ins")}>
      <div className='space-y-3'>
        <div className='flex items-center justify-between'>
          <p className='text-muted-foreground text-sm'>
            {t('{{count}} records', { count: total })} ·{' '}
            {t('Total quota awarded today')}: {formatQuota(totalQuota)}
          </p>
          <Button
            variant='outline'
            size='sm'
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`mr-1.5 size-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            {t('Refresh')}
          </Button>
        </div>

        {isLoading ? (
          <div className='space-y-2'>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className='h-10 w-full rounded-lg' />
            ))}
          </div>
        ) : records.length === 0 ? (
          <p className='text-muted-foreground py-6 text-center text-sm'>
            {t('No check-ins today')}
          </p>
        ) : (
          <div className='rounded-lg border overflow-hidden'>
            <table className='w-full text-sm'>
              <thead className='bg-muted/50'>
                <tr>
                  <th className='px-4 py-2.5 text-left font-medium text-xs text-muted-foreground'>{t('User')}</th>
                  <th className='px-4 py-2.5 text-left font-medium text-xs text-muted-foreground'>{t('Check-in time')}</th>
                  <th className='px-4 py-2.5 text-right font-medium text-xs text-muted-foreground'>{t('Quota awarded')}</th>
                </tr>
              </thead>
              <tbody className='divide-y'>
                {records.map((r) => (
                  <tr key={r.id} className='hover:bg-muted/20'>
                    <td className='px-4 py-2.5 font-medium'>{r.username}</td>
                    <td className='px-4 py-2.5 text-muted-foreground'>
                      {new Date(r.created_at * 1000).toLocaleTimeString()}
                    </td>
                    <td className='px-4 py-2.5 text-right tabular-nums'>
                      {formatQuota(r.quota_awarded)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SettingsSection>
  )
}
