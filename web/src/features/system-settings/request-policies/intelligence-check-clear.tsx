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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DateTimePicker } from '@/components/datetime-picker'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'

import { clearIntelligenceChecks } from './api'

type ClearScope = 'before' | 'all'

const DAY_MS = 24 * 3600 * 1000

const QUICK_PICKS = [
  { labelKey: '24 hours ago', days: 1 },
  { labelKey: '7 days ago', days: 7 },
  { labelKey: '30 days ago', days: 30 },
] as const

/**
 * Deletes stored intelligence check results: those older than a chosen time,
 * or all of them. A check still running is left alone, and the next
 * scheduled check still waits its interval.
 */
export function IntelligenceCheckClear() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [scope, setScope] = useState<ClearScope>('before')
  const [before, setBefore] = useState<Date | undefined>(
    () => new Date(Date.now() - 7 * DAY_MS)
  )
  const [confirming, setConfirming] = useState(false)

  const clear = useMutation({
    mutationFn: () =>
      clearIntelligenceChecks(
        scope === 'all' || !before ? 0 : Math.floor(before.getTime() / 1000)
      ),
    onSuccess: (data) => {
      setConfirming(false)
      toast.success(
        t('Deleted {{count}} check results.', { count: data.deleted })
      )
      void queryClient.invalidateQueries({ queryKey: ['intelligence-checks'] })
    },
    onError: (error) => handleServerError(error),
    meta: { errorToast: false },
  })

  const canClear = scope === 'all' || before !== undefined
  const description =
    scope === 'all'
      ? t(
          'All stored check results are deleted, for every group. This cannot be undone.'
        )
      : t(
          'Check results from before {{time}} are deleted, for every group. This cannot be undone.',
          {
            time: before
              ? formatTimestampToDate(before.getTime(), 'milliseconds')
              : '',
          }
        )

  return (
    <div className='flex flex-col gap-3'>
      <ToggleGroup
        value={[scope]}
        onValueChange={(values) => {
          const next = values.find((value) => value !== scope)
          if (next) setScope(next as ClearScope)
        }}
        aria-label={t('What to delete')}
        variant='outline'
        size='sm'
        spacing={2}
        className='self-start'
      >
        <ToggleGroupItem value='before'>
          {t('Results before a time')}
        </ToggleGroupItem>
        <ToggleGroupItem value='all'>{t('All results')}</ToggleGroupItem>
      </ToggleGroup>

      {scope === 'before' && (
        <div className='flex flex-col gap-2'>
          <DateTimePicker value={before} onChange={setBefore} />
          <div className='flex flex-wrap gap-2'>
            {QUICK_PICKS.map((pick) => (
              <Button
                key={pick.labelKey}
                type='button'
                variant='outline'
                size='sm'
                onClick={() =>
                  setBefore(new Date(Date.now() - pick.days * DAY_MS))
                }
              >
                {t(pick.labelKey)}
              </Button>
            ))}
          </div>
        </div>
      )}

      <Button
        type='button'
        variant='destructive'
        size='sm'
        className='self-start'
        disabled={!canClear || clear.isPending}
        onClick={() => setConfirming(true)}
      >
        <Trash2 aria-hidden='true' />
        {scope === 'all' ? t('Clear all results') : t('Clear older results')}
      </Button>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('Clear check results')}
        desc={description}
        handleConfirm={() => clear.mutate()}
        isLoading={clear.isPending}
        destructive
        confirmText={t('Delete')}
      />
    </div>
  )
}
