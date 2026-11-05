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
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { safeDrawingDocument } from '../lib/intelligence-check'

// The page renders at this size and is scaled down to fit a thumbnail.
const PAGE_WIDTH = 1280
const PAGE_HEIGHT = 800

interface DrawingFrameProps {
  html: string
  title: string
  /** Scale a full page into the box instead of filling it. */
  thumbnail?: boolean
  className?: string
}

/**
 * Plays a page a model wrote. The frame allows scripts but not same origin,
 * so the page reaches no cookie, storage or content of this site. A thumbnail
 * starts only when it scrolls into view.
 */
export function DrawingFrame(props: DrawingFrameProps) {
  const { t } = useTranslation()
  const boxRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(!props.thumbnail)
  const [scale, setScale] = useState(1)
  const srcDoc = useMemo(() => safeDrawingDocument(props.html), [props.html])

  useEffect(() => {
    const box = boxRef.current
    if (!box || !props.thumbnail) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true)
      },
      { rootMargin: '200px' }
    )
    observer.observe(box)
    const resize = new ResizeObserver(() => {
      setScale(box.clientWidth / PAGE_WIDTH)
    })
    resize.observe(box)
    return () => {
      observer.disconnect()
      resize.disconnect()
    }
  }, [props.thumbnail])

  return (
    <div
      ref={boxRef}
      className={cn('bg-muted/40 relative overflow-hidden', props.className)}
      style={
        props.thumbnail
          ? { aspectRatio: `${PAGE_WIDTH} / ${PAGE_HEIGHT}` }
          : undefined
      }
    >
      {visible && (
        <iframe
          title={props.title}
          srcDoc={srcDoc}
          sandbox='allow-scripts'
          referrerPolicy='no-referrer'
          loading='lazy'
          tabIndex={props.thumbnail ? -1 : undefined}
          aria-hidden={props.thumbnail ? true : undefined}
          className={cn(
            'border-0 bg-white',
            props.thumbnail
              ? 'pointer-events-none absolute top-0 left-0 origin-top-left'
              : 'h-full w-full'
          )}
          style={
            props.thumbnail
              ? {
                  width: PAGE_WIDTH,
                  height: PAGE_HEIGHT,
                  transform: `scale(${scale})`,
                }
              : undefined
          }
        />
      )}
      {!visible && (
        <span className='text-muted-foreground absolute inset-0 flex items-center justify-center text-xs'>
          {t('Loading...')}
        </span>
      )}
    </div>
  )
}
