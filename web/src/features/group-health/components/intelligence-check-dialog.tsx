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
import { Feather, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
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

function DrawingViewer(props: {
  check: IntelligenceCheck | null
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [view, setView] = useState<'preview' | 'source'>('preview')
  const check = props.check
  const time = check
    ? dayjs(check.created_at * 1000).format('MM/DD HH:mm:ss')
    : ''
  return (
    <Dialog
      open={check !== null}
      onOpenChange={(open) => {
        if (!open) setView('preview')
        props.onOpenChange(open)
      }}
      title={t('Drawing from {{time}}', { time })}
      description={check?.model_name}
      contentClassName='sm:max-w-5xl'
    >
      {check && (
        <div className='flex flex-col gap-3'>
          <div className='flex items-center justify-between gap-2'>
            <ToggleGroup
              value={[view]}
              onValueChange={(values) => {
                const next = values.find((value) => value !== view)
                if (next) setView(next as 'preview' | 'source')
              }}
              aria-label={t('View')}
              variant='outline'
              size='sm'
              spacing={2}
            >
              <ToggleGroupItem value='preview'>{t('Preview')}</ToggleGroupItem>
              <ToggleGroupItem value='source'>
                {t('Source code')}
              </ToggleGroupItem>
            </ToggleGroup>
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
          {view === 'preview' && (
            <DrawingFrame
              html={check.response}
              title={t('Drawing from {{time}}', { time })}
              className='h-[70vh] rounded-lg border'
            />
          )}
          {view === 'source' && (
            <pre className='bg-muted max-h-[70vh] overflow-auto rounded-lg border p-3 font-mono text-xs whitespace-pre-wrap break-all'>
              {check.response}
            </pre>
          )}
          {check.truncated && (
            <p className='text-muted-foreground text-xs'>
              {t('The answer was too long and is shown cut short.')}
            </p>
          )}
        </div>
      )}
    </Dialog>
  )
}

export function IntelligenceCheckDialog(props: IntelligenceCheckDialogProps) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<CheckTab>('candy')
  const [viewing, setViewing] = useState<IntelligenceCheck | null>(null)
  const query = useIntelligenceChecks(props.group)
  const data = query.data
  const refresh = () => void query.refetch()

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
          description={t('Results appear here after the first scheduled check.')}
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
                onOpen={setViewing}
              />
            )
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <Dialog
        open={props.group !== null}
        onOpenChange={(open) => {
          if (!open) setTab('candy')
          props.onOpenChange(open)
        }}
        title={
          <span className='flex min-w-0 items-center gap-2'>
            <Feather className='text-success size-5 shrink-0' aria-hidden='true' />
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
            {t('Intelligence checks are turned off. These are the last results.')}
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
            value={tab}
            onValueChange={(value) => setTab(value as CheckTab)}
          >
            <TabsList>
              <TabsTrigger value='candy'>{t('Candy question')}</TabsTrigger>
              <TabsTrigger value='pelican'>{t('Pelican drawing')}</TabsTrigger>
            </TabsList>
            <TabsContent value='candy' className='pt-3'>
              {renderList(data?.candy ?? [], 'candy')}
            </TabsContent>
            <TabsContent value='pelican' className='pt-3'>
              {renderList(data?.pelican ?? [], 'pelican')}
            </TabsContent>
          </Tabs>
        )}
      </Dialog>
      <DrawingViewer
        check={viewing}
        onOpenChange={(open) => {
          if (!open) setViewing(null)
        }}
      />
    </>
  )
}
