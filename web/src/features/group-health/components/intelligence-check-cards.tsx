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
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  HelpCircle,
  Loader2,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Markdown } from '@/components/ui/markdown'
import { formatLatency } from '@/features/performance-metrics/lib/format'
import dayjs from '@/lib/dayjs'
import { cn } from '@/lib/utils'

import {
  DRAWING_CHECK_LABEL_KEYS,
  INTELLIGENCE_VERDICT_LABEL_KEYS,
  intelligenceVerdict,
  type IntelligenceVerdict,
} from '../lib/intelligence-check'
import type { IntelligenceCheck } from '../types'
import { DrawingFrame } from './drawing-frame'

const VERDICT_STRIP: Record<IntelligenceVerdict, string> = {
  running: 'bg-info',
  passed: 'bg-success',
  failed: 'bg-destructive',
  undetermined: 'bg-muted-foreground/40',
  error: 'bg-muted-foreground/40',
  interrupted: 'bg-muted-foreground/40',
}

const VERDICT_BADGE: Record<IntelligenceVerdict, string> = {
  running: 'bg-info/15 text-info',
  passed: 'bg-success text-white',
  failed: 'bg-destructive text-white',
  undetermined: 'bg-muted text-muted-foreground',
  error: 'bg-muted text-muted-foreground',
  interrupted: 'bg-muted text-muted-foreground',
}

const VERDICT_TEXT: Record<IntelligenceVerdict, string> = {
  running: 'text-info',
  passed: 'text-success',
  failed: 'text-destructive',
  undetermined: 'text-muted-foreground',
  error: 'text-muted-foreground',
  interrupted: 'text-muted-foreground',
}

function VerdictIcon(props: { verdict: IntelligenceVerdict }) {
  switch (props.verdict) {
    case 'running':
      return <Loader2 className='size-5 animate-spin' aria-hidden='true' />
    case 'passed':
      return <Check className='size-5' aria-hidden='true' />
    case 'failed':
      return <X className='size-5' aria-hidden='true' />
    case 'undetermined':
      return <HelpCircle className='size-5' aria-hidden='true' />
    default:
      return <AlertCircle className='size-5' aria-hidden='true' />
  }
}

function checkedAt(check: IntelligenceCheck): string {
  return dayjs(check.created_at * 1000).format('MM/DD HH:mm:ss')
}

/** Channel and error, which the server sends to administrators only. */
function AdminDetails(props: { check: IntelligenceCheck }) {
  const { t } = useTranslation()
  if (!props.check.channel_id && !props.check.error) return null
  return (
    <div className='text-muted-foreground flex flex-col gap-0.5 text-xs'>
      {props.check.channel_id ? (
        <span>{t('Channel #{{id}}', { id: props.check.channel_id })}</span>
      ) : null}
      {props.check.error && (
        <span className='break-all'>{props.check.error}</span>
      )}
    </div>
  )
}

