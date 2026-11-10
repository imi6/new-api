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
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { CopyButton } from '@/components/copy-button'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { PasswordInput } from '@/components/password-input'
import { StatusBadge } from '@/components/status-badge'
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
import { Switch } from '@/components/ui/switch'
import {
  getTelegramBotConfig,
  testTelegramBot,
  updateTelegramBotConfig,
} from '@/features/telegram-bot/api'
import type { TelegramBotConfig } from '@/features/telegram-bot/types'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { ROLE } from '@/lib/roles'
import { translateServerText } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { FormNavigationGuard } from '../components/form-navigation-guard'
import {
  SettingsForm,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'

const configSchema = z.object({
  enabled: z.boolean(),
  bot_token: z.string().trim(),
  version: z.number().int().nonnegative(),
})
type BotConfigValues = z.infer<typeof configSchema>
const configQueryKey = ['telegram-bot', 'config'] as const

export function TelegramBotSection() {
  const { t } = useTranslation()
  const role = useAuthStore((state) => state.auth.user?.role ?? 0)
  const query = useQuery({
    queryKey: configQueryKey,
    queryFn: ({ signal }) => getTelegramBotConfig(signal),
    enabled: role >= ROLE.ADMIN,
    refetchOnWindowFocus: false,
  })

  return (
    <SettingsSection title={t('Telegram Bot')}>
      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {query.data && (
        <TelegramBotSettingsForm
          initial={query.data}
          canEdit={role >= ROLE.SUPER_ADMIN}
          onRefresh={() => void query.refetch()}
          refreshing={query.isFetching}
        />
      )}
    </SettingsSection>
  )
}

function TelegramBotSettingsForm(props: {
  initial: TelegramBotConfig
  canEdit: boolean
  onRefresh: () => void
  refreshing: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const queryClient = useQueryClient()
  const form = useForm<BotConfigValues>({
    resolver: zodResolver(configSchema),
    defaultValues: {
      enabled: props.initial.enabled,
      bot_token: '',
      version: props.initial.version,
    },
  })
  useResetForm(
    form,
    form.formState.isDirty
      ? undefined
      : {
          enabled: props.initial.enabled,
          bot_token: '',
          version: props.initial.version,
        }
  )
  const save = useMutation({
    mutationFn: (values: BotConfigValues) =>
      updateTelegramBotConfig({
        enabled: values.enabled,
        version: values.version,
        ...(values.bot_token ? { bot_token: values.bot_token } : {}),
      }),
    onSuccess: async (saved) => {
      form.reset({
        enabled: saved.enabled,
        bot_token: '',
        version: saved.version,
      })
      queryClient.setQueryData(configQueryKey, saved)
      await queryClient.invalidateQueries({
        queryKey: ['telegram-bot', 'self'],
      })
      if (saved.enabled && saved.webhook_status !== 'ready') {
        toast.error(t('Webhook registration failed. Please retry.'))
      } else {
        toast.success(t('Saved successfully'))
      }
    },
  })
  const test = useMutation({
    mutationFn: () => testTelegramBot(true),
    onSuccess: () => toast.success(t('Telegram bot message was queued')),
  })
  const disabled = !props.canEdit || save.isPending
  const submit = form.handleSubmit((values) => save.mutate(values))
  const hasWebhook = props.initial.webhook_status === 'ready'

  return (
    <>
      <FormNavigationGuard when={form.formState.isDirty} />
      <SettingsPageFormActions
        onSave={() => void submit()}
        onReset={() =>
          form.reset({
            enabled: props.initial.enabled,
            bot_token: '',
            version: props.initial.version,
          })
        }
        isSaving={save.isPending}
        isSaveDisabled={disabled || !form.formState.isDirty}
        isResetDisabled={save.isPending || !form.formState.isDirty}
      />
      <Alert>
        <AlertDescription>
          {t(
            'Use the same bot as Telegram login. Users authorize once to link their account and optionally enable bot features.'
          )}
        </AlertDescription>
      </Alert>
      <Form {...form}>
        <SettingsForm onSubmit={submit}>
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <div className='min-w-0 space-y-1'>
                  <FormLabel>{t('Enable Telegram bot')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Disabling the bot pauses commands and messages without changing Telegram login.'
                    )}
                  </FormDescription>
                </div>
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
            name='bot_token'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Bot Token')}</FormLabel>
                <FormControl>
                  <PasswordInput
                    {...field}
                    autoComplete='new-password'
                    placeholder={
                      props.initial.token_configured
                        ? t('Configured — leave blank to keep')
                        : t('Enter the Bot Token from BotFather')
                    }
                    disabled={disabled}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'The token is stored on the server and is never returned. It is different from the OAuth Client Secret.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className='flex flex-wrap items-center gap-2'>
            <StatusBadge
              copyable={false}
              label={
                props.initial.token_configured
                  ? t('Token configured')
                  : t('Token not configured')
              }
              variant={props.initial.token_configured ? 'success' : 'neutral'}
            />
            {props.initial.bot_username && (
              <span className='text-sm'>@{props.initial.bot_username}</span>
            )}
            {props.initial.bot_id && (
              <span className='text-muted-foreground text-xs'>
                {t('Bot ID')}: {props.initial.bot_id}
              </span>
            )}
          </div>
        </SettingsForm>
      </Form>
      <div className='space-y-4 rounded-xl border p-4'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <h4 className='text-sm font-medium'>{t('Bot connection status')}</h4>
          <div className='flex gap-2'>
            {props.initial.enabled &&
              props.initial.token_configured &&
              !hasWebhook && (
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() =>
                    save.mutate({
                      enabled: props.initial.enabled,
                      version: props.initial.version,
                      bot_token: '',
                    })
                  }
                  disabled={
                    disabled || props.refreshing || form.formState.isDirty
                  }
                >
                  {t('Retry webhook registration')}
                </Button>
              )}
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={props.onRefresh}
              disabled={props.refreshing || save.isPending}
            >
              <RefreshCw
                className={props.refreshing ? 'animate-spin' : undefined}
                aria-hidden='true'
              />
              {t('Refresh')}
            </Button>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => test.mutate()}
              disabled={!props.initial.enabled || test.isPending}
            >
              {t('Send test message')}
            </Button>
          </div>
        </div>
        <p className='text-muted-foreground text-xs'>
          {t('Test messages go only to your own connected Telegram account.')}
        </p>
        <div className='grid min-w-0 gap-4 sm:grid-cols-3'>
          <div>
            <p className='text-muted-foreground mb-2 text-xs'>
              {t('Webhook status')}
            </p>
            <StatusBadge
              label={hasWebhook ? t('Connected') : t('Not connected')}
              variant={hasWebhook ? 'success' : 'warning'}
              copyable={false}
            />
          </div>
          <div>
            <p className='text-muted-foreground text-xs'>
              {t('Pending incoming messages')}
            </p>
            <p className='mt-1 text-sm font-medium'>
              {formatNumber(props.initial.pending_inbox, locale)}
            </p>
          </div>
          <div>
            <p className='text-muted-foreground text-xs'>
              {t('Pending outgoing messages')}
            </p>
            <p className='mt-1 text-sm font-medium'>
              {formatNumber(props.initial.pending_outbox, locale)}
            </p>
          </div>
        </div>
        {props.initial.webhook_url && (
          <div className='space-y-1'>
            <p className='text-muted-foreground text-xs'>{t('Webhook URL')}</p>
            <div className='flex min-w-0 items-center gap-2'>
              <code className='min-w-0 text-xs break-all'>
                {props.initial.webhook_url}
              </code>
              <CopyButton
                value={props.initial.webhook_url}
                aria-label={t('Copy webhook URL')}
              />
            </div>
          </div>
        )}
        {props.initial.last_error && (
          <Alert variant='destructive'>
            <AlertDescription>
              {translateServerText(t, props.initial.last_error)}
            </AlertDescription>
          </Alert>
        )}
      </div>
      <p className='text-muted-foreground text-xs'>
        {t(
          'The webhook is configured automatically. Existing webhooks from other services are not overwritten. Do not use this bot with another message processing service.'
        )}
      </p>
    </>
  )
}
