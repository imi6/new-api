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
  ArrowLeft,
  Code,
  Eye,
  Feather,
  Pause,
  Play,
  RefreshCw,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import dayjs from '@/lib/dayjs'

import { useIntelligenceChecks } from '../hooks/use-group-health'
import {
  intelligencePassCount,
  stripCodeFence,
} from '../lib/intelligence-check'
import type { IntelligenceCheck } from '../types'
import { DrawingFrame } from './drawing-frame'
import { CandyCheckCard, PelicanCheckCard } from './intelligence-check-cards'

type CheckTab = 'candy' | 'pelican'

interface IntelligenceCheckDialogProps {
  group: string | null
  onOpenChange: (open: boolean) => void
}

function TabHeader(props: {
  checks: IntelligenceCheck[]
  fetching: boolean
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  const count = intelligencePassCount(props.checks)
  const running = props.checks.some((check) => check.status === 'running')
  return (
    <div className='flex flex-wrap items-center justify-between gap-2'>
      <div className='flex items-center gap-2 text-sm'>
        <span className='text-muted-foreground'>
          {t('Passed {{passed}} of the last {{total}}', count)}
        </span>
        {running && (
          <StatusBadge
            label={t('Checking now')}
            variant='info'
            copyable={false}
            showDot
            pulse
            size='sm'
          />
        )}
      </div>
      <Button
        variant='ghost'
        size='icon-sm'
        onClick={props.onRefresh}
        disabled={props.fetching}
        aria-label={t('Refresh')}
      >
        <RefreshCw
          className={props.fetching ? 'animate-spin' : undefined}
          aria-hidden='true'
        />
      </Button>
    </div>
  )
}

interface DrawingDetailProps {
  check: IntelligenceCheck
  onBack: () => void
}

/**
 * One drawing shown in place of the grid, in the same dialog: back to the
 * grid on the left, when and by which model in the middle, and the preview
 * switches on the right.
 */
function DrawingDetail(props: DrawingDetailProps) {
  const { t } = useTranslation()
  const [view, setView] = useState<'preview' | 'source'>('preview')
  const [playing, setPlaying] = useState(true)
  const check = props.check
  const time = dayjs(check.created_at * 1000).format('MM/DD HH:mm:ss')

  return (
    <div className='flex flex-col gap-3'>
      <div className='grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b pb-3'>
        <Button
          variant='ghost'
          size='sm'
          className='justify-self-start'
          onClick={props.onBack}
        >
          <ArrowLeft aria-hidden='true' />
          {t('Back to all drawings')}
        </Button>
        <span className='text-muted-foreground truncate text-center text-sm'>
          {time} · {check.model_name}
        </span>
        <div className='flex items-center gap-2 justify-self-end'>
          {view === 'preview' && (
            <Button
              variant='outline'
              size='sm'
              className='rounded-full'
              onClick={() => setPlaying(!playing)}
            >
              {playing ? (
                <Pause aria-hidden='true' />
              ) : (
                <Play aria-hidden='true' />
              )}
              {playing ? t('Stop preview') : t('Play preview')}
            </Button>
          )}
          <Button
            variant='ghost'
            size='sm'
            onClick={() => setView(view === 'preview' ? 'source' : 'preview')}
          >
            {view === 'preview' ? (
              <Code aria-hidden='true' />
            ) : (
              <Eye aria-hidden='true' />
            )}
            {view === 'preview' ? t('View source') : t('View drawing')}
          </Button>
          {view === 'source' && (
            <CopyButton
              value={stripCodeFence(check.response)}
              variant='outline'
              size='sm'
            >
              {t('Copy')}
            </CopyButton>
          )}
        </div>
      </div>

      {view === 'preview' && playing && (
        <DrawingFrame
          html={check.response}
          title={t('Drawing from {{time}}', { time })}
          className='h-[65vh] rounded-2xl border'
        />
      )}
      {view === 'preview' && !playing && (
        <div className='bg-muted/40 text-muted-foreground flex h-[65vh] flex-col items-center justify-center gap-3 rounded-2xl border text-sm'>
          <span>{t('Preview stopped')}</span>
          <Button variant='outline' size='sm' onClick={() => setPlaying(true)}>
            <Play aria-hidden='true' />
            {t('Play preview')}
          </Button>
        </div>
      )}
      {view === 'source' && (
        <pre className='bg-muted h-[65vh] overflow-auto rounded-2xl border p-3 font-mono text-xs break-all whitespace-pre-wrap'>
          {check.response}
        </pre>
      )}

      <p className='text-muted-foreground border-t pt-3 text-xs'>
        {check.truncated
          ? t('The answer was too long and is shown cut short.')
          : t(
              'The drawing is the model output as received; it runs in a sandbox without access to this site.'
            )}
      </p>
    </div>
  )
}

export function IntelligenceCheckDialog(props: IntelligenceCheckDialogProps) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<CheckTab>('candy')
  // The drawing open in place of the grid, kept by id so a refresh that
  // reloads the list keeps it open.
  const [viewingId, setViewingId] = useState<number | null>(null)
  const query = useIntelligenceChecks(props.group)
  const data = query.data
  const viewing =
    data?.pelican.find((check) => check.id === viewingId) ?? null
  const refresh = () => void query.refetch()
  // A question shows when the group is asked it or has results from before.
  const showCandy = !data || data.candy_enabled || data.candy.length > 0
  const showPelican = !data || data.pelican_enabled || data.pelican.length > 0
  let activeTab = tab
  if (activeTab === 'candy' && !showCandy) activeTab = 'pelican'
  if (activeTab === 'pelican' && !showPelican) activeTab = 'candy'

  const renderList = (checks: IntelligenceCheck[], kind: CheckTab) => {
    if (query.isLoading) {
      return (
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {['a', 'b', 'c'].map((key) => (
            <Skeleton key={key} className='h-64 rounded-2xl' />
          ))}
        </div>
      )
    }
    if (checks.length === 0) {
      return (
        <EmptyState
          icon={Feather}
          title={t('No checks yet')}
          description={t(
            'Results appear here after the first scheduled check.'
          )}
          className='min-h-[240px]'
        />
      )
    }
    return (
      <div className='flex flex-col gap-3'>
        <TabHeader
          checks={checks}
          fetching={query.isFetching}
          onRefresh={refresh}
        />
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {checks.map((check) =>
            kind === 'candy' ? (
              <CandyCheckCard key={check.id} check={check} />
            ) : (
              <PelicanCheckCard
                key={check.id}
                check={check}
                onOpen={(item) => setViewingId(item.id)}
              />
            )
          )}
        </div>
      </div>
    )
  }

  return (
    <Dialog
      open={props.group !== null}
      onOpenChange={(open) => {
        if (!open) {
          setTab('candy')
          setViewingId(null)
        }
        props.onOpenChange(open)
      }}
      title={
        <span className='flex min-w-0 items-center gap-2'>
          <Feather
            className='text-success size-5 shrink-0'
            aria-hidden='true'
          />
          <span>{t('Intelligence check')}</span>
          <span className='text-muted-foreground truncate text-base font-normal'>
            / {props.group}
          </span>
        </span>
      }
      description={data?.model}
      contentClassName='sm:max-w-6xl'
    >
      {data && !data.enabled && (
        <p className='bg-muted text-muted-foreground rounded-lg px-3 py-2 text-sm'>
          {t(
            'Intelligence checks are turned off. These are the last results.'
          )}
        </p>
      )}
      {query.isError && (
        <EmptyState
          icon={Feather}
          title={t('Unable to load intelligence checks')}
          description={t('Try again later.')}
          className='min-h-[240px]'
        />
      )}
      {!query.isError && (
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            setTab(value as CheckTab)
            setViewingId(null)
          }}
        >
          <TabsList>
            {showCandy && (
              <TabsTrigger value='candy'>{t('Candy question')}</TabsTrigger>
            )}
            {showPelican && (
              <TabsTrigger value='pelican'>
                {t('Pelican drawing')}
              </TabsTrigger>
            )}
          </TabsList>
          {showCandy && (
            <TabsContent value='candy' className='pt-3'>
              {renderList(data?.candy ?? [], 'candy')}
            </TabsContent>
          )}
          {showPelican && (
            <TabsContent value='pelican' className='pt-3'>
              {viewing ? (
                <DrawingDetail
                  key={viewing.id}
                  check={viewing}
                  onBack={() => setViewingId(null)}
                />
              ) : (
                renderList(data?.pelican ?? [], 'pelican')
              )}
            </TabsContent>
          )}
        </Tabs>
      )}
    </Dialog>
  )
}
