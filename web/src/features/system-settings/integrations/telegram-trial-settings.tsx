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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Switch } from '@/components/ui/switch'
import {
  getTelegramTrialConfig,
  updateTelegramTrialConfig,
} from '@/features/telegram-bot/api'
import type { TelegramTrialConfig } from '@/features/telegram-bot/types'
import { formatQuotaWithCurrency, getCurrencyLabel } from '@/lib/currency'
import { parseQuotaFromDollars, quotaUnitsToDollars } from '@/lib/format'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { FormNavigationGuard } from '../components/form-navigation-guard'
import {
  SettingsForm,
  SettingsFormGrid,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { useResetForm } from '../hooks/use-reset-form'
import { TelegramTrialClaims } from './telegram-trial-claims'
import {
  createTelegramTrialSchema,
  type TelegramTrialValues,
} from './telegram-trial-schema'

const trialQueryKey = ['telegram-bot', 'trial-config'] as const

export function TelegramTrialSettings() {
  const { t } = useTranslation()
  const role = useAuthStore((state) => state.auth.user?.role ?? 0)
  const query = useQuery({
    queryKey: trialQueryKey,
    queryFn: ({ signal }) => getTelegramTrialConfig(signal),
    enabled: role >= ROLE.ADMIN,
    refetchOnWindowFocus: false,
  })
  if (role < ROLE.ADMIN) return null

  return (
    <section
      className='space-y-4 border-t pt-6'
      aria-label={t('Telegram trial quota')}
    >
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h3 className='font-semibold'>{t('Telegram trial quota')}</h3>
          <p className='text-muted-foreground mt-1 text-sm'>
            {t('Users send /trial to the bot to claim a one-time trial quota.')}
          </p>
        </div>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw
            aria-hidden='true'
            className={query.isFetching ? 'animate-spin' : undefined}
          />
          {t('Refresh')}
        </Button>
      </div>
      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {query.data && (
        <TelegramTrialForm
          initial={query.data}
          canEdit={role >= ROLE.SUPER_ADMIN}
        />
      )}
      <TelegramTrialClaims />
    </section>
  )
}

function TelegramTrialForm(props: {
  initial: TelegramTrialConfig
  canEdit: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  useSystemConfigStore((state) => state.config.currency)
  const currency = getCurrencyLabel()
  const [pendingValues, setPendingValues] =
    useState<TelegramTrialValues | null>(null)
  const form = useForm<TelegramTrialValues>({
    resolver: zodResolver(createTelegramTrialSchema(t)),
    defaultValues: props.initial,
  })
  const save = useMutation({
    mutationFn: updateTelegramTrialConfig,
    onSuccess: (saved) => {
      form.reset(saved)
      queryClient.setQueryData(trialQueryKey, saved)
      setPendingValues(null)
      void queryClient.invalidateQueries({
        queryKey: ['telegram-bot', 'self'],
        predicate: (query) => query.queryKey[3] === 'trial',
      })
      toast.success(t('Saved successfully'))
    },
  })
  const newUsers = useMutation({
    mutationFn: () => getTelegramTrialConfig(),
    onSuccess: (latest) => {
      queryClient.setQueryData(trialQueryKey, latest)
      form.setValue('min_user_id', latest.current_max_user_id + 1, {
        shouldDirty: true,
        shouldValidate: true,
      })
    },
  })
  useResetForm(
    form,
    form.formState.isDirty || save.isPending || newUsers.isPending
      ? undefined
      : props.initial
  )
  const disabled = !props.canEdit || save.isPending || newUsers.isPending
  const requireMembership = form.watch('require_membership')
  const amounts = [
    {
      name: 'quota' as const,
      label: t('Trial quota per user ({{currency}})', { currency }),
    },
    {
      name: 'daily_limit' as const,
      label: t('Daily trial quota limit ({{currency}})', { currency }),
    },
    {
      name: 'total_limit' as const,
      label: t('Total trial quota limit ({{currency}})', { currency }),
    },
  ]

  return (
    <>
      <FormNavigationGuard when={form.formState.isDirty} />
      <Alert>
        <AlertDescription className='space-y-2'>
          <p>
            {t(
              'An account must have a bound email and be connected to the bot. Send /trial to receive trial quota directly.'
            )}
          </p>
          <p>
            {t(
              'Each site account, Telegram ID and email can claim only once, even after rebinding or deleting an account.'
            )}
          </p>
          <p>
            {t(
              'Trial quota is gifted credit. Its consumption does not generate referral rebates.'
            )}
          </p>
        </AlertDescription>
      </Alert>
      {props.initial.min_user_id <= 0 && (
        <Alert>
          <AlertDescription>
            {t(
              'Minimum user ID has not been configured. Trial claims are paused.'
            )}
          </AlertDescription>
        </Alert>
      )}
      <Form {...form}>
        <SettingsForm
          onSubmit={form.handleSubmit((values) => {
            if (
              props.initial.min_user_id > 0 &&
              values.min_user_id < props.initial.min_user_id
            ) {
              setPendingValues(values)
              return
            }
            save.mutate(values)
          })}
        >
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable trial quota claims')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Claims pause when the daily or total quota limit is reached.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={disabled}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />
          <FormField
            control={form.control}
            name='min_user_id'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Minimum user ID for trial claims')}</FormLabel>
                <div className='flex flex-wrap items-center gap-2'>
                  <FormControl>
                    <Input
                      type='number'
                      inputMode='numeric'
                      step={1}
                      min={1}
                      max={Number.MAX_SAFE_INTEGER}
                      className='w-full sm:w-52'
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      value={Number.isFinite(field.value) ? field.value : ''}
                      onChange={(event) =>
                        field.onChange(event.currentTarget.valueAsNumber)
                      }
                      disabled={disabled}
                    />
                  </FormControl>
                  <Button
                    type='button'
                    variant='outline'
                    disabled={
                      disabled ||
                      props.initial.current_max_user_id >=
                        Number.MAX_SAFE_INTEGER
                    }
                    onClick={() => newUsers.mutate()}
                  >
                    {t('Only allow users registered from now on')}
                  </Button>
                </div>
                <FormDescription>
                  {t(
                    'Only accounts with a user ID greater than or equal to this value can claim. Registration time is not checked.'
                  )}
                </FormDescription>
                <p className='text-muted-foreground text-xs'>
                  {t('Current highest user ID: {{id}}', {
                    id: props.initial.current_max_user_id,
                  })}
                </p>
                <FormMessage />
              </FormItem>
            )}
          />
          <SettingsFormGrid>
            {amounts.map((item) => (
              <FormField
                key={item.name}
                control={form.control}
                name={item.name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{item.label}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        inputMode='decimal'
                        step='any'
                        min={0}
                        name={field.name}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        value={
                          Number.isFinite(field.value)
                            ? quotaUnitsToDollars(field.value)
                            : ''
                        }
                        onChange={(event) => {
                          const amount = event.currentTarget.valueAsNumber
                          field.onChange(
                            Number.isFinite(amount)
                              ? parseQuotaFromDollars(amount)
                              : Number.NaN
                          )
                        }}
                        disabled={disabled}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
          </SettingsFormGrid>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Set positive quotas and limits before enabling. Changing settings does not reset previous claims or granted totals.'
            )}
          </p>
          <FormField
            control={form.control}
            name='require_membership'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>
                    {t('Require joining a Telegram group or channel')}
                  </FormLabel>
                  <FormDescription>
                    {t(
                      'When enabled, the bot checks membership before granting trial quota. Add the bot as an administrator of the target group or channel.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={disabled}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />
          {requireMembership && (
            <SettingsFormGrid>
              <FormField
                control={form.control}
                name='chat_id'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Required group or channel')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder='@channel / -1001234567890'
                        disabled={disabled}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='join_url'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Group or channel join link')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type='url'
                        placeholder='https://t.me/channel'
                        disabled={disabled}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SettingsFormGrid>
          )}
          <div className='flex flex-wrap items-center gap-3'>
            <Button
              type='submit'
              disabled={disabled || !form.formState.isDirty}
            >
              {save.isPending ? t('Saving...') : t('Save trial settings')}
            </Button>
            <Button
              type='button'
              variant='outline'
              disabled={
                save.isPending || newUsers.isPending || !form.formState.isDirty
              }
              onClick={() => form.reset(props.initial)}
            >
              {t('Reset')}
            </Button>
          </div>
        </SettingsForm>
      </Form>
      <ConfirmDialog
        open={pendingValues !== null}
        onOpenChange={(open) => {
          if (!open && !save.isPending) setPendingValues(null)
        }}
        title={t('Lower the trial user ID requirement?')}
        desc={t(
          'Lowering the minimum user ID from {{previous}} to {{next}} allows more existing accounts to claim. Previous claims remain unchanged.',
          {
            previous: props.initial.min_user_id,
            next: pendingValues?.min_user_id,
          }
        )}
        confirmText={t('Save trial settings')}
        handleConfirm={() => {
          if (pendingValues && !save.isPending) save.mutate(pendingValues)
        }}
        isLoading={save.isPending}
      />
      <dl className='grid gap-4 rounded-xl border p-4 sm:grid-cols-2'>
        {[
          {
            label: t('Trial quota granted today'),
            quota: props.initial.today_granted,
          },
          {
            label: t('Total trial quota granted'),
            quota: props.initial.total_granted,
          },
        ].map((item) => (
          <div key={item.label}>
            <dt className='text-muted-foreground text-xs'>{item.label}</dt>
            <dd className='mt-1 text-sm font-medium'>
              {formatQuotaWithCurrency(item.quota, { abbreviate: false })}
            </dd>
          </div>
        ))}
      </dl>
    </>
  )
}
