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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, RefreshCw, Send, Settings } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { StatusBadge } from '@/components/status-badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { UserProfile } from '@/features/profile/types'
import { SettingsSwitchField } from '@/features/system-settings/components/settings-form-layout'
import {
  confirmTelegramRecovery,
  disconnectTelegramBot,
  getTelegramBotStatus,
  startTelegramRecovery,
  testTelegramBot,
  updateTelegramPreferences,
} from '@/features/telegram-bot/api'
import { TelegramNotificationFields } from '@/features/telegram-bot/notification-fields'
import {
  DEFAULT_TELEGRAM_PREFERENCES,
  type TelegramBotPreferences,
  type TelegramBotRecovery,
} from '@/features/telegram-bot/types'
import { handleServerError } from '@/lib/handle-server-error'
import {
  getServerErrorMessageKey,
  getServerErrorSources,
  translateServerText,
} from '@/lib/server-error-message'

interface TelegramBotCardProps {
  profile: UserProfile
  oauthEnabled: boolean
  locked: boolean
  onAuthorize: (preferences?: TelegramBotPreferences, botOnly?: boolean) => void
}

export function TelegramBotCard(props: TelegramBotCardProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const queryKey = ['telegram-bot', 'self', props.profile.id] as const
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => getTelegramBotStatus(signal),
    refetchOnWindowFocus: false,
    refetchInterval: (state) =>
      state.state.data?.status === 'connecting' ? 2500 : false,
  })
  const [authorizeOpen, setAuthorizeOpen] = useState(false)
  const [connectBot, setConnectBot] = useState(true)
  const [preferences, setPreferences] = useState<TelegramBotPreferences>(
    DEFAULT_TELEGRAM_PREFERENCES
  )
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [recovery, setRecovery] = useState<TelegramBotRecovery | null>(null)
  const [preferencesConflict, setPreferencesConflict] = useState(false)
  const refresh = () => queryClient.invalidateQueries({ queryKey })
  const disconnect = useMutation({
    mutationFn: disconnectTelegramBot,
    onSuccess: async () => {
      setDisconnectOpen(false)
      await refresh()
    },
  })
  const test = useMutation({
    mutationFn: () => testTelegramBot(),
    onSuccess: () => toast.success(t('Telegram bot message was queued')),
  })
  const recover = useMutation({
    mutationFn: startTelegramRecovery,
    onSuccess: setRecovery,
  })
  const confirmRecovery = useMutation({
    mutationFn: () => confirmTelegramRecovery(recovery?.flow_token ?? ''),
    onSuccess: async () => {
      setRecovery(null)
      await refresh()
    },
  })
  const data = query.data
  const bound = Boolean(props.profile.telegram_id)
  const canDisconnect =
    data?.status === 'connected' ||
    data?.status === 'connecting' ||
    data?.status === 'blocked'
  const busy =
    props.locked || disconnect.isPending || test.isPending || recover.isPending
  let statusLabel = t('Not bound')
  let statusTone: 'neutral' | 'success' | 'warning' = 'neutral'
  if (bound) statusLabel = t('Bound')
  if (data?.status === 'connecting') {
    statusLabel = t('Connecting bot')
    statusTone = 'warning'
  } else if (data?.connected) {
    statusLabel = t('Bot connected')
    statusTone = 'success'
  } else if (data?.status === 'blocked') {
    statusLabel = t('Bot delivery blocked')
    statusTone = 'warning'
  }

  const beginAuthorization = () => {
    if (!data?.available && !bound) {
      props.onAuthorize()
      return
    }
    setConnectBot(true)
    setPreferences(
      data && data.preferences_version > 0
        ? data.preferences
        : DEFAULT_TELEGRAM_PREFERENCES
    )
    setAuthorizeOpen(true)
  }

  if (!props.oauthEnabled && !bound && !data?.available) return null

  return (
    <li className='col-span-full min-w-0 space-y-4 rounded-lg border p-3'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='flex min-w-0 items-center gap-2'>
          <div className='bg-muted shrink-0 rounded-md p-1.5'>
            <Send className='size-4' aria-hidden='true' />
          </div>
          <div className='min-w-0'>
            <div className='flex flex-wrap items-center gap-2'>
              <p className='text-sm font-medium'>{t('Telegram')}</p>
              <StatusBadge
                label={statusLabel}
                variant={statusTone}
                copyable={false}
              />
            </div>
            <p className='text-muted-foreground mt-1 text-xs'>
              {bound
                ? t('Linked Telegram ID: {{id}}', {
                    id: `…${props.profile.telegram_id?.slice(-4)}`,
                  })
                : t('Link Telegram for login and optional bot features.')}
              {data?.bot_username && ` · @${data.bot_username}`}
            </p>
          </div>
        </div>
        <div className='flex flex-wrap gap-2'>
          {props.oauthEnabled &&
            (!bound || (!data?.connected && data?.available)) && (
              <Button
                variant='outline'
                size='sm'
                disabled={
                  busy || query.isLoading || data?.status === 'connecting'
                }
                onClick={beginAuthorization}
              >
                {bound ? t('Enable bot') : t('Bind')}
              </Button>
            )}
          {data?.connected && data.deep_link.startsWith('https://t.me/') && (
            <Button
              variant='outline'
              size='sm'
              render={
                <a
                  href={data.deep_link}
                  target='_blank'
                  rel='noopener noreferrer'
                />
              }
            >
              <ExternalLink aria-hidden='true' />
              {t('Open bot')}
            </Button>
          )}
          {data?.connected && (
            <Button
              variant='outline'
              size='sm'
              disabled={busy || !data.available}
              aria-haspopup='dialog'
              aria-expanded={settingsOpen}
              onClick={() => {
                setPreferencesConflict(false)
                setSettingsOpen(true)
              }}
            >
              <Settings aria-hidden='true' />
              {t('Bot settings')}
            </Button>
          )}
          {canDisconnect && (
            <Button
              variant='ghost'
              size='sm'
              disabled={busy}
              onClick={() => setDisconnectOpen(true)}
            >
              {t('Disconnect bot')}
            </Button>
          )}
          {bound &&
            data?.available &&
            !data.connected &&
            data.status !== 'connecting' && (
              <Button
                variant='outline'
                size='sm'
                disabled={busy}
                onClick={() => recover.mutate()}
              >
                {t('Recover through bot')}
              </Button>
            )}
        </div>
      </div>
      {query.isLoading && (
        <p role='status' className='text-muted-foreground text-xs'>
          {t('Loading...')}
        </p>
      )}
      {query.isError && (!settingsOpen || !data?.connected) && (
        <Alert>
          <AlertDescription className='flex flex-wrap items-center justify-between gap-2'>
            {t(
              'Bot status is unavailable. You can retry without changing your Telegram login.'
            )}
            <Button
              variant='outline'
              size='sm'
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              {t('Retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {bound && data && !data.available && (
        <p className='text-muted-foreground text-xs'>
          {t(
            'The bot is disabled by the administrator. Telegram login is unchanged.'
          )}
        </p>
      )}
      {data?.last_error && (
        <Alert>
          <AlertDescription>
            {translateServerText(t, data.last_error)}
          </AlertDescription>
        </Alert>
      )}
      {data?.connected && settingsOpen && (
        <TelegramBotSettingsDialog
          key={data.preferences_version}
          initial={data.preferences}
          version={data.preferences_version}
          disabled={busy || !data.available}
          conflict={preferencesConflict}
          statusError={query.isError}
          refreshing={query.isFetching}
          onClose={() => setSettingsOpen(false)}
          onTest={() => test.mutate()}
          onRefresh={() => void query.refetch()}
          onSaved={async () => {
            setPreferencesConflict(false)
            await refresh()
          }}
          onConflict={async () => {
            setPreferencesConflict(true)
            await query.refetch({ throwOnError: true })
          }}
        />
      )}
      {data?.status === 'connecting' && (
        <p
          role='status'
          className='text-muted-foreground flex items-center gap-2 text-xs'
        >
          <RefreshCw className='size-3 animate-spin' aria-hidden='true' />
          {t('Telegram is linked. The bot connection is being verified.')}
        </p>
      )}
      <Dialog
        open={authorizeOpen}
        onOpenChange={setAuthorizeOpen}
        title={bound ? t('Enable Telegram bot') : t('Bind Telegram Account')}
        description={t(
          'One Telegram authorization can link your account and enable the bot. Notifications are optional.'
        )}
        contentClassName='sm:max-w-xl'
        bodyClassName='space-y-4'
        footer={
          <Button
            onClick={() => {
              setAuthorizeOpen(false)
              props.onAuthorize(connectBot ? preferences : undefined, bound)
            }}
            disabled={busy || (bound && !connectBot)}
          >
            {t('Continue')}
          </Button>
        }
      >
        {!bound && (
          <SettingsSwitchField
            controlId='telegram-bot-consent'
            label={t('Connect bot with this authorization')}
            description={t(
              'Allow the site bot to send connection confirmations and use private account commands.'
            )}
            checked={connectBot}
            onCheckedChange={setConnectBot}
          />
        )}
        {connectBot && (
          <TelegramNotificationFields
            value={preferences}
            onChange={setPreferences}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title={t('Disconnect Telegram bot?')}
        desc={t(
          'This stops bot commands and notifications. Your Telegram login remains linked.'
        )}
        confirmText={t('Disconnect bot')}
        destructive
        isLoading={disconnect.isPending}
        handleConfirm={() => disconnect.mutate()}
      />
      <Dialog
        open={recovery !== null}
        onOpenChange={(open) => !open && setRecovery(null)}
        title={t('Recover Telegram bot connection')}
        description={t(
          'Open the bot and press Start, then return here to confirm. The link expires in five minutes.'
        )}
        contentClassName='sm:max-w-md'
        footer={
          <Button
            disabled={confirmRecovery.isPending}
            onClick={() => confirmRecovery.mutate()}
          >
            {t('Confirm connection')}
          </Button>
        }
      >
        {recovery?.url.startsWith('https://t.me/') && (
          <Button
            render={
              <a
                href={recovery.url}
                target='_blank'
                rel='noopener noreferrer'
              />
            }
          >
            {t('Open bot')}
          </Button>
        )}
      </Dialog>
    </li>
  )
}

function TelegramBotSettingsDialog(props: {
  initial: TelegramBotPreferences
  version: number
  disabled: boolean
  conflict: boolean
  statusError: boolean
  refreshing: boolean
  onClose: () => void
  onTest: () => void
  onRefresh: () => void
  onSaved: () => Promise<unknown>
  onConflict: () => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [preferences, setPreferences] = useState(props.initial)
  const [stale, setStale] = useState(false)
  const save = useMutation({
    mutationFn: () =>
      updateTelegramPreferences({ version: props.version, preferences }),
    onSuccess: async () => {
      toast.success(t('Saved successfully'))
      await props.onSaved()
    },
    onError: async (error) => {
      const changedKey =
        'Telegram bot settings changed. Please reload and try again.'
      const conflict =
        getServerErrorMessageKey(error) === changedKey ||
        getServerErrorSources(error).some(
          (source) => source.message_key === changedKey
        )
      if (!conflict) {
        handleServerError(error)
        return
      }
      setStale(true)
      try {
        await props.onConflict()
      } catch (refreshError) {
        handleServerError(refreshError)
      }
    },
  })
  const changed = Object.keys(preferences).some(
    (key) =>
      preferences[key as keyof TelegramBotPreferences] !==
      props.initial[key as keyof TelegramBotPreferences]
  )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) props.onClose()
      }}
      title={t('Bot settings')}
      contentClassName='sm:max-w-xl'
      bodyClassName='space-y-4'
      showCloseButton={!save.isPending}
      footer={
        <>
          <Button
            variant='outline'
            className='sm:mr-auto'
            disabled={props.disabled || save.isPending}
            onClick={props.onTest}
          >
            <Send aria-hidden='true' />
            {t('Send test message')}
          </Button>
          <Button
            variant='ghost'
            disabled={save.isPending}
            onClick={props.onClose}
          >
            {t('Close')}
          </Button>
          <Button
            disabled={!changed || props.disabled || save.isPending || stale}
            onClick={() => save.mutate()}
          >
            {save.isPending ? t('Saving...') : t('Save Changes')}
          </Button>
        </>
      }
    >
      {props.statusError && (
        <Alert>
          <AlertDescription className='flex flex-wrap items-center justify-between gap-2'>
            {t(
              'Bot status is unavailable. You can retry without changing your Telegram login.'
            )}
            <Button
              variant='outline'
              size='sm'
              onClick={props.onRefresh}
              disabled={props.refreshing}
            >
              {t('Retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {props.conflict && (
        <Alert>
          <AlertDescription>
            {t(
              'Notification settings changed elsewhere. Review the latest settings before saving.'
            )}
          </AlertDescription>
        </Alert>
      )}
      <TelegramNotificationFields
        value={preferences}
        onChange={setPreferences}
        disabled={props.disabled || save.isPending || stale}
      />
    </Dialog>
  )
}
