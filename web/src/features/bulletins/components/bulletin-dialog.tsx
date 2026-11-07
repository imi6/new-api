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
import { Megaphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { RichContent } from '@/components/rich-content'
import { Button } from '@/components/ui/button'
import { formatTimestampToDate } from '@/lib/format'

export type BulletinDialogItem = {
  title: string
  content: string
  /** Unix seconds; 0 hides the time. */
  shownAt: number
}

interface BulletinDialogProps {
  open: boolean
  item: BulletinDialogItem | null
  /** Closing by the corner button, Escape or a click outside. */
  onDismiss: () => void
  /** The footer button; it reads "I have read it" when confirming a read. */
  onConfirm: () => void
  confirmLabel: string
  /** Shown as "1 / 3" when more popups are waiting. */
  position?: { index: number; total: number }
}

/**
 * One announcement: its title, time and Markdown text, scrolled when long.
 * The text goes through the shared Markdown renderer, which sanitizes it.
 */
export function BulletinDialog(props: BulletinDialogProps) {
  const { t } = useTranslation()
  const item = props.item
  const time = item && item.shownAt > 0 ? formatTimestampToDate(item.shownAt) : ''
  const position =
    props.position && props.position.total > 1
      ? `${props.position.index} / ${props.position.total}`
      : ''

  return (
    <Dialog
      open={props.open && item !== null}
      onOpenChange={(open) => {
        if (!open) props.onDismiss()
      }}
      title={
        <span className='flex min-w-0 items-center gap-3'>
          <span className='bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-xl'>
            <Megaphone className='size-4' aria-hidden='true' />
          </span>
          <span className='min-w-0 break-words'>{item?.title}</span>
        </span>
      }
      description={
        time || position ? (
          <span className='flex flex-wrap items-center gap-x-3 gap-y-1'>
            {time && <span className='tabular-nums'>{time}</span>}
            {position && (
              <span className='tabular-nums'>
                {t('Announcement {{position}}', { position })}
              </span>
            )}
          </span>
        ) : undefined
      }
      contentClassName='sm:max-w-2xl'
      footer={
        <Button type='button' onClick={props.onConfirm}>
          {props.confirmLabel}
        </Button>
      }
    >
      {item && (
        <div className='border-primary/60 bg-muted/30 max-h-[min(60vh,32rem)] overflow-y-auto rounded-lg border-l-4 px-4 py-3 text-sm'>
          <RichContent breaks content={item.content} />
        </div>
      )}
    </Dialog>
  )
}
