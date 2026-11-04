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
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { getPaymentIcon, submitPaymentForm } from '@/features/wallet/lib'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import { createInvoice } from '../api'
import {
  formatCents,
  INVOICE_BANK_ACCOUNT_MAX,
  INVOICE_BANK_NAME_MAX,
  INVOICE_EMAIL_MAX,
  INVOICE_REG_ADDRESS_MAX,
  INVOICE_REG_PHONE_MAX,
  INVOICE_TAX_NO_MAX,
  INVOICE_TITLE_MAX,
  invoiceFormSchema,
  type InvoiceFormValues,
  payMethodKey,
  previewInvoiceAmounts,
  toOrderRef,
} from '../lib/invoice'
import type {
  InvoiceConfig,
  InvoiceOrder,
  InvoiceTitleType,
  InvoiceType,
} from '../types'

interface InvoiceFormProps {
  config: InvoiceConfig
  orders: InvoiceOrder[]
  defaultEmail: string
  onSubmitted: () => void
}

type TextFieldName =
  | 'title'
  | 'tax_no'
  | 'reg_address'
  | 'reg_phone'
  | 'bank_name'
  | 'bank_account'
  | 'email'

interface SpecialField {
  name: TextFieldName
  labelKey: string
  max: number
}

// Extra fields a special VAT invoice requires.
const SPECIAL_FIELDS: SpecialField[] = [
  {
    name: 'reg_address',
    labelKey: 'Registered address',
    max: INVOICE_REG_ADDRESS_MAX,
  },
  {
    name: 'reg_phone',
    labelKey: 'Registered phone',
    max: INVOICE_REG_PHONE_MAX,
  },
  { name: 'bank_name', labelKey: 'Bank name', max: INVOICE_BANK_NAME_MAX },
  {
    name: 'bank_account',
    labelKey: 'Bank account',
    max: INVOICE_BANK_ACCOUNT_MAX,
  },
]