export function CandyCheckCard(props: { check: IntelligenceCheck }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const check = props.check
  const verdict = intelligenceVerdict(check)
  const hasAnswer = verdict === 'passed' || verdict === 'failed'

  return (
    <div className='bg-card ring-foreground/10 relative flex min-w-0 flex-col gap-3 overflow-hidden rounded-2xl p-4 pt-5 ring-1'>
      <span
        aria-hidden='true'
        className={cn('absolute inset-x-0 top-0 h-1', VERDICT_STRIP[verdict])}
      />
      <div className='flex min-w-0 items-center justify-between gap-2'>
        <span className='truncate font-mono text-xs'>{check.model_name}</span>
        {check.latency_ms > 0 && (
          <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
            {formatLatency(check.latency_ms)}
          </span>
        )}
      </div>

      <div className='grid grid-cols-[1fr_auto_1fr] items-center gap-2'>
        <div className='bg-muted/30 flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5'>
          <span className='text-muted-foreground text-xs'>
            {t('Expected answer')}
          </span>
          <span className='text-xl font-semibold tabular-nums'>
            {check.expected_answer || '—'}
          </span>
        </div>
        <div className='flex flex-col items-center gap-1'>
          <span
            className={cn(
              'flex size-9 items-center justify-center rounded-full',
              VERDICT_BADGE[verdict]
            )}
          >
            <VerdictIcon verdict={verdict} />
          </span>
          <span className={cn('text-xs font-medium', VERDICT_TEXT[verdict])}>
            {t(INTELLIGENCE_VERDICT_LABEL_KEYS[verdict])}
          </span>
        </div>
        <div
          className={cn(
            'flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5',
            verdict === 'passed' && 'border-success/40 bg-success/10',
            verdict === 'failed' && 'border-destructive/40 bg-destructive/10'
          )}
        >
          <span className='text-muted-foreground text-xs'>
            {t('Model answer')}
          </span>
          <span
            className={cn(
              'text-xl font-semibold tabular-nums',
              VERDICT_TEXT[verdict]
            )}
          >
            {hasAnswer && check.answer ? check.answer : '—'}
          </span>
        </div>
      </div>

      <div className='flex flex-col gap-1'>
        <span className='text-muted-foreground text-xs'>{t('AI output:')}</span>
        {check.response === '' && (
          <p className='bg-muted/30 text-muted-foreground rounded-xl px-3 py-2 text-sm'>
            {verdict === 'running'
              ? t('Waiting for the answer...')
              : t(INTELLIGENCE_VERDICT_LABEL_KEYS[verdict])}
          </p>
        )}
        {check.response !== '' && (
          <div
            className={cn(
              'bg-muted/30 relative rounded-xl px-3 py-2',
              !expanded && 'max-h-28 overflow-hidden'
            )}
          >
            <Markdown className='text-sm'>{check.response}</Markdown>
            {!expanded && (
              <span
                aria-hidden='true'
                className='from-card pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t to-transparent'
              />
            )}
          </div>
        )}
      </div>

      <AdminDetails check={check} />

      <div className='text-muted-foreground mt-auto flex items-center justify-between gap-2 text-xs'>
        <span className='flex items-center gap-1'>
          <Clock className='size-3.5' aria-hidden='true' />
          {t('Checked at {{time}}', { time: checkedAt(check) })}
        </span>
        {check.response !== '' && (
          <button
            type='button'
            onClick={() => setExpanded(!expanded)}
            className='text-primary flex items-center gap-0.5 hover:underline'
            aria-expanded={expanded}
          >
            {expanded ? t('Collapse answer') : t('Show full answer')}
            {expanded ? (
              <ChevronUp className='size-3.5' aria-hidden='true' />
            ) : (
              <ChevronDown className='size-3.5' aria-hidden='true' />
            )}
          </button>
        )}
      </div>
    </div>
  )
}

interface PelicanCheckCardProps {
  check: IntelligenceCheck
  onOpen: (check: IntelligenceCheck) => void
}

export function PelicanCheckCard(props: PelicanCheckCardProps) {
  const { t } = useTranslation()
  const check = props.check
  const verdict = intelligenceVerdict(check)
  const failed = check.failed_checks
    ? check.failed_checks.split(',').filter(Boolean)
    : []
  const canOpen = check.response !== ''

  let summary = t(INTELLIGENCE_VERDICT_LABEL_KEYS[verdict])
  if (verdict === 'passed') summary = t('Checks passed')
  if (verdict === 'failed' && failed.length > 0) {
    summary = failed
      .map((name) => t(DRAWING_CHECK_LABEL_KEYS[name] ?? name))
      .join('、')
  }

  return (
    <div className='bg-card ring-foreground/10 flex min-w-0 flex-col overflow-hidden rounded-2xl ring-1'>
      <button
        type='button'
        disabled={!canOpen}
        onClick={() => props.onOpen(check)}
        aria-label={t('Play the drawing from {{time}}', {
          time: checkedAt(check),
        })}
        className='focus-visible:ring-ring relative block w-full text-left outline-none focus-visible:ring-2 disabled:cursor-default'
      >
        {canOpen && (
          <DrawingFrame
            html={check.response}
            title={t('Drawing from {{time}}', { time: checkedAt(check) })}
            thumbnail
          />
        )}
        {!canOpen && (
          <div className='bg-muted/40 text-muted-foreground flex aspect-[16/10] items-center justify-center gap-2 text-sm'>
            {verdict === 'running' && (
              <Loader2 className='size-4 animate-spin' aria-hidden='true' />
            )}
            {verdict === 'running'
              ? t('Drawing...')
              : t(INTELLIGENCE_VERDICT_LABEL_KEYS[verdict])}
          </div>
        )}
      </button>
      <div className='flex flex-col gap-1 border-t px-3 py-2.5'>
        <div className='flex items-center justify-between gap-2 text-sm'>
          <span className='font-semibold tabular-nums'>{checkedAt(check)}</span>
          {check.latency_ms > 0 && (
            <span className='text-muted-foreground font-mono text-xs tabular-nums'>
              {formatLatency(check.latency_ms)}
            </span>
          )}
        </div>
        <span
          className={cn(
            'flex min-w-0 items-center gap-1 text-xs',
            VERDICT_TEXT[verdict]
          )}
        >
          {verdict === 'passed' && <Check className='size-3.5 shrink-0' />}
          {verdict === 'failed' && <X className='size-3.5 shrink-0' />}
          <span className='truncate'>{summary}</span>
        </span>
        <AdminDetails check={check} />
      </div>
    </div>
  )
}
