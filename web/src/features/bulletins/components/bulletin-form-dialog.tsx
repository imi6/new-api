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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm, useWatch, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import { DateTimePicker } from '@/components/datetime-picker'
import { Dialog } from '@/components/dialog'
import { RichContent } from '@/components/rich-content'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { createBulletin, updateBulletin } from '../api'
import { BULLETINS_QUERY_KEY } from '../hooks/use-bulletins'
import {
  BULLETIN_NOTIFY_MODES,
  BULLETIN_STATUSES,
  type BulletinInput,
  type ManagedBulletin,
} from '../types'
import { BulletinDialog, type BulletinDialogItem } from './bulletin-dialog'
import { BULLETIN_NOTIFY_LABEL_KEYS, BULLETIN_STATUS_LABEL_KEYS } from './labels'

// The same limits the server enforces.
const TITLE_LIMIT = 200
const CONTENT_LIMIT = 10000
const FORM_ID = 'bulletin-form'

const EMPTY_INPUT: BulletinInput = {
  title: '',
  content: '',
  status: 'draft',
  notify_mode: 'popup',
  starts_at: 0,
  ends_at: 0,
}

interface BulletinFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The announcement being edited, or null to create one. */
  editing: ManagedBulletin | null
}

/**
 * Creates or edits an announcement. A new one starts as a draft, so it
 * only goes out once an administrator chooses "Published".
 */
