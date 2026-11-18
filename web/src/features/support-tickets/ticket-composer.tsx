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
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  CircleHelp,
  CreditCard,
  RotateCcw,
  Send,
  UserRound,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { getUserProfile } from '@/features/profile/api'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, quotaUnitsToDollars } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { ticketCategoryLabel } from './labels'
import { ScreenshotPicker } from './screenshot-picker'
import { TICKET_CATEGORIES, type TicketSubmission } from './types'

const CATEGORY_ICONS = {
  api_error: AlertTriangle,
  topup: CreditCard,
  refund: RotateCcw,
  account: UserRound,
  other: CircleHelp,
}

interface TicketComposerProps {
  creating?: boolean
  disabled?: boolean
  submit: (payload: TicketSubmission) => Promise<unknown>
  onSuccess: () => void | Promise<void>
  onCancel?: () => void
  onBusyChange?: (busy: boolean) => void
}

export function TicketComposer(props: TicketComposerProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [images, setImages] = useState<File[]>([])
  const userId = useAuthStore((state) => state.auth.user?.id)
  // 换算函数读取共享货币配置，订阅变化后及时重算退款资格。
  useSystemConfigStore((state) => state.config.currency)
  const submitting = useRef(false)
  const submission = useRef<TicketSubmission | null>(null)
  const submissionOwner = useRef<number | undefined>(undefined)
  const schema = z.object({
    category: z.enum(TICKET_CATEGORIES),
    content: z
      .string()
      .trim()
      .min(1, t('Enter a problem description.'))
      .refine(
        (value) => [...value].length <= 5000,
        t('The description must not exceed 5000 characters.')
      ),
  })
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { category: 'other', content: '' },
  })
  const content = form.watch('content')
  const category = form.watch('category')
  const refund = props.creating === true && category === 'refund'
  const balance = useQuery({
    queryKey: ['support-refund-balance', userId],
    queryFn: async () => {
      const response = requireServerSuccess(await getUserProfile())
      const quota = response.data?.quota
      if (
        response.data?.id !== userId ||
        typeof quota !== 'number' ||
        !Number.isFinite(quota)
      ) {
        throw new Error('Failed to load wallet balance. Please try again.')
      }
      return quota
    },
    enabled: refund && userId !== undefined,
    staleTime: 0,
    refetchOnMount: 'always',
    meta: { errorToast: false },
  })
  const walletBalance = quotaUnitsToDollars(balance.data ?? Number.NaN)
  const refundEligible =
    balance.isSuccess &&
    !balance.isFetching &&
    Number.isFinite(walletBalance) &&
    walletBalance > 500
  // 已发送请求的原样重试交由后端幂等检查，余额变化不能阻止找回成功结果。
  const sameSubmission =
    submissionOwner.current === userId &&
    submission.current !== null &&
    submission.current.category === category &&
    submission.current.content === content.trim() &&
    submission.current.images.length === images.length &&
    submission.current.images.every((image, index) => image === images[index])
  const refundBlocked = refund && !refundEligible && !sameSubmission
  const count = [...content].length
  const mutation = useMutation({
    mutationFn: props.submit,
    onMutate: () => props.onBusyChange?.(true),
    onSuccess: async () => {
      await props.onSuccess()
      submission.current = null
      submissionOwner.current = undefined
      form.reset()
      setImages([])
    },
    onSettled: () => {
      submitting.current = false
      props.onBusyChange?.(false)
    },
  })
  const disabled = mutation.isPending || props.disabled === true

  return (
    <Form {...form}>
      <form
        className='space-y-4'
        onSubmit={form.handleSubmit((values) => {
          if (disabled || submitting.current || refundBlocked) return
          // 响应丢失后的原样重试沿用同一请求号；实际内容或附件变化后才开始新提交。
          let payload = submission.current
          if (
            !payload ||
            submissionOwner.current !== userId ||
            payload.content !== values.content ||
            payload.category !== values.category ||
            payload.images.length !== images.length ||
            payload.images.some((image, index) => image !== images[index])
          ) {
            payload = {
              ...values,
              images: [...images],
              requestId: crypto.randomUUID(),
            }
          }
          submission.current = payload
          submissionOwner.current = userId
          submitting.current = true
          mutation.mutate(payload)
        })}
      >
        {props.creating && (
          <FormField
            control={form.control}
            name='category'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('What went wrong?')}</FormLabel>
                <FormControl>
                  <div
                    className='grid grid-cols-2 gap-2 sm:grid-cols-5'
                    role='group'
                    aria-label={t('What went wrong?')}
                  >
                    {TICKET_CATEGORIES.map((category) => {
                      const Icon = CATEGORY_ICONS[category]
                      return (
                        <Button
                          key={category}
                          type='button'
                          variant='outline'
                          aria-pressed={field.value === category}
                          onClick={() => field.onChange(category)}
                          disabled={disabled}
                          className={cn(
                            'h-16 min-w-0 flex-col gap-1.5 px-2 text-xs',
                            field.value === category &&
                              'border-primary bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
                          )}
                        >
                          <Icon className='size-4' aria-hidden='true' />
                          <span
                            className='w-full truncate'
                            title={ticketCategoryLabel(category, t)}
                          >
                            {ticketCategoryLabel(category, t)}
                          </span>
                        </Button>
                      )
                    })}
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        {refund && (
          <Alert variant={refundBlocked ? 'destructive' : 'default'}>
            <AlertDescription className='space-y-2'>
              <div>
                {t(
                  'Your wallet balance must be greater than {{amount}} to submit a refund ticket.',
                  { amount: formatNumber(500, locale) }
                )}
              </div>
              {balance.isFetching && (
                <div role='status'>{t('Checking wallet balance...')}</div>
              )}
              {balance.isError && !balance.isFetching && (
                <div className='flex flex-wrap items-center gap-2'>
                  <span>
                    {t('Failed to load wallet balance. Please try again.')}
                  </span>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={disabled}
                    onClick={() => void balance.refetch()}
                  >
                    {t('Retry')}
                  </Button>
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}
        <ScreenshotPicker
          files={images}
          onChange={setImages}
          disabled={disabled}
        >
          <FormField
            control={form.control}
            name='content'
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {props.creating
                    ? t('Problem description')
                    : t('Write a reply')}
                </FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    rows={props.creating ? 4 : 3}
                    disabled={disabled}
                    placeholder={t(
                      'Describe the problem you encountered or your suggestion.'
                    )}
                    className='min-h-24 resize-y'
                  />
                </FormControl>
                <div
                  className={cn(
                    'text-muted-foreground text-end text-xs tabular-nums',
                    count > 5000 && 'text-destructive'
                  )}
                  aria-live='polite'
                >
                  {formatNumber(count, locale)}/{formatNumber(5000, locale)}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </ScreenshotPicker>
        <div className='bg-muted/60 text-muted-foreground space-y-1 rounded-lg px-3 py-2 text-xs leading-relaxed'>
          <p>{t('Do not include a complete API Key or password.')}</p>
          {props.creating && (
            <p>
              {t(
                'We reply within 24 hours on business days. For weekends and public holidays, the clock starts on the next business day.'
              )}
            </p>
          )}
        </div>
        <div className='flex justify-end gap-2'>
          {props.onCancel && (
            <Button
              type='button'
              variant='outline'
              onClick={props.onCancel}
              disabled={mutation.isPending}
            >
              {t('Cancel')}
            </Button>
          )}
          <Button
            type='submit'
            disabled={
              disabled || refundBlocked || count > 5000 || !content.trim()
            }
          >
            <Send className='size-4' aria-hidden='true' />
            {props.creating ? t('Submit') : t('Send reply')}
          </Button>
        </div>
      </form>
    </Form>
  )
}
