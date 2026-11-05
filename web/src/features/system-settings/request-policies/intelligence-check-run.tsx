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
import { Link } from '@tanstack/react-router'
import { CheckCircle2, Loader2, Play, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { handleServerError } from '@/lib/handle-server-error'

import {
  getActiveIntelligenceCheckRun,
  getIntelligenceCheckRun,
  type IntelligenceCheckRun,
  runIntelligenceChecksNow,
} from './api'

const RUN_POLL_MS = 3000

function isActive(run: IntelligenceCheckRun | null | undefined): boolean {
  return run?.status === 'pending' || run?.status === 'running'
}

/** Seconds since the run started, ticking on its own. */
function Elapsed(props: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.round(now / 1000 - props.since))
  return <>{`${seconds}s`}</>
}

interface IntelligenceCheckRunProps {
  /** Unsaved changes would not be checked, so the run waits for a save. */
  dirty: boolean
}

/**
 * "Check now" with the progress of the run: how many questions are answered,
 * how long it has taken, and the outcome. A run started before the page
 * opened is picked up too.
 */
export function IntelligenceCheckRunNow(props: IntelligenceCheckRunProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [taskId, setTaskId] = useState<string | null>(null)

  const active = useQuery({
    queryKey: ['intelligence-check-run', 'active'],
    queryFn: getActiveIntelligenceCheckRun,
  })
  const followedId = taskId ?? active.data?.task_id ?? null
  const run = useQuery({
    queryKey: ['intelligence-check-run', followedId],
    queryFn: () => getIntelligenceCheckRun(followedId ?? ''),
    enabled: followedId !== null,
    refetchInterval: (query) =>
      query.state.data && !isActive(query.state.data) ? false : RUN_POLL_MS,
  })
  const current = run.data
  const running = isActive(current)

  // New results replace what an open channel status dialog shows.
  useEffect(() => {
    if (current?.status === 'succeeded' || current?.status === 'failed') {
      void queryClient.invalidateQueries({ queryKey: ['intelligence-checks'] })
    }
  }, [current?.status, queryClient])

  const runNow = useMutation({
    mutationFn: runIntelligenceChecksNow,
    onSuccess: (data) => {
      setTaskId(data.task_id)
      toast.success(
        data.already_running
          ? t('A check is already running; its progress is shown below.')
          : t('Intelligence checks started.')
      )
    },
    onError: (error) => handleServerError(error),
    meta: { errorToast: false },
  })

  let hint = t('Runs every ticked question for every listed group now.')
  if (props.dirty) hint = t('Save the settings first.')

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-wrap items-center gap-3'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={props.dirty || runNow.isPending || running}
          onClick={() => runNow.mutate()}
        >
          {runNow.isPending || running ? (
            <Loader2 className='animate-spin' aria-hidden='true' />
          ) : (
            <Play aria-hidden='true' />
          )}
          {running ? t('Checking...') : t('Check now')}
        </Button>
        {!current && (
          <span className='text-muted-foreground text-xs'>{hint}</span>
        )}
      </div>

      {current && running && (
        <div
          className='bg-muted/40 flex flex-col gap-1 rounded-lg px-3 py-2 text-sm'
          role='status'
        >
          <span className='flex items-center gap-2 font-medium'>
            <Loader2 className='size-4 animate-spin' aria-hidden='true' />
            {current.status === 'pending' || !current.state
              ? t('Waiting to start...')
              : t('Answered {{processed}} of {{total}} questions', {
                  processed: current.state.processed,
                  total: current.state.total,
                })}
            <span className='text-muted-foreground font-normal tabular-nums'>
              · <Elapsed since={current.created_at} />
            </span>
          </span>
          <span className='text-muted-foreground text-xs'>
            {t(
              'Each answer can take one to several minutes, the drawing longer. You can leave this page; the check keeps running.'
            )}
          </span>
        </div>
      )}

      {current?.status === 'succeeded' && (
        <div
          className='bg-success/10 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-3 py-2 text-sm'
          role='status'
        >
          <CheckCircle2 className='text-success size-4' aria-hidden='true' />
          <span>
            {t(
              'Done: {{passed}} passed, {{failed}} failed, {{other}} could not be judged.',
              {
                passed: current.result?.passed ?? 0,
                failed: current.result?.failed ?? 0,
                other: current.result?.other ?? 0,
              }
            )}
          </span>
          <Link to='/channel-status' className='text-primary hover:underline'>
            {t('See the answers on the channel status page')}
          </Link>
        </div>
      )}

      {current?.status === 'failed' && (
        <div
          className='bg-destructive/10 text-destructive flex items-center gap-2 rounded-lg px-3 py-2 text-sm'
          role='status'
        >
          <XCircle className='size-4 shrink-0' aria-hidden='true' />
          <span className='break-all'>
            {current.error || t('The check run failed.')}
          </span>
        </div>
      )}
    </div>
  )
}
