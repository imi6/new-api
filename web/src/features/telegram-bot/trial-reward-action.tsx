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
import { useQuery } from '@tanstack/react-query'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { ArrowUpRight, CheckCircle2, Circle, Gift, Send } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { getTelegramTrialStatus } from './api'
import type { TelegramTrialStatus } from './types'

export function TrialRewardAction() {
  const { t } = useTranslation()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const trigger = (
    <Button
      type='button'
      variant='ghost'
      aria-label={t('Claim balance reward')}
      title={t('Claim balance reward')}
      className='size-8 gap-1.5 rounded-full bg-indigo-50 px-0 text-[13px] font-semibold text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800 sm:w-auto sm:px-3 dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25 dark:hover:text-indigo-200'
      render={
        !userId ? (
          <Link to='/sign-in' search={{ redirect: '/security#trial-reward' }} />
        ) : undefined
      }
    >
      <Gift className='trial-reward-gift size-4' aria-hidden='true' />
      <span className='hidden max-w-40 truncate sm:inline'>
        {t('Claim balance reward')}
      </span>
    </Button>
  )
  if (!userId) return trigger
  return (
    <UserTrialRewardAction key={userId} userId={userId} trigger={trigger} />
  )
}

function UserTrialRewardAction(props: {
  userId: number
  trigger: ReactElement
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const requested = useLocation({
    select: (location) => location.hash === 'trial-reward',
  })
  const [manuallyOpen, setManuallyOpen] = useState(false)
  const open = manuallyOpen || requested
  const close = () => {
    setManuallyOpen(false)
    if (requested) {
      void navigate({
        to: '.',
        search: true,
        hash: '',
        replace: true,
        resetScroll: false,
      })
    }
  }
  const status = useQuery({
    queryKey: ['telegram-bot', 'self', props.userId, 'trial'],
    queryFn: ({ signal }) => getTelegramTrialStatus(signal),
    staleTime: 60_000,
    refetchOnMount: requested ? 'always' : true,
    refetchInterval: open ? 10_000 : 60_000,
    refetchOnWindowFocus: 'always',
    meta: { errorToast: false, errorRedirect: false },
  })
  const visible =
    status.data?.enabled && status.data.user_id_eligible && !status.data.claimed
  if (!visible && !open) return null

  let content = <LoadingState className='min-h-40' />
  if (status.isError) {
    content = (
      <ErrorState
        description={t('Failed to load')}
        onRetry={() => void status.refetch()}
        className='min-h-40'
      />
    )
  } else if (status.data) {
    content = <TrialRewardDetails status={status.data} onSetup={close} />
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          close()
          return
        }
        setManuallyOpen(true)
        void status.refetch()
      }}
      title={t('Claim trial credit')}
      description={
        status.data?.user_id_eligible
          ? t('Open the bot and send /trial to claim your reward.')
          : undefined
      }
      contentClassName='sm:max-w-md'
      trigger={visible ? props.trigger : undefined}
    >
      {content}
    </Dialog>
  )
}

function TrialRewardDetails(props: {
  status: TelegramTrialStatus
  onSetup: () => void
}) {
  const { t, i18n } = useTranslation()
  useSystemConfigStore((state) => state.config.currency)
  const status = props.status
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  if (status.claimed) {
    return (
      <div className='flex flex-col items-center gap-3 py-8' role='status'>
        <CheckCircle2 className='text-success size-10' aria-hidden='true' />
        <p className='font-medium'>{t('Reward already claimed')}</p>
      </div>
    )
  }
  if (status.min_user_id > 0 && !status.user_id_eligible) {
    return (
      <p
        className='text-muted-foreground py-6 text-center text-sm'
        role='status'
      >
        {t(
          'Trial credit is only available to accounts with user ID {{id}} or higher.',
          {
            id: status.min_user_id,
          }
        )}
      </p>
    )
  }
  if (!status.enabled || !status.budget_available) {
    return (
      <p
        className='text-muted-foreground py-6 text-center text-sm'
        role='status'
      >
        {t('Trial rewards are currently unavailable.')}
      </p>
    )
  }

  const ready = status.email_bound && status.bot_connected
  const conditions = [
    {
      label: t('Bind an email'),
      met: status.email_bound,
      status: status.email_bound ? t('Bound') : t('Not bound'),
    },
    {
      label: t('Connect Telegram bot'),
      met: status.bot_connected,
      status: status.bot_connected ? t('Connected') : t('Not connected'),
    },
  ]
  return (
    <div className='space-y-5'>
      <div className='rounded-xl bg-indigo-50 p-5 text-center dark:bg-indigo-500/10'>
        <p className='text-sm text-indigo-600 dark:text-indigo-300'>
          {t('One-time reward')}
        </p>
        <p className='mt-2 text-3xl font-semibold tracking-tight text-indigo-700 tabular-nums dark:text-indigo-200'>
          {formatQuotaWithCurrency(status.quota, { abbreviate: false, locale })}
        </p>
      </div>
      <ul className='space-y-3'>
        {conditions.map((condition) => (
          <li key={condition.label} className='flex items-center gap-2 text-sm'>
            {condition.met ? (
              <CheckCircle2
                className='text-success size-4 shrink-0'
                aria-hidden='true'
              />
            ) : (
              <Circle
                className='text-muted-foreground size-4 shrink-0'
                aria-hidden='true'
              />
            )}
            <span className='flex-1'>
              {condition.label}
              <span className='sr-only'>: {condition.status}</span>
            </span>
            {!condition.met && (
              <Button
                variant='link'
                size='sm'
                aria-label={condition.label}
                onClick={props.onSetup}
                render={<Link to='/security' />}
              >
                {t('Settings')}
              </Button>
            )}
          </li>
        ))}
        {status.require_membership && (
          <li className='space-y-1 border-t pt-3'>
            <Button
              variant='link'
              className='h-auto max-w-full px-0 text-start whitespace-normal'
              render={
                <a
                  href={status.join_url}
                  target='_blank'
                  rel='noopener noreferrer'
                />
              }
            >
              {t('Join the required group or channel')}
              <ArrowUpRight className='size-4' aria-hidden='true' />
            </Button>
            <p className='text-muted-foreground text-xs'>
              {t('Group membership is checked by the bot when you claim.')}
            </p>
          </li>
        )}
      </ul>
      <p className='text-muted-foreground text-xs leading-relaxed'>
        {t(
          'Each site account, Telegram ID and email can claim only once, even after rebinding or deleting an account.'
        )}
      </p>
      {ready && status.bot_url && (
        <div className='flex flex-wrap items-center gap-2'>
          <CopyButton
            value='/trial'
            notify
            variant='outline'
            size='sm'
            aria-label={t('Copy /trial')}
          >
            {t('Copy /trial')}
          </CopyButton>
          <Button
            size='sm'
            className='flex-1'
            render={
              <a
                href={status.bot_url}
                target='_blank'
                rel='noopener noreferrer'
              />
            }
          >
            <Send className='size-4' aria-hidden='true' />
            {t('Open Telegram bot')}
          </Button>
        </div>
      )}
      <p className='text-muted-foreground text-xs'>
        {t(
          'Claim status is checked again by the bot before credit is granted.'
        )}
      </p>
    </div>
  )
}