export function InvoiceForm(props: InvoiceFormProps) {
  const { t } = useTranslation()
  const [submitting, setSubmitting] = useState(false)
  const [payKey, setPayKey] = useState(() =>
    props.config.pay_methods.length > 0
      ? payMethodKey(props.config.pay_methods[0])
      : ''
  )

  const form = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: {
      invoice_type: 'normal',
      title_type: 'company',
      title: '',
      tax_no: '',
      reg_address: '',
      reg_phone: '',
      bank_name: '',
      bank_account: '',
      category: props.config.categories[0] ?? '',
      email: props.defaultEmail,
    },
  })

  const invoiceType = form.watch('invoice_type')
  const titleType = form.watch('title_type')
  const special = invoiceType === 'special'
  const needsTaxNo = special || titleType === 'company'

  const taxRate = special
    ? props.config.special_tax_rate
    : props.config.tax_rate
  const preview = previewInvoiceAmounts(
    props.orders.map((order) => order.amount),
    taxRate
  )
  const needsTax = preview.taxCents > 0
  const payMethod = props.config.pay_methods.find(
    (method) => payMethodKey(method) === payKey
  )
  const noPayMethod = needsTax && !payMethod
  const canSubmit = props.orders.length > 0 && !submitting && !noPayMethod

  const setInvoiceType = (next: InvoiceType) => {
    form.setValue('invoice_type', next, { shouldValidate: false })
    // A special VAT invoice is issued to a company only.
    if (next === 'special') form.setValue('title_type', 'company')
  }

  async function onSubmit(values: InvoiceFormValues) {
    if (props.orders.length === 0) {
      toast.error(t('Select at least one order'))
      return
    }
    setSubmitting(true)
    try {
      const res = await createInvoice({
        ...values,
        orders: props.orders.map(toOrderRef),
        payment_method: needsTax ? (payMethod?.type ?? '') : '',
        gateway: needsTax ? (payMethod?.gateway ?? '') : '',
      })
      if (!res.success) {
        handleServerError(
          createServerError(res, t('Failed to submit the application'))
        )
        return
      }
      const url = res.data?.url
      if (url) {
        submitPaymentForm(url, res.data?.params ?? {})
        toast.success(
          t('Application submitted. Pay the tax to send it for review.')
        )
      } else {
        toast.success(t('Application submitted for review'))
      }
      form.reset({ ...values })
      props.onSubmitted()
    } catch (error) {
      handleServerError(error, t('Failed to submit the application'))
    } finally {
      setSubmitting(false)
    }
  }

  const renderTextField = (
    name: TextFieldName,
    label: string,
    max: number,
    required: boolean
  ) => (
    <FormField
      key={name}
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>
            {label}
            {required && <span className='text-destructive'>*</span>}
          </FormLabel>
          <FormControl>
            <Input {...field} maxLength={max} autoComplete='off' />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Invoice details')}</CardTitle>
        <CardDescription>
          {t('{{count}} orders selected', { count: props.orders.length })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className='flex flex-col gap-4'
            noValidate
          >
            <FormField
              control={form.control}
              name='invoice_type'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Invoice type')}</FormLabel>
                  <ToggleGroup
                    value={[field.value]}
                    onValueChange={(values) => {
                      const next = values.find((value) => value !== field.value)
                      if (next) setInvoiceType(next as InvoiceType)
                    }}
                    aria-label={t('Invoice type')}
                    variant='outline'
                    size='sm'
                    spacing={2}
                    className='grid w-full grid-cols-2 gap-2'
                  >
                    <ToggleGroupItem value='normal' className='w-full'>
                      {t('General VAT invoice')}
                    </ToggleGroupItem>
                    {props.config.special_enabled && (
                      <ToggleGroupItem value='special' className='w-full'>
                        {t('Special VAT invoice')}
                      </ToggleGroupItem>
                    )}
                  </ToggleGroup>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='title_type'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Title type')}</FormLabel>
                  <ToggleGroup
                    value={[field.value]}
                    onValueChange={(values) => {
                      const next = values.find((value) => value !== field.value)
                      if (next) field.onChange(next as InvoiceTitleType)
                    }}
                    aria-label={t('Title type')}
                    variant='outline'
                    size='sm'
                    spacing={2}
                    className='grid w-full grid-cols-2 gap-2'
                  >
                    <ToggleGroupItem value='company' className='w-full'>
                      {t('Company')}
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value='personal'
                      className='w-full'
                      disabled={special}
                    >
                      {t('Individual')}
                    </ToggleGroupItem>
                  </ToggleGroup>
                </FormItem>
              )}
            />

            {renderTextField(
              'title',
              t('Invoice title'),
              INVOICE_TITLE_MAX,
              true
            )}
            {needsTaxNo &&
              renderTextField(
                'tax_no',
                t('Taxpayer identification number'),
                INVOICE_TAX_NO_MAX,
                true
              )}
            {special &&
              SPECIAL_FIELDS.map((item) =>
                renderTextField(item.name, t(item.labelKey), item.max, true)
              )}

            <FormField
              control={form.control}
              name='category'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('Product category')}
                    <span className='text-destructive'>*</span>
                  </FormLabel>
                  <Select
                    items={props.config.categories.map((category) => ({
                      value: category,
                      label: category,
                    }))}
                    value={field.value}
                    onValueChange={(value) =>
                      value !== null && field.onChange(value)
                    }
                  >
                    <FormControl>
                      <SelectTrigger
                        className='w-full'
                        aria-label={t('Product category')}
                      >
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent alignItemWithTrigger={false}>
                      <SelectGroup>
                        {props.config.categories.map((category) => (
                          <SelectItem key={category} value={category}>
                            {category}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {renderTextField(
              'email',
              t('Email for the invoice'),
              INVOICE_EMAIL_MAX,
              true
            )}

            <Separator />

            <dl className='flex flex-col gap-1.5 text-sm'>
              <div className='flex justify-between'>
                <dt className='text-muted-foreground'>{t('Order amount')}</dt>
                <dd className='tabular-nums'>
                  ¥{formatCents(preview.orderCents)}
                </dd>
              </div>
              <div className='flex justify-between'>
                <dt className='text-muted-foreground'>
                  {t('Tax ({{rate}}%)', { rate: taxRate })}
                </dt>
                <dd className='tabular-nums'>
                  ¥{formatCents(preview.taxCents)}
                </dd>
              </div>
              <div className='flex justify-between font-semibold'>
                <dt>{t('Invoice amount')}</dt>
                <dd className='tabular-nums'>
                  ¥{formatCents(preview.invoiceCents)}
                </dd>
              </div>
            </dl>

            {needsTax && (
              <div className='flex flex-col gap-2'>
                <span className='text-sm font-medium'>
                  {t('Pay the tax with')}
                </span>
                {props.config.pay_methods.length === 0 && (
                  <p className='text-destructive text-xs'>
                    {t(
                      'No payment method is available for the tax. Contact the administrator.'
                    )}
                  </p>
                )}
                {props.config.pay_methods.length > 0 && (
                  <ToggleGroup
                    value={[payKey]}
                    onValueChange={(values) => {
                      const next = values.find((value) => value !== payKey)
                      if (next) setPayKey(next)
                    }}
                    aria-label={t('Pay the tax with')}
                    variant='outline'
                    size='sm'
                    spacing={2}
                    className='grid w-full grid-cols-2 gap-2'
                  >
                    {props.config.pay_methods.map((method) => (
                      <ToggleGroupItem
                        key={payMethodKey(method)}
                        value={payMethodKey(method)}
                        className='w-full'
                      >
                        {getPaymentIcon(
                          method.type,
                          'h-4 w-4',
                          undefined,
                          method.name
                        )}
                        <span className='truncate'>{method.name}</span>
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                )}
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'The application goes to review after the tax is paid. Unpaid applications are cancelled after {{minutes}} minutes.',
                    { minutes: props.config.payment_timeout }
                  )}
                </p>
              </div>
            )}

            <Button type='submit' disabled={!canSubmit}>
              {submitting && <Loader2 className='animate-spin' />}
              {needsTax ? t('Submit and pay tax') : t('Submit application')}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
