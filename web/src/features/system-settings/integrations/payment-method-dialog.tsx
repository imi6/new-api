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
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { Dialog } from '@/components/dialog'
import { ReactIconByName } from '@/components/react-icon-by-name'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
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

const createPaymentMethodDialogSchema = (t: (key: string) => string) =>
  z.object({
    name: z.string().min(1, t('Payment method name is required')),
    type: z.string().min(1, t('Payment type key is required')),
    icon: z.string().optional(),
    min_topup: z.string().optional(),
    gateway: z.string().optional(),
    bonus_percent: z
      .string()
      .optional()
      .refine((value) => {
        if (!value || value.trim() === '') return true
        const percent = Number(value)
        return Number.isFinite(percent) && percent >= 0 && percent <= 100
      }, t('Bonus percent must be between 0 and 100')),
  })

type PaymentMethodDialogFormValues = z.infer<
  ReturnType<typeof createPaymentMethodDialogSchema>
>

const PAYMENT_METHOD_FORM_ID = 'payment-method-form'

export type PaymentMethodData = {
  name: string
  type: string
  icon?: string
  min_topup?: string
  color?: string
  gateway?: string
  bonus_percent?: string
}

type PaymentMethodDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: PaymentMethodData) => void
  editData?: PaymentMethodData | null
  epaySites?: Array<{ id: string; name: string }>
}

const PAYMENT_TYPE_ICON_NAMES: Record<string, string> = {
  alipay: 'SiAlipay',
  stripe: 'SiStripe',
  waffo_pancake: 'LuCreditCard',
  wxpay: 'SiWechat',
}

const getDefaultIconName = (type: string) => PAYMENT_TYPE_ICON_NAMES[type] ?? ''

const usesEpaySite = (type: string) =>
  type !== 'stripe' && type !== 'waffo_pancake' && type !== 'waffo' && type !== 'creem'

