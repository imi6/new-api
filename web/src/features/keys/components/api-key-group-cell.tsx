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
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BadgeCell, TruncatedCell } from '@/components/data-table'
import { GroupBadge } from '@/components/group-badge'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useMediaQuery } from '@/hooks'
import { cn } from '@/lib/utils'

import { GroupRatioBadge, type GroupRatio } from './auto-group-visuals'

type ApiKeyGroupCellProps = {
  crossGroupRetry: boolean
  group: string
  ratio?: GroupRatio
  routes?: string[]
  shouldReduceMotion: boolean
  onReorderRoutes?: (next: string[]) => Promise<void>
}

export function ApiKeyGroupCell(props: ApiKeyGroupCellProps) {
  const { t } = useTranslation()
  const isMobile = useMediaQuery('(max-width: 640px)')

  const group = props.group?.trim() || ''
  if (group !== 'auto') {
    const ratio =
      group && typeof props.ratio === 'number' ? props.ratio : undefined
    return (
      <TruncatedCell
        className={isMobile ? 'w-full' : 'max-w-50'}
        tabIndex={0}
        tooltipContent={group || t('Follow user group')}
        tooltipClassName='break-all'
      >
        <GroupBadge
          group={group}
          ratio={ratio}
          ratioLabel={group ? undefined : t('Inherited')}
          type='text'
          className='px-0'
          containerClassName={cn('gap-3', isMobile && 'w-full justify-between')}
        />
      </TruncatedCell>
    )
  }

  return (
    <AutoRoutePopover
      isMobile={isMobile}
      ratio={props.ratio}
      routes={props.routes ?? []}
      shouldReduceMotion={props.shouldReduceMotion}
      onReorderRoutes={props.onReorderRoutes}
    />
  )
}

function AutoRoutePopover(props: {
  isMobile: boolean
  ratio?: GroupRatio
  routes: string[]
  shouldReduceMotion: boolean
  onReorderRoutes?: (next: string[]) => Promise<void>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const closeTimer = useRef<number | null>(null)
  const canReorder = props.routes.length > 1 && !!props.onReorderRoutes

  const show = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    setOpen(true)
  }
  const hide = () => {
    closeTimer.current = window.setTimeout(() => setOpen(false), 160)
  }
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (!props.onReorderRoutes || target < 0 || target >= props.routes.length) {
      return
    }
    const next = [...props.routes]
    const [item] = next.splice(index, 1)
    if (!item) return
    next.splice(target, 0, item)
    setSaving(true)
    void props.onReorderRoutes(next).finally(() => setSaving(false))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <BadgeCell
            data-api-key-group-cell='auto'
            tabIndex={0}
            onMouseEnter={show}
            onMouseLeave={hide}
            className={cn(
              'ml-0 gap-3 overflow-visible text-xs',
              props.isMobile ? 'w-full justify-between' : 'max-w-50'
            )}
          />
        }
      >
        <StatusBadge
          label={t('Cross-group')}
          variant='info'
          copyable={false}
          className='px-0'
        />
        <GroupRatioBadge
          ratio={props.ratio}
          isAuto
          shouldReduceMotion={props.shouldReduceMotion}
        />
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='w-72'
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        {props.routes.length === 0 ? (
          <p className='text-xs leading-5'>
            {t('This key follows the site Auto order.')}
          </p>
        ) : (
          <ol className='flex flex-col gap-1'>
            {props.routes.map((group, index) => (
              <li key={group} className='flex items-center gap-2'>
                <span className='text-muted-foreground w-14 shrink-0 text-xs'>
                  {t('Route {{index}}', { index: index + 1 })}
                </span>
                <span className='min-w-0 flex-1 truncate text-sm'>{group}</span>
                {canReorder ? (
                  <span className='flex shrink-0'>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-sm'
                      aria-label={t('Move route up')}
                      disabled={saving || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp aria-hidden='true' />
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-sm'
                      aria-label={t('Move route down')}
                      disabled={saving || index === props.routes.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown aria-hidden='true' />
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </PopoverContent>
    </Popover>
  )
}
