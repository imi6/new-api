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
import { Crown, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getUserGroups } from '@/lib/api'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'
import { handleServerError } from '@/lib/handle-server-error'
import {
  requireServerSuccess,
  translateServerText,
} from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import { createApiKey, getTokenAutoGroups } from '../api'
import { ERROR_MESSAGES } from '../constants'
import {
  getApiKeyFormDefaultValues,
  transformFormDataToPayload,
} from '../lib'
import {
  apiKeyGroupPlatform,
  formatApiKeyGroupRatio,
} from '../lib/api-key-group-platforms'
import type { ApiKeyGroupOption } from './api-key-group-combobox'
import { useApiKeys } from './api-keys-provider'

type ApiKeyCreateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type SortOrder = 'default' | 'ratio-asc' | 'ratio-desc' | 'name'
type ChannelSlot = 'primary' | 'backup'

const ALL_PLATFORMS = 'all'

function ratioNumber(ratio: number | string): number | null {
  return typeof ratio === 'number' && Number.isFinite(ratio) ? ratio : null
}

function platformLabel(
  name: string,
  translate: (key: string) => string
): string {
  return name === 'Other' ? translate('Other') : name
}

function isExclusiveGroup(option: ApiKeyGroupOption): boolean {
  return (
    option.label.includes('专属') || (option.desc?.includes('专属') ?? false)
  )
}

