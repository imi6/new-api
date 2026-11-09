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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useFieldArray, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
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
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { AffiliateCashConfig } from '@/features/affiliate-cash/types'
import {
  getAffiliateCashSettings,
  updateAffiliateCashSettings,
} from '@/features/affiliate-rewards/cash-api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { FormNavigationGuard } from '../components/form-navigation-guard'
import {
  SettingsForm,
  SettingsFormGrid,
} from '../components/settings-form-layout'
import {
  affiliateCashSettingsSchema,
  type AffiliateCashSettingsValues,
} from './affiliate-cash-schema'

export function AffiliateCashSettings() {
  const { t } = useTranslation()
  const role = useAuthStore((state) => state.auth.user?.role ?? 0)
  const query = useQuery({
    queryKey: ['affiliate-cash-settings'],
    queryFn: getAffiliateCashSettings,
    enabled: role >= ROLE.ADMIN,
    refetchOnWindowFocus: false,
  })
  if (role < ROLE.ADMIN) return null
  return (
    <section
      className='mt-6 flex flex-col gap-4 border-t pt-6'
      aria-label={t('Referral U settings')}
    >
      <div>
        <h3 className='font-semibold'>{t('Referral U settings')}</h3>
        <p className='text-muted-foreground mt-1 text-sm'>
          {t(
            'Configure referral conversion and manual USDT payouts separately from platform credit.'
          )}
        </p>
      </div>
      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {query.data && (
        <AffiliateCashSettingsForm
          initial={query.data}
          canEdit={role >= ROLE.SUPER_ADMIN}
        />
      )}
    </section>
  )
}

