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
import { Plus, Send, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { TagInput } from '@/components/tag-input'
import { Turnstile } from '@/components/turnstile'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import {
  Form,
  FormControl,
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
import { Textarea } from '@/components/ui/textarea'
import { useTurnstile } from '@/features/auth/hooks/use-turnstile'
import { ChannelTypeLogo } from '@/features/channels/components/channel-type-badge'
import { PLATFORM_TYPE_OPTIONS } from '@/features/keys/lib/api-key-group-platforms'
import { safeNumberFieldProps } from '@/features/system-settings/utils/numeric-field'
import { handleServerError } from '@/lib/handle-server-error'
import { isHttpUrl } from '@/lib/content-format'

import { submitPartnerSite } from '../api'
import {
  PARTNER_CONTACT_LABEL_KEYS,
  PARTNER_CONTACT_TYPES,
  type PartnerContactType,
} from '../types'

// The same limits the server enforces, so most mistakes show before submit.
const LIMITS = {
  siteName: 64,
  siteUrl: 256,
  contact: 64,
  remark: 1000,
  groupName: 64,
  description: 500,
  models: 100,
  ratio: 1000,
}

const EMPTY_OFFER = {
  group_name: '',
  channel_type: 0,
  ratio: 1,
  models: [] as string[],
  description: '',
}

interface PartnerFormProps {
  maxOffers: number
  /** Whether the submitter is signed in, to refresh their list after. */
  signedIn: boolean
}

/**
 * One site and the groups it can supply. A submission cannot be changed, so
 * it is confirmed once more before it is sent.
 */
export function PartnerForm(props: PartnerFormProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const turnstile = useTurnstile()

  const schema = useMemo(
    () =>
      z.object({
        site_name: z
          .string()
          .trim()
          .min(1, t('Enter the site name'))
          .max(LIMITS.siteName, t('At most {{max}} characters', { max: LIMITS.siteName })),
        site_url: z
          .string()
          .trim()
          .max(LIMITS.siteUrl, t('At most {{max}} characters', { max: LIMITS.siteUrl }))
          .refine((value) => value === '' || isHttpUrl(value), {
            message: t('The site address must start with http:// or https://'),
          }),
        contact_type: z.enum(PARTNER_CONTACT_TYPES),
        contact: z
          .string()
          .trim()
          .min(1, t('Enter a contact'))
          .max(LIMITS.contact, t('At most {{max}} characters', { max: LIMITS.contact })),
        remark: z
          .string()
          .max(LIMITS.remark, t('At most {{max}} characters', { max: LIMITS.remark })),
        offers: z
          .array(
            z.object({
              group_name: z
                .string()
                .trim()
                .min(1, t('Enter the group name'))
                .max(LIMITS.groupName, t('At most {{max}} characters', { max: LIMITS.groupName })),
              channel_type: z.number().int().positive(t('Choose a platform')),
              ratio: z
                .number()
                .positive(t('The ratio must be greater than 0'))
                .max(LIMITS.ratio, t('At most {{max}}', { max: LIMITS.ratio })),
              models: z
                .array(z.string())
                .max(LIMITS.models, t('At most {{max}} models', { max: LIMITS.models })),
              description: z
                .string()
                .max(LIMITS.description, t('At most {{max}} characters', { max: LIMITS.description })),
            })
          )
          .min(1)
          .max(props.maxOffers),
      }),
    [t, props.maxOffers]
  )
  type Values = z.infer<typeof schema>
  // The validated values waiting for the confirmation, or null.
  const [pending, setPending] = useState<Values | null>(null)
  // A captcha token is good for one request; a new key renders a new widget.
  const [turnstileWidgetKey, setTurnstileWidgetKey] = useState(0)

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      site_name: '',
      site_url: '',
      contact_type: 'wechat',
      contact: '',
      remark: '',
      offers: [{ ...EMPTY_OFFER }],
    },
  })
  const offers = useFieldArray({ control: form.control, name: 'offers' })

  const platformOptions = useMemo(
    () =>
      PLATFORM_TYPE_OPTIONS.map((option) => ({
        value: String(option.value),
        label: t(option.label),
        icon: <ChannelTypeLogo type={option.value} size={16} />,
      })),
    [t]
  )

  const submit = useMutation({
    mutationFn: (values: Values) => {
      const token = turnstile.turnstileToken
      if (turnstile.isTurnstileEnabled) {
        turnstile.setTurnstileToken('')
        setTurnstileWidgetKey((current) => current + 1)
      }
      return submitPartnerSite(values, token)
    },
    onSuccess: () => {
      setPending(null)
      toast.success(t('Submitted. We will contact you if it is a fit.'))
      form.reset()
      if (props.signedIn) {
        void queryClient.invalidateQueries({ queryKey: ['partner', 'mine'] })
      }
    },
    onError: (error) => {
      setPending(null)
      handleServerError(error)
    },
    meta: { errorToast: false },
  })

  const turnstileReady =
    !turnstile.isTurnstileEnabled || Boolean(turnstile.turnstileToken)

  return (
    <Form {...form}>
      <form
        className='flex flex-col gap-5'
        onSubmit={form.handleSubmit((values) => {
          if (!turnstile.validateTurnstile()) return
          setPending(values)
        })}
        autoComplete='off'
      >
        <div className='bg-warning/10 text-warning flex flex-col gap-1 rounded-lg px-3 py-2 text-sm'>
          <span>{t('Do not enter any API key here.')}</span>
          <span>
            {t('A submission cannot be changed. Check it before you submit.')}
          </span>
        </div>

        <section className='flex flex-col gap-3'>
          <h3 className='text-sm font-semibold'>{t('Site information')}</h3>
          <div className='grid gap-3 sm:grid-cols-2'>
            <FormField
              control={form.control}
              name='site_name'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Site name')} *</FormLabel>
                  <FormControl>
                    <Input maxLength={LIMITS.siteName} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='site_url'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Site address')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder='https://'
                      maxLength={LIMITS.siteUrl}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='contact_type'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Contact type')} *</FormLabel>
                  <Select
                    items={PARTNER_CONTACT_TYPES.map((value) => ({
                      value,
                      label: t(PARTNER_CONTACT_LABEL_KEYS[value]),
                    }))}
                    value={field.value}
                    onValueChange={(value) => {
                      if (value) field.onChange(value as PartnerContactType)
                    }}
                  >
                    <FormControl>
                      <SelectTrigger className='w-full'>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent alignItemWithTrigger={false}>
                      <SelectGroup>
                        {PARTNER_CONTACT_TYPES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(PARTNER_CONTACT_LABEL_KEYS[value])}
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
              name='contact'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Contact')} *</FormLabel>
                  <FormControl>
                    <Input maxLength={LIMITS.contact} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name='remark'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Remark')}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={3}
                    maxLength={LIMITS.remark}
                    placeholder={t(
                      'Top-up rate, settlement and anything else worth knowing'
                    )}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        <section className='flex flex-col gap-3'>
          <div className='flex items-center justify-between gap-2'>
            <h3 className='text-sm font-semibold'>
              {t('Groups you can supply')}
            </h3>
            <span className='text-muted-foreground text-xs'>
              {t('{{count}} of at most {{max}}', {
                count: offers.fields.length,
                max: props.maxOffers,
              })}
            </span>
          </div>
          {offers.fields.map((item, index) => (
            <div
              key={item.id}
              className='flex flex-col gap-3 rounded-lg border p-3'
            >
              <div className='grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-start'>
                <FormField
                  control={form.control}
                  name={`offers.${index}.group_name`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Group name')} *</FormLabel>
                      <FormControl>
                        <Input maxLength={LIMITS.groupName} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`offers.${index}.channel_type`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Platform')} *</FormLabel>
                      <FormControl>
                        <Combobox
                          options={platformOptions}
                          value={field.value ? String(field.value) : ''}
                          showSelectedIcon
                          onValueChange={(value) =>
                            field.onChange(value ? Number(value) : 0)
                          }
                          className='w-full'
                          placeholder={t('Platform')}
                          aria-label={t('Platform')}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`offers.${index}.ratio`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Ratio')} *</FormLabel>
                      <FormControl>
                        <Input
                          type='number'
                          min={0}
                          step={0.01}
                          {...safeNumberFieldProps(field)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className='sm:mt-6'
                  aria-label={t('Remove')}
                  disabled={offers.fields.length <= 1}
                  onClick={() => offers.remove(index)}
                >
                  <Trash2 aria-hidden='true' />
                </Button>
              </div>
              <FormField
                control={form.control}
                name={`offers.${index}.models`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Main models')}</FormLabel>
                    <FormControl>
                      <TagInput
                        value={field.value}
                        onChange={field.onChange}
                        placeholder={t('Type a model name and press Enter')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name={`offers.${index}.description`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Description')}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        maxLength={LIMITS.description}
                        placeholder={t(
                          'Genuine or not, external use, injection, distillation, concurrency'
                        )}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          ))}
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='self-start'
            disabled={offers.fields.length >= props.maxOffers}
            onClick={() => offers.append({ ...EMPTY_OFFER })}
          >
            <Plus aria-hidden='true' />
            {t('Add group')}
          </Button>
        </section>

        {turnstile.isTurnstileEnabled && (
          <Turnstile
            key={turnstileWidgetKey}
            siteKey={turnstile.turnstileSiteKey}
            onVerify={turnstile.setTurnstileToken}
            onExpire={() => turnstile.setTurnstileToken('')}
          />
        )}

        <Button
          type='submit'
          className='self-start'
          disabled={submit.isPending || !turnstileReady}
        >
          <Send aria-hidden='true' />
          {t('Submit')}
        </Button>

        <ConfirmDialog
          open={pending !== null}
          onOpenChange={(open) => {
            if (!open) setPending(null)
          }}
          title={t('Submit this quote?')}
          desc={t(
            'A submission cannot be changed or deleted. To correct it, submit again.'
          )}
          handleConfirm={() => {
            if (pending) submit.mutate(pending)
          }}
          isLoading={submit.isPending}
          confirmText={t('Submit')}
        />
      </form>
    </Form>
  )
}
