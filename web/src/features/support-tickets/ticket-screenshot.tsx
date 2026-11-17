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
import { useQuery } from '@tanstack/react-query'
import { ImageOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'

import { getTicketScreenshot } from './api'
import type { TicketAttachment } from './types'

interface TicketScreenshotProps {
  userId: number
  admin: boolean
  ticketId: number
  attachment: TicketAttachment
  number: number
}

export function TicketScreenshot(props: TicketScreenshotProps) {
  const { t } = useTranslation()
  const holder = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!holder.current) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(holder.current)
    return () => observer.disconnect()
  }, [])
  const query = useQuery({
    queryKey: [
      'support-ticket-screenshot',
      props.userId,
      props.admin,
      props.ticketId,
      props.attachment.id,
    ],
    queryFn: ({ signal }) =>
      getTicketScreenshot(
        props.admin,
        props.ticketId,
        props.attachment.id,
        signal
      ),
    enabled: visible,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    meta: { errorToast: false, errorRedirect: false },
  })
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(
    null
  )
  useEffect(() => {
    if (!query.data) return
    const url = URL.createObjectURL(query.data)
    setPreview({ blob: query.data, url })
    return () => URL.revokeObjectURL(url)
  }, [query.data])
  if (query.isError) {
    return (
      <div ref={holder}>
        <Button
          type='button'
          variant='outline'
          className='size-20 flex-col gap-1 text-xs'
          aria-label={t('Failed to load screenshot')}
          title={t('Retry')}
          onClick={() => void query.refetch()}
        >
          <ImageOff className='size-5' aria-hidden='true' />
          {t('Retry')}
        </Button>
      </div>
    )
  }
  if (!preview || preview.blob !== query.data) {
    return (
      <div ref={holder}>
        <LoadingState
          inline
          className='flex size-20 items-center justify-center rounded-lg border'
        />
      </div>
    )
  }
  const label = t('Screenshot {{number}}', { number: props.number })
  return (
    <div ref={holder}>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={label}
        contentClassName='sm:max-w-4xl'
        trigger={
          <Button
            type='button'
            variant='outline'
            className='size-20 overflow-hidden rounded-lg p-0'
            aria-label={label}
          >
            <img
              src={preview.url}
              alt={label}
              width={props.attachment.width}
              height={props.attachment.height}
              className='size-full object-cover'
            />
          </Button>
        }
      >
        <img
          src={preview.url}
          alt={label}
          className='mx-auto max-h-[70dvh] max-w-full object-contain'
        />
      </Dialog>
    </div>
  )
}