export function ApiKeyCreateDialog({
  open,
  onOpenChange,
}: ApiKeyCreateDialogProps) {
  const { t } = useTranslation()
  const { triggerRefresh } = useApiKeys()
  const [name, setName] = useState('')
  const [quota, setQuota] = useState('')
  const [validDays, setValidDays] = useState('')
  const [platform, setPlatform] = useState(ALL_PLATFORMS)
  const [slot, setSlot] = useState<ChannelSlot>('primary')
  const [search, setSearch] = useState('')
  const [sortOrder, setSortOrder] = useState<SortOrder>('default')
  const [exclusiveRatio, setExclusiveRatio] = useState(false)
  const [exclusiveGroup, setExclusiveGroup] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [primary, setPrimary] = useState<string | null>(null)
  const [backup, setBackup] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { data: groupsData, isLoading: groupsLoading } = useQuery({
    queryKey: ['user-groups'],
    queryFn: async () => requireServerSuccess(await getUserGroups()),
    enabled: open,
    staleTime: 0,
  })

  const { data: autoGroupsData } = useQuery({
    queryKey: ['token-auto-groups'],
    queryFn: async () => requireServerSuccess(await getTokenAutoGroups()),
    enabled: open,
    staleTime: 0,
  })

  const groups = useMemo<ApiKeyGroupOption[]>(() => {
    const entries = Object.entries(groupsData?.data || {}) as Array<
      [string, { desc?: string; ratio: number | string }]
    >
    return entries
      .filter(([key]) => key !== 'auto')
      .map(([key, info]) => ({
        value: key,
        label: key,
        desc: info.desc ? translateServerText(t, info.desc) : '',
        ratio: info.ratio,
      }))
  }, [groupsData, t])
  const groupsByValue = useMemo(
    () => new Map(groups.map((group) => [group.value, group])),
    [groups]
  )
  const maxAutoGroups =
    Number.isInteger(autoGroupsData?.data?.max_count) &&
    Number(autoGroupsData?.data?.max_count) > 0
      ? Number(autoGroupsData?.data?.max_count)
      : 5
  const backupAllowed = maxAutoGroups >= 2

  const platforms = useMemo(() => {
    const counts = new Map<string, number>()
    for (const group of groups) {
      const name = apiKeyGroupPlatform(group.label)
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return [...counts.entries()].sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1]
      return left[0].localeCompare(right[0])
    })
  }, [groups])

  const visibleGroups = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = groups.filter((group) => {
      const groupPlatform = apiKeyGroupPlatform(group.label)
      if (platform !== ALL_PLATFORMS && groupPlatform !== platform) return false
      if (exclusiveRatio && ratioNumber(group.ratio) === null) return false
      if (
        exclusiveRatio &&
        ratioNumber(group.ratio) === 1
      ) {
        return false
      }
      if (exclusiveGroup && !isExclusiveGroup(group)) return false
      if (!query) return true
      return (
        group.label.toLowerCase().includes(query) ||
        group.desc?.toLowerCase().includes(query) ||
        platformLabel(groupPlatform, t).toLowerCase().includes(query)
      )
    })

    if (sortOrder === 'default') return filtered
    return [...filtered].sort((left, right) => {
      if (sortOrder === 'name') return left.label.localeCompare(right.label)
      const leftRatio = ratioNumber(left.ratio)
      const rightRatio = ratioNumber(right.ratio)
      if (leftRatio === null && rightRatio === null) return 0
      if (leftRatio === null) return 1
      if (rightRatio === null) return -1
      return sortOrder === 'ratio-asc'
        ? leftRatio - rightRatio
        : rightRatio - leftRatio
    })
  }, [
    exclusiveGroup,
    exclusiveRatio,
    groups,
    platform,
    search,
    sortOrder,
    t,
  ])

  useEffect(() => {
    if (open) return
    setName('')
    setQuota('')
    setValidDays('')
    setPlatform(ALL_PLATFORMS)
    setSlot('primary')
    setSearch('')
    setSortOrder('default')
    setExclusiveRatio(false)
    setExclusiveGroup(false)
    setPreview(null)
    setPrimary(null)
    setBackup(null)
  }, [open])

  const previewGroup = preview ? groupsByValue.get(preview) : undefined
  const primaryGroup = primary ? groupsByValue.get(primary) : undefined
  const backupGroup = backup ? groupsByValue.get(backup) : undefined
  const { meta: currencyMeta } = getCurrencyDisplay()
  const currencyLabel = getCurrencyLabel()
  const samePlatformCount = previewGroup
    ? groups.filter(
        (group) =>
          group.value !== previewGroup.value &&
          apiKeyGroupPlatform(group.label) ===
            apiKeyGroupPlatform(previewGroup.label)
      ).length
    : 0

  const assignPreview = () => {
    if (!previewGroup) return
    if (slot === 'primary') {
      setPrimary(previewGroup.value)
      if (backup === previewGroup.value) setBackup(null)
      return
    }
    if (!backupAllowed || previewGroup.value === primary) return
    setBackup(previewGroup.value)
  }

  const submit = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error(t('Please enter a name'))
      return
    }
    if (!primary) {
      toast.error(
        t('Choose a group and set it as the primary channel before creating.')
      )
      return
    }

    const quotaText = quota.trim()
    const quotaValue = quotaText === '' ? undefined : Number(quotaText)
    if (
      quotaValue !== undefined &&
      (!Number.isFinite(quotaValue) || quotaValue < 0)
    ) {
      toast.error(t('Quota must be zero or greater'))
      return
    }

    const daysText = validDays.trim()
    const days = daysText === '' ? undefined : Number(daysText)
    if (
      days !== undefined &&
      (!Number.isInteger(days) || days <= 0)
    ) {
      toast.error(t('Valid days must be a whole number greater than zero'))
      return
    }

    const expiredTime =
      days === undefined
        ? undefined
        : new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    const defaults = getApiKeyFormDefaultValues(false)

    setIsSubmitting(true)
    try {
      const result = await createApiKey(
        transformFormDataToPayload({
          ...defaults,
          name: trimmedName,
          remain_quota_dollars: quotaValue,
          unlimited_quota: quotaValue === undefined,
          expired_time: expiredTime,
          group: backup ? 'auto' : primary,
          auto_groups_mode: backup ? 'custom' : 'inherit',
          auto_groups: backup ? [primary, backup] : [],
          cross_group_retry: Boolean(backup),
          tokenCount: 1,
        })
      )
      if (!result.success) {
        handleServerError(result, t(ERROR_MESSAGES.CREATE_FAILED))
        return
      }
      toast.success(t('Successfully created {{count}} API Key(s)', { count: 1 }))
      onOpenChange(false)
      triggerRefresh()
    } catch (error) {
      handleServerError(error, t(ERROR_MESSAGES.UNEXPECTED))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Create API Key')}
      contentClassName='sm:max-w-6xl'
      contentHeight='auto'
      footer={
        <div className='flex w-full flex-wrap items-center justify-between gap-3'>
          <p className='text-muted-foreground text-xs'>
            {primary
              ? t('The key uses the primary channel you set.')
              : t(
                  'Choose a group and set it as the primary channel before creating.'
                )}
          </p>
          <div className='flex gap-2'>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
            >
              {t('Cancel')}
            </Button>
            <Button
              type='button'
              disabled={!primary || !name.trim() || isSubmitting}
              onClick={() => void submit()}
            >
              {t('Create key')}
            </Button>
          </div>
        </div>
      }
    >
      <div className='flex flex-col gap-4'>
        <div className='grid gap-3 md:grid-cols-3'>
          <label className='flex flex-col gap-1.5 text-sm'>
            <span className='font-medium'>{t('Name')}</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('For example: My app')}
            />
          </label>
          <label className='flex flex-col gap-1.5 text-sm'>
            <span className='font-medium'>
              {currencyMeta.kind === 'tokens'
                ? t('Quota limit')
                : t('Quota limit ({{currency}})', { currency: currencyLabel })}
            </span>
            <Input
              inputMode='decimal'
              value={quota}
              onChange={(event) => setQuota(event.target.value)}
              placeholder={t('No limit')}
            />
          </label>
          <label className='flex flex-col gap-1.5 text-sm'>
            <span className='font-medium'>{t('Valid days')}</span>
            <Input
              inputMode='numeric'
              value={validDays}
              onChange={(event) => setValidDays(event.target.value)}
              placeholder={t('Permanent')}
            />
          </label>
        </div>
        <p className='text-muted-foreground text-xs'>
          {t(
            'Leave quota and expiry empty for no limit. Create a separate key for each environment.'
          )}
        </p>

        <div className='grid min-h-[28rem] overflow-hidden rounded-xl border md:grid-cols-[11rem_minmax(0,1fr)_16rem]'>
          <div className='bg-muted/30 flex flex-col gap-1 border-b p-3 md:border-r md:border-b-0'>
            <PlatformButton
              active={platform === ALL_PLATFORMS}
              label={t('All platforms')}
              count={groups.length}
              onClick={() => setPlatform(ALL_PLATFORMS)}
            />
            {platforms.map(([name, count]) => (
              <PlatformButton
                key={name}
                active={platform === name}
                label={platformLabel(name, t)}
                count={count}
                onClick={() => setPlatform(name)}
              />
            ))}
            <label className='mt-3 flex items-center gap-2 text-xs'>
              <Checkbox
                checked={exclusiveRatio}
                onCheckedChange={(checked) =>
                  setExclusiveRatio(checked === true)
                }
              />
              <Crown className='size-3.5' aria-hidden='true' />
              {t('Exclusive ratios only')}
            </label>
            <label className='flex items-center gap-2 text-xs'>
              <Checkbox
                checked={exclusiveGroup}
                onCheckedChange={(checked) =>
                  setExclusiveGroup(checked === true)
                }
              />
              <Crown className='size-3.5' aria-hidden='true' />
              {t('Exclusive groups only')}
            </label>
            <p className='text-muted-foreground mt-auto pt-3 text-[11px] leading-5'>
              {t('Only groups available to this account are shown.')}
            </p>
          </div>

          <div className='flex min-w-0 flex-col border-b md:border-r md:border-b-0'>
            <div className='flex items-center gap-4 border-b px-4 pt-3'>
              <SlotTab
                active={slot === 'primary'}
                index='1'
                label={t('Primary channel')}
                onClick={() => setSlot('primary')}
              />
              <SlotTab
                active={slot === 'backup'}
                index='2'
                label={t('Backup channel (optional)')}
                onClick={() => setSlot('backup')}
              />
              <span className='text-muted-foreground ms-auto pb-2 text-xs'>
                {t('{{count}} groups', { count: visibleGroups.length })}
              </span>
            </div>
            <div className='flex gap-2 p-3'>
              <div className='relative min-w-0 flex-1'>
                <Search
                  className='text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2'
                  aria-hidden='true'
                />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('Search name, description, or platform')}
                  className='pl-8'
                />
              </div>
              <Select
                items={[
                  { value: 'default', label: t('Default order') },
                  { value: 'ratio-asc', label: t('Ratio, low to high') },
                  { value: 'ratio-desc', label: t('Ratio, high to low') },
                  { value: 'name', label: t('Name') },
                ]}
                value={sortOrder}
                onValueChange={(value) => {
                  if (
                    value === 'default' ||
                    value === 'ratio-asc' ||
                    value === 'ratio-desc' ||
                    value === 'name'
                  ) {
                    setSortOrder(value)
                  }
                }}
              >
                <SelectTrigger className='w-36'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    <SelectItem value='default'>{t('Default order')}</SelectItem>
                    <SelectItem value='ratio-asc'>
                      {t('Ratio, low to high')}
                    </SelectItem>
                    <SelectItem value='ratio-desc'>
                      {t('Ratio, high to low')}
                    </SelectItem>
                    <SelectItem value='name'>{t('Name')}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className='max-h-[24rem] overflow-y-auto px-3 pb-3'>
              {groupsLoading ? (
                <p className='text-muted-foreground px-2 py-6 text-sm'>
                  {t('Loading...')}
                </p>
              ) : visibleGroups.length === 0 ? (
                <p className='text-muted-foreground px-2 py-6 text-sm'>
                  {t('No group found.')}
                </p>
              ) : (
                <div className='flex flex-col gap-2'>
                  {visibleGroups.map((group) => {
                    const groupPlatform = apiKeyGroupPlatform(group.label)
                    const selected = preview === group.value
                    return (
                      <button
                        key={group.value}
                        type='button'
                        onClick={() => setPreview(group.value)}
                        className={cn(
                          'hover:bg-muted/60 flex w-full items-start gap-3 rounded-lg px-3 py-3 text-start',
                          selected &&
                            'bg-emerald-50 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:ring-emerald-800'
                        )}
                      >
                        <span className='min-w-0 flex-1'>
                          <span className='block truncate text-sm font-medium'>
                            {group.label}
                          </span>
                          <span className='text-muted-foreground block text-xs'>
                            {platformLabel(groupPlatform, t)}
                          </span>
                          {group.desc && group.desc !== group.label ? (
                            <span className='text-muted-foreground mt-1 line-clamp-2 block text-xs leading-5'>
                              {group.desc}
                            </span>
                          ) : null}
                        </span>
                        <span className='shrink-0 text-sm font-medium tabular-nums'>
                          {formatApiKeyGroupRatio(group.ratio)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          <div className='flex flex-col gap-4 p-4'>
            {previewGroup ? (
              <>
                <div>
                  <p className='text-muted-foreground text-xs'>
                    {platformLabel(apiKeyGroupPlatform(previewGroup.label), t)}
                  </p>
                  <h3 className='mt-1 text-base font-semibold'>
                    {previewGroup.label}
                  </h3>
                  {previewGroup.desc &&
                  previewGroup.desc !== previewGroup.label ? (
                    <p className='text-muted-foreground mt-2 text-xs leading-5'>
                      {previewGroup.desc}
                    </p>
                  ) : null}
                </div>
                <div>
                  <p className='text-muted-foreground text-xs'>
                    {t('Your effective ratio')}
                  </p>
                  <p className='mt-1 text-3xl font-semibold tracking-tight tabular-nums'>
                    {formatApiKeyGroupRatio(previewGroup.ratio)}
                  </p>
                </div>
                <dl className='grid grid-cols-2 gap-3 text-xs'>
                  <div>
                    <dt className='text-muted-foreground'>
                      {t('Billing method')}
                    </dt>
                    <dd className='mt-1 font-medium'>{t('Balance billing')}</dd>
                  </div>
                  <div>
                    <dt className='text-muted-foreground'>
                      {t('Backup routing')}
                    </dt>
                    <dd className='mt-1 font-medium'>
                      {samePlatformCount > 0
                        ? t('Other groups on this platform')
                        : t('None')}
                    </dd>
                  </div>
                </dl>
                <Button
                  type='button'
                  className='mt-auto'
                  disabled={
                    slot === 'backup' &&
                    (!backupAllowed || previewGroup.value === primary)
                  }
                  onClick={assignPreview}
                >
                  {slot === 'primary'
                    ? t('Set as primary channel')
                    : t('Set as backup channel')}
                </Button>
              </>
            ) : (
              <p className='text-muted-foreground text-sm'>
                {t('Select a group to see its ratio and description.')}
              </p>
            )}
          </div>
        </div>

        <div className='grid gap-3 md:grid-cols-2'>
          <ChannelSummary
            title={t('Primary channel')}
            value={
              primaryGroup?.label ?? t('Primary channel not set')
            }
            empty={!primaryGroup}
          />
          <ChannelSummary
            title={t('Backup channel (optional)')}
            value={backupGroup?.label ?? t('No backup channel')}
            empty={!backupGroup}
            onClear={
              backup
                ? () => {
                    setBackup(null)
                  }
                : undefined
            }
            clearLabel={t('Clear backup channel')}
          />
        </div>
        <p className='bg-amber-50 text-amber-900 rounded-lg px-3 py-2 text-xs leading-5 dark:bg-amber-950/40 dark:text-amber-100'>
          {t(
            'If the primary channel is unavailable, the request tries the backup channel. The charge follows the channel that serves the request and your effective ratio. Choose a standard OpenAI or Anthropic group as the primary channel.'
          )}
        </p>
      </div>
    </Dialog>
  )
}

function PlatformButton(props: {
  active: boolean
  label: string
  count: number
  onClick: () => void
}) {
  return (
    <button
      type='button'
      onClick={props.onClick}
      className={cn(
        'flex items-center justify-between rounded-lg px-2 py-1.5 text-start text-sm',
        props.active ? 'bg-background font-medium shadow-sm' : 'hover:bg-background/70'
      )}
    >
      <span className='truncate'>{props.label}</span>
      <span className='text-muted-foreground ms-2 text-xs tabular-nums'>
        {props.count}
      </span>
    </button>
  )
}

function SlotTab(props: {
  active: boolean
  index: string
  label: string
  onClick: () => void
}) {
  return (
    <button
      type='button'
      onClick={props.onClick}
      className={cn(
        'flex items-center gap-2 border-b-2 pb-2 text-sm',
        props.active
          ? 'border-primary text-foreground font-medium'
          : 'text-muted-foreground border-transparent'
      )}
    >
      <span
        className={cn(
          'flex size-5 items-center justify-center rounded-full text-[11px]',
          props.active
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground'
        )}
      >
        {props.index}
      </span>
      {props.label}
    </button>
  )
}

function ChannelSummary(props: {
  title: string
  value: string
  empty: boolean
  onClear?: () => void
  clearLabel?: string
}) {
  return (
    <div className='rounded-lg border px-3 py-2'>
      <div className='flex items-center justify-between gap-2'>
        <p className='text-muted-foreground text-xs'>{props.title}</p>
        {props.onClear && props.clearLabel ? (
          <button
            type='button'
            className='text-muted-foreground text-xs underline-offset-2 hover:underline'
            onClick={props.onClear}
          >
            {props.clearLabel}
          </button>
        ) : null}
      </div>
      <p className={cn('mt-1 truncate text-sm', props.empty && 'text-muted-foreground')}>
        {props.value}
      </p>
    </div>
  )
}
