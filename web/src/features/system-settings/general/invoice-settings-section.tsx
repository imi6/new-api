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
import type { Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import { FormDirtyIndicator } from '../components/form-dirty-indicator'
import { FormNavigationGuard } from '../components/form-navigation-guard'
import {
  SettingsForm,
  SettingsFormGrid,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useSettingsForm } from '../hooks/use-settings-form'
import { useUpdateOption } from '../hooks/use-update-option'
import { safeNumberFieldProps } from '../utils/numeric-field'
import {
  INVOICE_SETTING_LIMITS,
  invoiceSettingsSchema,
  type InvoiceSettingsValues,
} from './invoice-settings-schema'

interface InvoiceSettingsSectionProps {
  defaultValues: InvoiceSettingsValues
}

type NumberFieldName =
  | 'invoice_setting.tax_rate'
  | 'invoice_setting.special_tax_rate'
  | 'invoice_setting.order_days'
  | 'invoice_setting.payment_timeout_minutes'
  | 'invoice_setting.file_max_kb'

export function InvoiceSettingsSection(props: InvoiceSettingsSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const { form, handleSubmit, handleReset, isDirty, isSubmitting } =
    useSettingsForm<InvoiceSettingsValues>({
      resolver: zodResolver(invoiceSettingsSchema) as Resolver<
        InvoiceSettingsValues,
        unknown,
        InvoiceSettingsValues
      >,
      defaultValues: props.defaultValues,
      onSubmit: async (_data, changedFields) => {
        for (const [key, value] of Object.entries(changedFields)) {
          if (value === undefined || value === null) continue
          await updateOption.mutateAsync({ key, value: String(value) })
        }
      },
    })

  const saving = updateOption.isPending || isSubmitting

  const numberFields: {
    name: NumberFieldName
    label: string
    description: string
    min: number
    max: number
    step: string
  }[] = [
    {
      name: 'invoice_setting.tax_rate',
      label: t('General invoice tax rate (%)'),
      description: t(
        'Charged on top of the order amount for a general VAT invoice. 0 means no tax.'
      ),
      ...INVOICE_SETTING_LIMITS.taxRate,
      step: '0.01',
    },
    {
      name: 'invoice_setting.special_tax_rate',
      label: t('Special invoice tax rate (%)'),
      description: t(
        'Charged on top of the order amount for a special VAT invoice. 0 means no tax.'
      ),
      ...INVOICE_SETTING_LIMITS.taxRate,
      step: '0.01',
    },
    {
      name: 'invoice_setting.order_days',
      label: t('Invoiceable period (days)'),
      description: t('Orders paid within this many days can be invoiced.'),
      ...INVOICE_SETTING_LIMITS.orderDays,
      step: '1',
    },
    {
      name: 'invoice_setting.payment_timeout_minutes',
      label: t('Tax payment timeout (minutes)'),
      description: t(
        'Applications whose tax is not paid in time are cancelled and their orders released.'
      ),
      ...INVOICE_SETTING_LIMITS.paymentTimeoutMinutes,
      step: '1',
    },
    {
      name: 'invoice_setting.file_max_kb',
      label: t('Invoice file size limit (KB)'),
      description: t('Largest invoice file an administrator can upload.'),
      ...INVOICE_SETTING_LIMITS.fileMaxKB,
      step: '1',
    },
  ]

  return (
    <>
      <FormNavigationGuard when={isDirty} />
      <SettingsSection title={t('Invoice Settings')}>
        <Form {...form}>
          <SettingsForm onSubmit={handleSubmit} autoComplete='off'>
            <SettingsPageFormActions
              onSave={handleSubmit}
              onReset={handleReset}
              isSaving={saving}
              isResetDisabled={!isDirty}
            />
            <FormDirtyIndicator isDirty={isDirty} />

            <FormField
              control={form.control}
              name='invoice_setting.enabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Enable invoicing')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Shows the invoice center to users. Existing applications can still be viewed and processed when it is off.'
                      )}
                    </FormDescription>
                  </SettingsSwitchContent>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={saving}
                    />
                  </FormControl>
                </SettingsSwitchItem>
              )}
            />

            <FormField
              control={form.control}
              name='invoice_setting.normal_enabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Allow general VAT invoices')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Users can apply for a general VAT invoice as a company or an individual.'
                      )}
                    </FormDescription>
                  </SettingsSwitchContent>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={saving}
                    />
                  </FormControl>
                </SettingsSwitchItem>
              )}
            />

            <FormField
              control={form.control}
              name='invoice_setting.special_enabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Allow special VAT invoices')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Special VAT invoices require the company bank details.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </SettingsSwitchContent>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={saving}
                    />
                  </FormControl>
                </SettingsSwitchItem>
              )}
            />

            <SettingsFormGrid>
              {numberFields.map((item) => (
                <FormField
                  key={item.name}
                  control={form.control}
                  name={item.name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{item.label}</FormLabel>
                      <FormControl>
                        <Input
                          type='number'
                          min={item.min}
                          max={item.max}
                          step={item.step}
                          {...safeNumberFieldProps(field)}
                        />
                      </FormControl>
                      <FormDescription>{item.description}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}

              <FormField
                control={form.control}
                name='invoice_setting.categories'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Product categories')}</FormLabel>
                    <FormControl>
                      <Textarea rows={5} {...field} />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'One category per line, written as it appears on the invoice. Users pick one when applying.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SettingsFormGrid>
          </SettingsForm>
        </Form>
      </SettingsSection>
    </>
  )
}
