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
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { formatTimestampToDate } from '@/lib/format'

import type { GroupRenameStatus } from './group-rename-api'

type GroupRenameStatusAlertProps = {
  status: GroupRenameStatus
  isCanceling: boolean
  onCancel: () => void
}

/**
 * The rename the server is finishing in the background. Requests keep working
 * during it; group settings stay read-only until it is done.
 */
export function GroupRenameStatusAlert(props: GroupRenameStatusAlertProps) {
  const { t } = useTranslation()
  const alias = props.status.alias
  if (!alias) return null

  let step: string
  if (alias.phase === 'announced') {
    step = t('Waiting for every server to load the new name.')
  } else if (!props.status.settle_at) {
    step = t('References moved. Waiting for every server to switch over.')
  } else {
    step = t('Finishing at {{time}} after caches expire.', {
      time: formatTimestampToDate(props.status.settle_at),
    })
  }

  return (
    <Alert>
      <Loader2 className='animate-spin' aria-hidden='true' />
      <AlertTitle>
        {t('Renaming {{old}} to {{new}}', { old: alias.old, new: alias.new })}
      </AlertTitle>
      <AlertDescription className='flex flex-col gap-1'>
        <span>{step}</span>
        <span>
          {t(
            'Both names work while the rename runs. Group settings can be edited after it finishes.'
          )}
        </span>
        {alias.phase !== 'announced' && (
          <span>
            {t(
              'Updated {{users}} users, {{tokens}} API keys, {{channels}} channels and {{subscriptions}} subscriptions.',
              {
                users: alias.users,
                tokens: alias.tokens,
                channels: alias.channels,
                subscriptions: alias.subscriptions,
              }
            )}
          </span>
        )}
        {props.status.waiting.length > 0 && (
          <span className='break-all'>
            {t('Waiting for: {{nodes}}', {
              nodes: props.status.waiting.join(', '),
            })}
          </span>
        )}
        {alias.error && (
          <span className='text-destructive'>
            {t(alias.error.key, alias.error.params)}
          </span>
        )}
        {alias.phase === 'announced' && (
          <div>
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={props.isCanceling}
              onClick={props.onCancel}
            >
              {t('Cancel rename')}
            </Button>
          </div>
        )}
      </AlertDescription>
    </Alert>
  )
}
