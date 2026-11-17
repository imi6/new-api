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
import { ImagePlus, X } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ScreenshotPickerProps {
  files: File[]
  disabled: boolean
  onChange: (files: File[]) => void
  children?: ReactNode
}

// 聊天附件组件绑定 AI 会话上下文；工单使用独立文件列表，并沿用项目按钮和原生隐藏文件输入。
export function ScreenshotPicker(props: ScreenshotPickerProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const fileIds = useRef(new WeakMap<File, string>())
  const [dragging, setDragging] = useState(false)

  const add = (files: File[]) => {
    if (props.disabled || !files.length) return
    if (props.files.length + files.length > 3) {
      toast.error(t('You can attach up to 3 screenshots.'))
      return
    }
    if (
      files.some(
        (file) =>
          !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
          !/\.(png|jpe?g|webp)$/i.test(file.name)
      )
    ) {
      toast.error(t('Only PNG, JPG and WebP screenshots are supported.'))
      return
    }
    if (files.some((file) => file.size <= 0 || file.size > 3 * 1024 * 1024)) {
      toast.error(t('Each screenshot must be no larger than 3 MB.'))
      return
    }
    for (const file of files) fileIds.current.set(file, crypto.randomUUID())
    props.onChange([...props.files, ...files])
  }

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = [...event.clipboardData.items]
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (!files.length || props.disabled) return
    if (!event.clipboardData.getData('text/plain')) event.preventDefault()
    add(files)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    setDragging(false)
    add([...event.dataTransfer.files])
  }

  return (
    <div
      onPaste={onPaste}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
          if (!props.disabled) setDragging(true)
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'space-y-3 rounded-xl border border-dashed p-3 transition-colors',
        dragging && 'border-primary bg-primary/5'
      )}
    >
      {props.children}
      <div className='flex items-center gap-3'>
        <Button
          type='button'
          variant='outline'
          className='h-16 w-20 flex-col gap-1 text-xs'
          disabled={props.disabled || props.files.length >= 3}
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus className='size-5' aria-hidden='true' />
          {t('Add screenshots')}
        </Button>
        <p className='text-muted-foreground text-xs leading-relaxed'>
          {t('Paste or drag screenshots here. Up to 3 images, 3 MB each.')}
        </p>
      </div>
      <input
        ref={inputRef}
        type='file'
        accept='.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp'
        multiple
        className='sr-only'
        tabIndex={-1}
        aria-label={t('Add screenshots')}
        disabled={props.disabled}
        onChange={(event) => {
          add([...(event.currentTarget.files ?? [])])
          event.currentTarget.value = ''
        }}
      />
      {props.files.length > 0 && (
        <div className='flex flex-wrap gap-3'>
          {props.files.map((file, index) => (
            <ScreenshotPreview
              key={fileIds.current.get(file)}
              file={file}
              number={index + 1}
              disabled={props.disabled}
              onRemove={() =>
                props.onChange(
                  props.files.filter((_, fileIndex) => fileIndex !== index)
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ScreenshotPreview(props: {
  file: File
  number: number
  disabled: boolean
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(
    null
  )
  useEffect(() => {
    const url = URL.createObjectURL(props.file)
    setPreview({ file: props.file, url })
    return () => URL.revokeObjectURL(url)
  }, [props.file])
  return (
    <div className='relative size-20 rounded-lg border'>
      {preview?.file === props.file && (
        <img
          src={preview.url}
          alt={t('Screenshot {{number}}', { number: props.number })}
          className='size-full rounded-lg object-cover'
        />
      )}
      <Button
        type='button'
        variant='secondary'
        size='icon-xs'
        className='absolute -top-2 -right-2 rounded-full'
        aria-label={t('Remove screenshot {{number}}', { number: props.number })}
        disabled={props.disabled}
        onClick={props.onRemove}
      >
        <X aria-hidden='true' />
      </Button>
    </div>
  )
}