function AffiliateCashSettingsForm(props: {
  initial: AffiliateCashConfig
  canEdit: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<AffiliateCashSettingsValues>({
    resolver: zodResolver(affiliateCashSettingsSchema),
    defaultValues: props.initial,
  })
  const networks = useFieldArray({
    control: form.control,
    name: 'networks',
    keyName: 'formId',
  })
  const mutation = useMutation({
    mutationFn: updateAffiliateCashSettings,
    onSuccess: (saved) => {
      form.reset(saved)
      queryClient.setQueryData(['affiliate-cash-settings'], saved)
      void queryClient.invalidateQueries({ queryKey: ['affiliate-cash'] })
      toast.success(t('Saved successfully'))
    },
  })
  const disabled = !props.canEdit || mutation.isPending
  const feeMode = form.watch('fee_mode')
  const policies = [
    {
      name: 'fee_mode' as const,
      label: t('Withdrawal fee mode'),
      options: [
        { value: 'fixed', label: t('Fixed fee') },
        { value: 'percent', label: t('Percentage fee') },
        { value: 'both', label: t('Fixed fee plus percentage') },
      ],
    },
    {
      name: 'minimum_basis' as const,
      label: t('Minimum withdrawal basis'),
      options: [
        { value: 'requested', label: t('Requested amount') },
        { value: 'net', label: t('Net payout amount') },
      ],
    },
    {
      name: 'cancel_fee_policy' as const,
      label: t('Fee policy for user cancellation'),
      options: [
        { value: 'refund', label: t('Refund the full reserved amount') },
        { value: 'retain', label: t('Retain the quoted fee') },
      ],
    },
    {
      name: 'failed_fee_policy' as const,
      label: t('Fee policy after confirmed payment failure'),
      options: [
        { value: 'refund', label: t('Refund the full reserved amount') },
        { value: 'retain', label: t('Retain the quoted fee') },
      ],
    },
  ]
  const amounts = [
    {
      name: 'exchange_rate' as const,
      label: t('USDT per platform rebate unit'),
      disabled: false,
    },
    {
      name: 'minimum_withdrawal' as const,
      label: t('Minimum withdrawal (USDT)'),
      disabled: false,
    },
    {
      name: 'fee_fixed' as const,
      label: t('Fixed withdrawal fee (USDT)'),
      disabled: feeMode === 'percent',
    },
    {
      name: 'fee_percent' as const,
      label: t('Withdrawal fee (%)'),
      disabled: feeMode === 'fixed',
    },
  ]
  return (
    <>
      <FormNavigationGuard when={form.formState.isDirty} />
      <Alert>
        <AlertDescription>
          {t(
            'Existing withdrawal amounts and fees stay locked. Disabling withdrawals also pauses new U conversions; existing orders remain manageable.'
          )}
        </AlertDescription>
      </Alert>
      {!props.canEdit && (
        <p className='text-muted-foreground text-sm'>
          {t('Only the super administrator can change payout settings.')}
        </p>
      )}
      <Form {...form}>
        <SettingsForm
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <fieldset disabled={disabled} className='space-y-4'>
            <SettingsFormGrid>
              {[
                {
                  name: 'exchange_enabled' as const,
                  label: t('Enable referral conversion to U'),
                },
                {
                  name: 'withdrawal_enabled' as const,
                  label: t('Enable U withdrawal applications'),
                },
              ].map((item) => (
                <FormField
                  key={item.name}
                  control={form.control}
                  name={item.name}
                  render={({ field }) => (
                    <FormItem className='flex items-center justify-between rounded-lg border p-3'>
                      <FormLabel>{item.label}</FormLabel>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={disabled}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
              {amounts.map((item) => (
                <FormField
                  key={item.name}
                  control={form.control}
                  name={item.name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{item.label}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          inputMode='decimal'
                          autoComplete='off'
                          disabled={disabled || item.disabled}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
              {policies.map((item) => (
                <FormField
                  key={item.name}
                  control={form.control}
                  name={item.name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{item.label}</FormLabel>
                      <Select
                        items={item.options}
                        value={field.value || null}
                        onValueChange={field.onChange}
                        disabled={disabled}
                      >
                        <FormControl>
                          <SelectTrigger className='w-full'>
                            <SelectValue placeholder={t('Select a policy')} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {item.options.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </SettingsFormGrid>
            <p className='text-muted-foreground text-sm'>
              {t(
                'Administrative rejection always returns the full reserved amount. Fees are deducted from the requested amount, never charged on top.'
              )}
            </p>
            <div className='space-y-3'>
              <h4 className='text-sm font-medium'>{t('Payout networks')}</h4>
              <p className='text-muted-foreground text-sm'>
                {t(
                  'A network used by withdrawals cannot be renamed or reassigned. Create a new network ID instead'
                )}
              </p>
              <p className='text-muted-foreground text-sm'>
                {t(
                  'Disabling every payout network pauses new U conversions and withdrawals. Existing orders remain manageable.'
                )}
              </p>
              {networks.fields.map((network, index) => (
                <div
                  key={network.formId}
                  className='grid grid-cols-2 items-start gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto_auto]'
                >
                  <FormField
                    control={form.control}
                    name={`networks.${index}.id`}
                    render={({ field }) => (
                      <FormItem className='col-span-2 min-w-0 sm:col-span-1'>
                        <FormLabel>{t('Network identifier')}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            disabled={
                              disabled ||
                              props.initial.networks.some(
                                (item) => item.id === network.id
                              )
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`networks.${index}.name`}
                    render={({ field }) => (
                      <FormItem className='col-span-2 min-w-0 sm:col-span-1'>
                        <FormLabel>{t('Network name')}</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`networks.${index}.enabled`}
                    render={({ field }) => (
                      <FormItem className='flex h-9 items-center gap-3 sm:mt-6'>
                        <FormLabel>{t('Enabled')}</FormLabel>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            disabled={disabled}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  {!props.initial.networks.some(
                    (item) => item.id === network.id
                  ) && (
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='justify-self-end sm:mt-6'
                      disabled={disabled}
                      onClick={() => networks.remove(index)}
                    >
                      {t('Remove')}
                    </Button>
                  )}
                </div>
              ))}
              {form.formState.errors.networks?.message && (
                <p role='alert' className='text-destructive text-sm'>
                  {form.formState.errors.networks.message}
                </p>
              )}
              <Button
                type='button'
                variant='outline'
                size='sm'
                disabled={disabled || networks.fields.length >= 20}
                onClick={() =>
                  networks.append({
                    id: '',
                    name: '',
                    enabled: false,
                  })
                }
              >
                <Plus aria-hidden='true' />
                {t('Add payout network')}
              </Button>
            </div>
          </fieldset>
          <div className='flex justify-end gap-2'>
            <Button
              type='button'
              variant='outline'
              disabled={disabled || !form.formState.isDirty}
              onClick={() => form.reset(props.initial)}
            >
              {t('Reset')}
            </Button>
            <Button
              type='submit'
              disabled={disabled || !form.formState.isDirty}
            >
              {mutation.isPending ? t('Saving...') : t('Save U settings')}
            </Button>
          </div>
        </SettingsForm>
      </Form>
    </>
  )
}