export function BulletinFormDialog(props: BulletinFormDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [preview, setPreview] = useState<BulletinDialogItem | null>(null)

  const schema = useMemo(
    () =>
      z
        .object({
          title: z
            .string()
            .trim()
            .min(1, t('Enter a title'))
            .max(TITLE_LIMIT, t('At most {{max}} characters', { max: TITLE_LIMIT })),
          content: z
            .string()
            .trim()
            .min(1, t('Enter the content'))
            .max(CONTENT_LIMIT, t('At most {{max}} characters', { max: CONTENT_LIMIT })),
          status: z.enum(BULLETIN_STATUSES),
          notify_mode: z.enum(BULLETIN_NOTIFY_MODES),
          starts_at: z.number().int().min(0),
          ends_at: z.number().int().min(0),
        })
        .refine(
          (value) =>
            value.starts_at === 0 ||
            value.ends_at === 0 ||
            value.ends_at > value.starts_at,
          {
            path: ['ends_at'],
            message: t('The end time must be after the start time'),
          }
        ),
    [t]
  )

  const form = useForm<BulletinInput>({
    resolver: zodResolver(schema) as Resolver<
      BulletinInput,
      unknown,
      BulletinInput
    >,
    defaultValues: EMPTY_INPUT,
  })
  const content = useWatch({ control: form.control, name: 'content' })

  useEffect(() => {
    if (!props.open) return
    const editing = props.editing
    form.reset(
      editing
        ? {
            title: editing.title,
            content: editing.content,
            status: editing.status,
            notify_mode: editing.notify_mode,
            starts_at: editing.starts_at,
            ends_at: editing.ends_at,
          }
        : EMPTY_INPUT
    )
  }, [props.open, props.editing, form])

  const save = useMutation({
    mutationFn: (input: BulletinInput) =>
      props.editing
        ? updateBulletin(props.editing.id, input)
        : createBulletin(input),
    onSuccess: () => {
      toast.success(t('Saved successfully'))
      void queryClient.invalidateQueries({ queryKey: BULLETINS_QUERY_KEY })
      props.onOpenChange(false)
    },
    onError: (error) => handleServerError(error),
    meta: { errorToast: false },
  })

  const openPreview = () => {
    const values = form.getValues()
    setPreview({
      title: values.title.trim() || t('Untitled'),
      content: values.content,
      shownAt: values.starts_at || Math.floor(Date.now() / 1000),
    })
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.editing ? t('Edit announcement') : t('New announcement')}
      contentClassName='sm:max-w-3xl'
      footer={
        <div className='flex w-full flex-wrap items-center justify-between gap-2'>
          <Button type='button' variant='outline' onClick={openPreview}>
            <Eye aria-hidden='true' />
            {t('Preview popup')}
          </Button>
          <div className='flex gap-2'>
            <Button
              type='button'
              variant='outline'
              onClick={() => props.onOpenChange(false)}
            >
              {t('Cancel')}
            </Button>
            <Button type='submit' form={FORM_ID} disabled={save.isPending}>
              {t('Save')}
            </Button>
          </div>
        </div>
      }
    >
      <Form {...form}>
        <form
          id={FORM_ID}
          className='flex flex-col gap-4'
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
          autoComplete='off'
        >
          <FormField
            control={form.control}
            name='title'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Title')}</FormLabel>
                <FormControl>
                  <Input maxLength={TITLE_LIMIT} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='content'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Content')}</FormLabel>
                <Tabs defaultValue='write'>
                  <TabsList>
                    <TabsTrigger value='write'>{t('Write')}</TabsTrigger>
                    <TabsTrigger value='preview'>{t('Preview')}</TabsTrigger>
                  </TabsList>
                  <TabsContent value='write' className='mt-2'>
                    <FormControl>
                      <Textarea
                        rows={12}
                        maxLength={CONTENT_LIMIT}
                        className='font-mono text-sm'
                        {...field}
                      />
                    </FormControl>
                  </TabsContent>
                  <TabsContent
                    value='preview'
                    className='bg-muted/30 mt-2 max-h-80 min-h-40 overflow-y-auto rounded-lg border px-4 py-3 text-sm'
                  >
                    <RichContent breaks content={content} />
                  </TabsContent>
                </Tabs>
                <FormDescription>
                  {t('Supports Markdown. {{count}} of at most {{max}} characters.', {
                    count: content.length,
                    max: CONTENT_LIMIT,
                  })}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className='grid gap-4 sm:grid-cols-2'>
            <FormField
              control={form.control}
              name='notify_mode'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Notification method')}</FormLabel>
                  <Select
                    items={BULLETIN_NOTIFY_MODES.map((value) => ({
                      value,
                      label: t(BULLETIN_NOTIFY_LABEL_KEYS[value]),
                    }))}
                    value={field.value}
                    onValueChange={(value) => {
                      if (value) field.onChange(value)
                    }}
                  >
                    <FormControl>
                      <SelectTrigger className='w-full'>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent alignItemWithTrigger={false}>
                      <SelectGroup>
                        {BULLETIN_NOTIFY_MODES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(BULLETIN_NOTIFY_LABEL_KEYS[value])}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='status'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Status')}</FormLabel>
                  <Select
                    items={BULLETIN_STATUSES.map((value) => ({
                      value,
                      label: t(BULLETIN_STATUS_LABEL_KEYS[value]),
                    }))}
                    value={field.value}
                    onValueChange={(value) => {
                      if (value) field.onChange(value)
                    }}
                  >
                    <FormControl>
                      <SelectTrigger className='w-full'>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent alignItemWithTrigger={false}>
                      <SelectGroup>
                        {BULLETIN_STATUSES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(BULLETIN_STATUS_LABEL_KEYS[value])}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {t('Only published announcements are shown.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className='grid gap-4 sm:grid-cols-2'>
            {(['starts_at', 'ends_at'] as const).map((name) => (
              <FormField
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {name === 'starts_at' ? t('Start time') : t('End time')}
                    </FormLabel>
                    <FormControl>
                      <DateTimePicker
                        value={
                          field.value ? new Date(field.value * 1000) : undefined
                        }
                        onChange={(date) =>
                          field.onChange(
                            date ? Math.floor(date.getTime() / 1000) : 0
                          )
                        }
                        placeholder={t('No time limit')}
                      />
                    </FormControl>
                    <FormDescription>
                      {name === 'starts_at'
                        ? t('Empty means it is shown once published.')
                        : t('Empty means it stays until archived.')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
          </div>
        </form>
      </Form>
      {/* Inside the form's dialog so it opens as a nested dialog: closing
          the preview with Escape or a click outside leaves the form open. */}
      <BulletinDialog
        open={preview !== null}
        item={preview}
        onDismiss={() => setPreview(null)}
        onConfirm={() => setPreview(null)}
        confirmLabel={t('I have read it')}
      />
    </Dialog>
  )
}
