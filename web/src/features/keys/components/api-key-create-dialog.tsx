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
import { ArrowDown, ArrowUp, ChevronDown, Search, Settings2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { MultiSelect } from '@/components/multi-select'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { getUserGroups, getUserModels } from '@/lib/api'
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
  routeGroupsToApiKeyFields,
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
type ChannelMode = 'primary' | 'smart'

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
  const [search, setSearch] = useState('')
  const [sortOrder, setSortOrder] = useState<SortOrder>('default')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [modelLimits, setModelLimits] = useState<string[]>([])
  const [allowIps, setAllowIps] = useState('')
  const [allowUserQuotaQuery, setAllowUserQuotaQuery] = useState(true)
  const [preview, setPreview] = useState<string | null>(null)
  const [channelMode, setChannelMode] = useState<ChannelMode>('primary')
  const [routes, setRoutes] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { data: modelsData } = useQuery({
    queryKey: ['user-models'],
    queryFn: async () => requireServerSuccess(await getUserModels()),
    enabled: open,
    staleTime: 0,
  })

  const { data: autoGroupsData } = useQuery({
    queryKey: ['token-auto-groups'],
    queryFn: async () => requireServerSuccess(await getTokenAutoGroups()),
    enabled: open,
    staleTime: 0,
  })

  const { data: groupsData, isLoading: groupsLoading } = useQuery({
    queryKey: ['user-groups'],
    queryFn: async () => requireServerSuccess(await getUserGroups()),
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
  const canUseAuto = Boolean(groupsData?.data && 'auto' in groupsData.data)
  const maxRoutes =
    Number.isInteger(autoGroupsData?.data?.max_count) &&
    Number(autoGroupsData?.data?.max_count) > 0
      ? Number(autoGroupsData?.data?.max_count)
      : 5
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
  }, [groups, platform, search, sortOrder, t])

  useEffect(() => {
    if (open) return
    setName('')
    setQuota('')
    setValidDays('')
    setPlatform(ALL_PLATFORMS)
    setSearch('')
    setSortOrder('default')
    setAdvancedOpen(false)
    setModelLimits([])
    setAllowIps('')
    setAllowUserQuotaQuery(true)
    setPreview(null)
    setChannelMode('primary')
    setRoutes([])
  }, [open])

  const previewGroup = preview ? groupsByValue.get(preview) : undefined
  const { meta: currencyMeta } = getCurrencyDisplay()
  const currencyLabel = getCurrencyLabel()

  const addRoute = (group: string) => {
    if (routes.includes(group)) {
      toast.error(t('This group is already in the smart routing list'))
      return
    }
    if (routes.length >= 1 && !autoGroupsData) {
      toast.error(t('Loading...'))
      return
    }
    if (routes.length >= 1 && !canUseAuto) {
      toast.error(
        t(
          'A second route needs the Auto group, which is not available to your account.'
        )
      )
      return
    }
    if (routes.length >= 1 && maxRoutes < 2) {
      toast.error(
        t(
          'This site allows only one Auto group per key, so another route cannot be added.'
        )
      )
      return
    }
    if (routes.length >= maxRoutes) {
      toast.error(t('Select at most {{max}} Auto groups', { max: maxRoutes }))
      return
    }
    setRoutes((current) => [...current, group])
  }

  const moveRoute = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= routes.length) return
    setRoutes((current) => {
      const next = [...current]
      const [item] = next.splice(index, 1)
      if (!item) return current
      next.splice(target, 0, item)
      return next
    })
  }

  const submit = async (group: string) => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error(t('Please enter a name'))
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
    const routeFields = routeGroupsToApiKeyFields(
      channelMode === 'smart' ? routes : [group]
    )
    if (!routeFields.group) {
      toast.error(t('Select at least one group for smart routing'))
      return
    }

    setIsSubmitting(true)
    try {
      const result = await createApiKey(
        transformFormDataToPayload({
          ...defaults,
          name: trimmedName,
          remain_quota_dollars: quotaValue,
          unlimited_quota: quotaValue === undefined,
          expired_time: expiredTime,
          model_limits: modelLimits,
          allow_ips: allowIps,
          allow_user_quota_query: allowUserQuotaQuery,
          tokenCount: 1,
          ...routeFields,
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

        <div className='grid h-[min(36rem,calc(100vh-14rem))] min-h-96 overflow-hidden rounded-xl border md:grid-cols-[11rem_minmax(0,1fr)_16rem]'>
          <div className='bg-muted/30 flex min-h-0 flex-col gap-1 overflow-y-auto border-b p-3 md:border-r md:border-b-0'>
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
          </div>

          <div className='flex min-h-0 min-w-0 flex-col border-b md:border-r md:border-b-0'>
            <div className='flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3'>
              <Tabs
                value={channelMode}
                onValueChange={(value) => {
                  if (value === 'primary' || value === 'smart') {
                    setChannelMode(value)
                  }
                }}
              >
                <TabsList variant='line' className='h-8'>
                  <TabsTrigger value='primary'>
                    {t('Primary channel')}
                  </TabsTrigger>
                  <TabsTrigger value='smart'>{t('Smart routing')}</TabsTrigger>
                </TabsList>
              </Tabs>
              <span className='text-muted-foreground text-xs'>
                {t('{{count}} groups', { count: visibleGroups.length })}
              </span>
            </div>
            <div className='bg-background relative z-10 flex shrink-0 gap-2 border-b px-3 py-3'>
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
            <div className='min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]'>
              {groupsLoading ? (
                <p className='text-muted-foreground px-3 py-6 text-sm'>
                  {t('Loading...')}
                </p>
              ) : visibleGroups.length === 0 ? (
                <p className='text-muted-foreground px-3 py-6 text-sm'>
                  {t('No group found.')}
                </p>
              ) : (
                <div className='flex flex-col gap-2 px-3 py-3'>
                  {visibleGroups.map((group) => {
                    const selected =
                      channelMode === 'smart'
                        ? routes.includes(group.value)
                        : preview === group.value
                    return (
                      <button
                        key={group.value}
                        type='button'
                        onClick={() =>
                          channelMode === 'smart'
                            ? addRoute(group.value)
                            : setPreview(group.value)
                        }
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

          <div className='flex min-h-0 flex-col gap-4 overflow-y-auto p-4'>
            {channelMode === 'smart' ? (
              <SmartRouteOrder
                routes={routes}
                groupsByValue={groupsByValue}
                isSubmitting={isSubmitting}
                onMove={moveRoute}
                onRemove={(group) =>
                  setRoutes((current) =>
                    current.filter((item) => item !== group)
                  )
                }
                onCreate={() => void submit('')}
              />
            ) : previewGroup ? (
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
                <dl className='text-xs'>
                  <dt className='text-muted-foreground'>
                    {t('Billing method')}
                  </dt>
                  <dd className='mt-1 font-medium'>{t('Balance billing')}</dd>
                </dl>
                <Button
                  type='button'
                  className='mt-auto'
                  disabled={isSubmitting}
                  onClick={() => void submit(previewGroup.value)}
                >
                  {t('Set as primary channel')}
                </Button>
              </>
            ) : (
              <p className='text-muted-foreground text-sm'>
                {t('Select a group to see its ratio and description.')}
              </p>
            )}
          </div>
        </div>

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger
            render={
              <button
                type='button'
                className='hover:bg-muted/40 flex w-full items-center gap-3 rounded-md py-1.5 text-left'
              />
            }
          >
            <Settings2 className='text-muted-foreground size-4 shrink-0' />
            <span className='min-w-0 flex-1'>
              <span className='block text-sm font-medium'>
                {t('Advanced Settings')}
              </span>
              <span className='text-muted-foreground block text-xs'>
                {t('Set API key access restrictions')}
              </span>
            </span>
            <ChevronDown
              className={cn(
                'text-muted-foreground size-4 shrink-0 transition-transform',
                advancedOpen && 'rotate-180'
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className='flex flex-col gap-4 pt-3'>
              <label className='flex flex-col gap-1.5 text-sm'>
                <span className='font-medium'>{t('Model Limits')}</span>
                <MultiSelect
                  options={(modelsData?.data || []).map((model) => ({
                    label: model,
                    value: model,
                  }))}
                  selected={modelLimits}
                  onChange={setModelLimits}
                  placeholder={t('Select models (empty for allow all)')}
                />
                <span className='text-muted-foreground text-xs'>
                  {t('Limit which models can be used with this key')}
                </span>
              </label>
              <label className='flex flex-col gap-1.5 text-sm'>
                <span className='font-medium'>
                  {t('IP Whitelist (supports CIDR)')}
                </span>
                <Textarea
                  value={allowIps}
                  onChange={(event) => setAllowIps(event.target.value)}
                  className='min-h-20 resize-none'
                  placeholder={t('One IP per line (empty for no restriction)')}
                  rows={3}
                />
                <span className='text-muted-foreground text-xs'>
                  {t(
                    'Do not over-trust this feature. IP may be spoofed. Please use with nginx, CDN and other gateways.'
                  )}
                </span>
              </label>
              <div className='flex items-center justify-between gap-4'>
                <div className='min-w-0'>
                  <p className='text-sm font-medium'>
                    {t('Allow querying user quota')}
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    {t(
                      "When enabled, this API key can be used to check your account's remaining and used quota."
                    )}
                  </p>
                </div>
                <Switch
                  checked={allowUserQuotaQuery}
                  onCheckedChange={(checked) =>
                    setAllowUserQuotaQuery(checked === true)
                  }
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </Dialog>
  )
}

function SmartRouteOrder(props: {
  routes: string[]
  groupsByValue: Map<string, ApiKeyGroupOption>
  isSubmitting: boolean
  onMove: (index: number, direction: -1 | 1) => void
  onRemove: (group: string) => void
  onCreate: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      <div>
        <h3 className='text-sm font-medium'>{t('Smart routing')}</h3>
        <p className='text-muted-foreground mt-1 text-xs leading-5'>
          {t(
            'Routes are tried from top to bottom. A group with no channel for the model is skipped immediately. If a group has a channel but the request fails, its retries are used up before the next group. Billing uses the group that actually serves the request.'
          )}
        </p>
      </div>
      {props.routes.length === 0 ? (
        <p className='text-muted-foreground text-sm'>
          {t('No routes yet. Choose a group to add it.')}
        </p>
      ) : (
        <ol className='flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto'>
          {props.routes.map((group, index) => {
            const option = props.groupsByValue.get(group)
            return (
              <li
                key={group}
                className='flex items-start gap-2 rounded-lg border px-2 py-2'
              >
                <div className='min-w-0 flex-1'>
                  <p className='text-muted-foreground text-xs'>
                    {t('Route {{index}}', { index: index + 1 })}
                  </p>
                  <p className='truncate text-sm font-medium'>
                    {option?.label ?? group}
                  </p>
                  {option?.desc && option.desc !== option.label ? (
                    <p className='text-muted-foreground line-clamp-2 text-xs'>
                      {option.desc}
                    </p>
                  ) : null}
                </div>
                <span className='shrink-0 text-sm font-medium tabular-nums'>
                  {option?.ratio !== undefined
                    ? formatApiKeyGroupRatio(option.ratio)
                    : ''}
                </span>
                <div className='flex shrink-0 flex-col'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-sm'
                    aria-label={t('Move route up')}
                    disabled={index === 0}
                    onClick={() => props.onMove(index, -1)}
                  >
                    <ArrowUp aria-hidden='true' />
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-sm'
                    aria-label={t('Move route down')}
                    disabled={index === props.routes.length - 1}
                    onClick={() => props.onMove(index, 1)}
                  >
                    <ArrowDown aria-hidden='true' />
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-sm'
                    aria-label={t('Remove route {{group}}', { group })}
                    onClick={() => props.onRemove(group)}
                  >
                    <X aria-hidden='true' />
                  </Button>
                </div>
              </li>
            )
          })}
        </ol>
      )}
      <Button
        type='button'
        className='mt-auto'
        disabled={props.isSubmitting || props.routes.length === 0}
        onClick={props.onCreate}
      >
        {t('Create')}
      </Button>
    </div>
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

