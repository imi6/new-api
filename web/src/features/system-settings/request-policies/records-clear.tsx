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

type ClearScope = 'before' | 'all'

/** A button that sets the time to this many minutes ago. */
export type ClearQuickPick = { labelKey: string; minutes: number }

interface RecordsClearProps {
  /** Heading and confirm dialog title. */
  title: string
  /** Deletes the records before the Unix time, or all when it is zero. */
  clear: (before: number) => Promise<{ deleted: number }>
  /** Queries that show the records, refreshed after a clear. */
  invalidateKeys: string[][]
  quickPicks: readonly ClearQuickPick[]
  /** Minutes ago the time starts at. */
  defaultMinutes: number
  /** The confirm text for deleting all records. */
  allDescription: string
  /** The confirm text for deleting records before the formatted time. */
  beforeDescription: (time: string) => string
  /** The toast after a clear. */
  successMessage: (deleted: number) => string
}

/**
 * Deletes stored records: those older than a chosen time, or all of them,
 * after a confirmation. Scope, time, quick picks and the button share one
 * row and wrap only when it is too narrow.
 */
export function RecordsClear(props: RecordsClearProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [scope, setScope] = useState<ClearScope>('before')
  const [before, setBefore] = useState<Date | undefined>(
    () => new Date(Date.now() - props.defaultMinutes * 60_000)
  )
  const [confirming, setConfirming] = useState(false)

  const clear = useMutation({
    mutationFn: () =>
      props.clear(
        scope === 'all' || !before ? 0 : Math.floor(before.getTime() / 1000)
      ),
    onSuccess: (data) => {
      setConfirming(false)
      toast.success(props.successMessage(data.deleted))
      for (const queryKey of props.invalidateKeys) {
        void queryClient.invalidateQueries({ queryKey })
      }
    },
    onError: (error) => handleServerError(error),
    meta: { errorToast: false },
  })

  const canClear = scope === 'all' || before !== undefined
  const description =
    scope === 'all'
      ? props.allDescription
      : props.beforeDescription(
          before ? formatTimestampToDate(before.getTime(), 'milliseconds') : ''
        )

  return (
    <div className='flex flex-col gap-2'>
      <span className='text-sm font-medium'>{props.title}</span>
      <div className='flex flex-wrap items-center gap-2'>
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
        >
          <ToggleGroupItem value='before'>
            {t('Results before a time')}
          </ToggleGroupItem>
          <ToggleGroupItem value='all'>{t('All results')}</ToggleGroupItem>
        </ToggleGroup>
        {scope === 'before' && (
          <DateTimePicker
            value={before}
            onChange={setBefore}
            className='w-full sm:w-80'
          />
        )}
        {scope === 'before' &&
          props.quickPicks.map((pick) => (
            <Button
              key={pick.labelKey}
              type='button'
              variant='outline'
              size='sm'
              onClick={() =>
                setBefore(new Date(Date.now() - pick.minutes * 60_000))
              }
            >
              {t(pick.labelKey)}
            </Button>
          ))}
        <Button
          type='button'
          variant='destructive'
          size='sm'
          disabled={!canClear || clear.isPending}
          onClick={() => setConfirming(true)}
        >
          <Trash2 aria-hidden='true' />
          {scope === 'all'
            ? t('Clear all results')
            : t('Clear older results')}
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={props.title}
        desc={description}
        handleConfirm={() => clear.mutate()}
        isLoading={clear.isPending}
        destructive
        confirmText={t('Delete')}
      />
    </div>
  )
}