export function PaymentMethodDialog({
  open,
  onOpenChange,
  onSave,
  editData,
  epaySites = [],
}: PaymentMethodDialogProps) {
  const { t } = useTranslation()
  const isEditMode = !!editData
  const paymentMethodDialogSchema = createPaymentMethodDialogSchema(t)
  const paymentTypeOptions = [
    {
      iconName: 'SiAlipay',
      label: `${t('Alipay')} (Epay: alipay)`,
      name: t('Alipay'),
      value: 'alipay',
    },
    {
      iconName: 'SiWechat',
      label: `${t('WeChat Pay')} (Epay: wxpay)`,
      name: t('WeChat Pay'),
      value: 'wxpay',
    },
    {
      iconName: 'SiStripe',
      label: `${t('Stripe')} (stripe)`,
      name: t('Stripe'),
      value: 'stripe',
    },
    {
      iconName: 'LuCreditCard',
      label: 'Waffo Pancake (waffo_pancake)',
      name: 'Waffo Pancake',
      value: 'waffo_pancake',
    },
  ]
  const getPaymentTypeOption = (value: string) =>
    paymentTypeOptions.find((option) => option.value === value)

  const form = useForm<PaymentMethodDialogFormValues>({
    resolver: zodResolver(paymentMethodDialogSchema),
    defaultValues: {
      name: '',
      type: '',
      icon: '',
      min_topup: '',
      gateway: 'epay',
      bonus_percent: '',
    },
  })

  const iconValue = form.watch('icon')
  const typeValue = form.watch('type')
  const gatewayValue = form.watch('gateway') || 'epay'
  const showEpaySite = usesEpaySite(typeValue)
  const epaySiteOptions = [
    { label: t('Original Epay site'), value: 'epay' },
    ...epaySites.map((site) => ({
      label: site.name.trim() || site.id,
      value: site.id,
    })),
  ]
  if (
    gatewayValue !== 'epay' &&
    !epaySiteOptions.some((option) => option.value === gatewayValue)
  ) {
    epaySiteOptions.push({ label: gatewayValue, value: gatewayValue })
  }

  useEffect(() => {
    if (editData) {
      form.reset({
        name: editData.name,
        type: editData.type,
        icon: editData.icon ?? getDefaultIconName(editData.type),
        min_topup: editData.min_topup ?? '',
        gateway:
          editData.gateway && editData.gateway !== 'epay'
            ? editData.gateway
            : 'epay',
        bonus_percent: editData.bonus_percent ?? '',
      })
    } else {
      form.reset({
        name: '',
        type: '',
        icon: '',
        min_topup: '',
        gateway: 'epay',
        bonus_percent: '',
      })
    }
  }, [editData, form, open])

  const handleSubmit = (values: PaymentMethodDialogFormValues) => {
    const data: PaymentMethodData = {
      name: values.name,
      type: values.type,
    }
    if (values.icon && values.icon.trim() !== '') {
      data.icon = values.icon.trim()
    }
    if (values.min_topup && values.min_topup.trim() !== '') {
      data.min_topup = values.min_topup
    }
    const bonusPercent = Number(values.bonus_percent)
    if (
      values.bonus_percent &&
      values.bonus_percent.trim() !== '' &&
      Number.isFinite(bonusPercent) &&
      bonusPercent > 0
    ) {
      data.bonus_percent = values.bonus_percent.trim()
    }
    if (
      usesEpaySite(values.type) &&
      values.gateway &&
      values.gateway !== 'epay'
    ) {
      data.gateway = values.gateway
    }
    if (editData?.color) {
      data.color = editData.color
    }
    onSave(data)
    form.reset()
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEditMode ? t('Edit payment method') : t('Add payment method')}
      description={t('Configure a payment method for user recharge options.')}
      contentClassName='sm:max-w-[500px]'
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button type='submit' form={PAYMENT_METHOD_FORM_ID}>
            {isEditMode ? t('Update') : t('Add')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          id={PAYMENT_METHOD_FORM_ID}
          onSubmit={form.handleSubmit(handleSubmit)}
          className='space-y-4'
        >
          <FormField
            control={form.control}
            name='name'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Name')}</FormLabel>
                <FormControl>
                  <Input placeholder={t('e.g., Alipay, WeChat')} {...field} />
                </FormControl>
                <FormDescription>
                  {t('Display name for this payment method.')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='type'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Payment type key')}</FormLabel>
                <FormControl>
                  <Combobox
                    options={paymentTypeOptions}
                    value={field.value}
                    onValueChange={(value) => {
                      if (value === null) return
                      const currentIcon = form.getValues('icon')?.trim()
                      const currentName = form.getValues('name')?.trim()
                      const previousOption = getPaymentTypeOption(field.value)
                      const nextOption = getPaymentTypeOption(value)

                      field.onChange(value)
                      if (
                        nextOption?.iconName &&
                        (!currentIcon ||
                          currentIcon === previousOption?.iconName)
                      ) {
                        form.setValue('icon', nextOption.iconName, {
                          shouldDirty: true,
                        })
                      }
                      if (
                        nextOption?.name &&
                        (!currentName || currentName === previousOption?.name)
                      ) {
                        form.setValue('name', nextOption.name, {
                          shouldDirty: true,
                        })
                      }
                    }}
                    placeholder={t('Select or enter payment type key')}
                    searchPlaceholder={t('Search payment type keys...')}
                    allowCustomValue
                  />
                </FormControl>
                <FormDescription className='leading-relaxed'>
                  {t(
                    'Used to decide the payment flow. Built-in keys include stripe for Stripe and waffo_pancake for Waffo Pancake; other values are sent to Epay as the type parameter.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {showEpaySite ? (
            <FormField
              control={form.control}
              name='gateway'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Epay site')}</FormLabel>
                  <FormControl>
                    <Combobox
                      options={epaySiteOptions}
                      value={field.value || 'epay'}
                      onValueChange={(value) => {
                        if (!value) return
                        field.onChange(value)
                      }}
                      placeholder={t('Original Epay site')}
                      searchPlaceholder={t('Search payment type keys...')}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Choose which Epay merchant receives this method. Add sites on the Epay tab.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : null}

          <FormField
            control={form.control}
            name='icon'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Icon')}</FormLabel>
                <FormControl>
                  <div className='flex items-center gap-2'>
                    <Input
                      placeholder={t('e.g., SiAlipay')}
                      {...field}
                      className='flex-1'
                    />
                    {iconValue && (
                      <ReactIconByName
                        name={iconValue}
                        className='text-muted-foreground size-5 shrink-0'
                        title={iconValue}
                      />
                    )}
                  </div>
                </FormControl>
                <FormDescription>
                  {t(
                    'Enter a react-icons component name. Invalid names show no icon.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='min_topup'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Minimum top-up (optional)')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    step='0.01'
                    placeholder={t('e.g., 50')}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t('Optional minimum recharge amount for this method.')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='bonus_percent'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Bonus percent')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    step='0.01'
                    min={0}
                    max={100}
                    placeholder={t('e.g. 1')}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Extra balance after a successful payment. Enter 1 to grant 1% more quota. Leave blank for no bonus.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </Dialog>
  )
}
