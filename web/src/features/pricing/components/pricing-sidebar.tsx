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
import { ChevronDown, RotateCcw } from 'lucide-react'
import { memo, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { GroupLabels } from '@/components/group-labels'
import { useGroupLabels } from '@/components/group-labels-context'
import {
  type GroupRatioChange,
  RatioChangeBadge,
} from '@/components/ratio-change-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ChannelTypeLogo } from '@/features/channels/components/channel-type-badge'
import {
  apiKeyPlatformLabel,
  OTHER_PLATFORM,
  rankGroupPlatforms,
} from '@/features/keys/lib/api-key-group-platforms'
import { cn } from '@/lib/utils'

import {
  ENDPOINT_TYPES,
  FILTER_ALL,
  QUOTA_TYPES,
  getEndpointTypeLabels,
  getQuotaTypeLabels,
} from '../constants'
import { getModelQuotaType, parseTags } from '../lib/filters'
import type { PricingModel } from '../types'

type FilterOption = {
  group?: string
  value: string
  label: string
  count?: number
  suffix?: string
  icon?: ReactNode
  /** Shown after the suffix, such as a group's recent ratio change. */
  badge?: ReactNode
}

type FilterSectionProps = {
  title: string
  value: string
  options: FilterOption[]
  onChange: (value: string) => void
}

export interface PricingSidebarProps {
  quotaTypeFilter: string
  endpointTypeFilter: string
  platformFilter: string
  groupFilter: string
  tagFilter: string
  onQuotaTypeChange: (value: string) => void
  onEndpointTypeChange: (value: string) => void
  onPlatformChange: (value: string) => void
  onGroupChange: (value: string) => void
  onTagChange: (value: string) => void
  groups: string[]
  /**
   * The platform of each group, a channel type id or OTHER_PLATFORM. Each
   * platform chip counts its groups, and a chosen platform lists only its own.
   */
  groupPlatformOf?: ReadonlyMap<string, string>
  groupRatios?: Record<string, number>
  /** Recent ratio changes, marked on each group's chip. */
  groupRatioChanges?: Record<string, GroupRatioChange>
  tags: string[]
  models: PricingModel[]
  hasActiveFilters: boolean
  onClearFilters: () => void
  /**
   * `panel` stacks collapsible sections, for a narrow column or drawer.
   * `bar` puts one labelled row of chips per filter, for the full page width.
   */
  layout?: 'panel' | 'bar'
  className?: string
}

function formatGroupRatio(ratio: number | undefined): string | undefined {
  if (ratio == null) return undefined
  const formatted = Number.isInteger(ratio)
    ? ratio.toString()
    : ratio.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  return `x${formatted}`
}

function FilterChip(props: {
  option: FilterOption
  active: boolean
  onClick: () => void
  /** Pill chips with a filled selection, for the horizontal bar. */
  pill?: boolean
}) {
  const labels = useGroupLabels(props.option.group)
  let variant: 'outline' | 'secondary' | 'default' = 'outline'
  let countClassName = 'bg-muted text-muted-foreground'
  if (props.active && props.pill) {
    variant = 'default'
    countClassName = 'bg-primary-foreground/20 text-primary-foreground'
  } else if (props.active) {
    variant = 'secondary'
    countClassName = 'bg-background text-foreground'
  }
  return (
    <Button
      type='button'
      variant={variant}
      size='sm'
      onClick={props.onClick}
      aria-pressed={props.active}
      className={cn(
        'h-auto max-w-full gap-1.5 px-2 py-1 text-xs',
        props.pill && 'rounded-full px-3'
      )}
      title={props.option.label}
    >
      {props.option.icon && (
        <span className='shrink-0'>{props.option.icon}</span>
      )}
      <GroupLabels labels={labels} />
      <span className='truncate'>{props.option.label}</span>
      {(props.option.suffix || props.option.count != null) && (
        <span
          className={cn(
            'rounded-md px-1.5 py-0.5 text-[12px]',
            props.pill && 'rounded-full',
            countClassName
          )}
        >
          {props.option.suffix ?? props.option.count}
        </span>
      )}
      {props.option.badge}
    </Button>
  )
}

function FilterSection(props: FilterSectionProps) {
  return (
    <Collapsible
      defaultOpen
      className='border-border/70 border-b pb-3 last:border-b-0'
    >
      <CollapsibleTrigger className='group flex w-full items-center justify-between py-2.5 text-left'>
        <span className='text-foreground text-sm font-semibold'>
          {props.title}
        </span>
        <ChevronDown className='text-muted-foreground size-4 transition-transform group-data-[panel-open]:rotate-180' />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className='flex flex-wrap gap-1.5'>
          {props.options.map((option) => (
            <FilterChip
              key={option.value}
              option={option}
              active={props.value === option.value}
              onClick={() => props.onChange(option.value)}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export const PricingSidebar = memo(function PricingSidebar(
  props: PricingSidebarProps
) {
  const { t } = useTranslation()
  const counts = useMemo(() => {
    const tags = new Map<string, number>()
    const endpoints = new Map<string, number>()
    const quotas = { token: 0, request: 0, task: 0 }
    for (const model of props.models) {
      for (const tag of new Set(
        parseTags(model.tags).map((tag) => tag.toLowerCase())
      )) {
        tags.set(tag, (tags.get(tag) ?? 0) + 1)
      }
      for (const endpoint of new Set(model.supported_endpoint_types ?? [])) {
        endpoints.set(endpoint, (endpoints.get(endpoint) ?? 0) + 1)
      }
      const quotaType = getModelQuotaType(model)
      if (quotaType) quotas[quotaType]++
    }
    return { tags, endpoints, quotas }
  }, [props.models])
  const quotaTypeLabels = getQuotaTypeLabels(t)
  const endpointTypeLabels = getEndpointTypeLabels(t)

  const platformOf = (group: string) =>
    props.groupPlatformOf?.get(group) ?? OTHER_PLATFORM
  const platformIcon = (platform: string) =>
    platform === OTHER_PLATFORM ? undefined : (
      <ChannelTypeLogo type={Number(platform)} size={14} />
    )

  // Each platform chip counts its groups, not its models.
  const platformOptions: FilterOption[] = [
    {
      value: FILTER_ALL,
      label: t('All platforms'),
      count: props.groups.length,
    },
    ...(props.groupPlatformOf
      ? rankGroupPlatforms(props.groups.map(platformOf), t).map(
          ([platform, count]) => ({
            value: platform,
            label: apiKeyPlatformLabel(platform, t),
            count,
            icon: platformIcon(platform),
          })
        )
      : []),
  ]

  const shownGroups =
    props.platformFilter === FILTER_ALL
      ? props.groups
      : props.groups.filter(
          (group) => platformOf(group) === props.platformFilter
        )
  const groupOptions: FilterOption[] = [
    {
      value: FILTER_ALL,
      label: t('All Groups'),
    },
    ...shownGroups.map((group) => ({
      group,
      value: group,
      label: group,
      suffix: formatGroupRatio(props.groupRatios?.[group]),
      icon: props.groupPlatformOf ? platformIcon(platformOf(group)) : undefined,
      badge: <RatioChangeBadge change={props.groupRatioChanges?.[group]} />,
    })),
  ]

  const quotaOptions: FilterOption[] = [
    {
      value: QUOTA_TYPES.ALL,
      label: quotaTypeLabels[QUOTA_TYPES.ALL],
      count: props.models.length,
    },
    {
      value: QUOTA_TYPES.TOKEN,
      label: quotaTypeLabels[QUOTA_TYPES.TOKEN],
      count: counts.quotas.token,
    },
    {
      value: QUOTA_TYPES.REQUEST,
      label: quotaTypeLabels[QUOTA_TYPES.REQUEST],
      count: counts.quotas.request,
    },
    {
      value: QUOTA_TYPES.TASK,
      label: quotaTypeLabels[QUOTA_TYPES.TASK],
      count: counts.quotas.task,
    },
  ]

  const tagOptions: FilterOption[] = [
    {
      value: FILTER_ALL,
      label: t('All Tags'),
      count: props.models.length,
    },
    ...props.tags.map((tag) => ({
      value: tag,
      label: tag,
      count: counts.tags.get(tag.toLowerCase()) ?? 0,
    })),
  ]

  const endpointOptions: FilterOption[] = [
    {
      value: ENDPOINT_TYPES.ALL,
      label: endpointTypeLabels[ENDPOINT_TYPES.ALL],
      count: props.models.length,
    },
    ...Object.entries(endpointTypeLabels)
      .filter(([value]) => value !== ENDPOINT_TYPES.ALL)
      .map(([value, label]) => ({
        value,
        label,
        count: counts.endpoints.get(value) ?? 0,
      })),
  ]

  if (props.layout === 'bar') {
    // A row whose only chip is "All" has nothing to choose, so it is left out.
    const rows = [
      {
        key: 'platform',
        title: t('Platform'),
        value: props.platformFilter,
        options: platformOptions,
        onChange: props.onPlatformChange,
      },
      {
        key: 'group',
        title: t('Group'),
        value: props.groupFilter,
        options: groupOptions,
        onChange: props.onGroupChange,
      },
      {
        key: 'tag',
        title: t('Tags'),
        value: props.tagFilter,
        options: tagOptions,
        onChange: props.onTagChange,
      },
      {
        key: 'quota',
        title: t('Pricing Type'),
        value: props.quotaTypeFilter,
        options: quotaOptions,
        onChange: props.onQuotaTypeChange,
      },
      {
        key: 'endpoint',
        title: t('Endpoint Type'),
        value: props.endpointTypeFilter,
        options: endpointOptions,
        onChange: props.onEndpointTypeChange,
      },
    ].filter((row) => row.options.length > 1)

    return (
      <section
        aria-label={t('Filter')}
        className={cn('bg-card rounded-xl border p-3 sm:p-4', props.className)}
      >
        <div className='grid grid-cols-[max-content_minmax(0,1fr)] items-start gap-x-4 gap-y-3'>
          {rows.map((row) => (
            <div
              key={row.key}
              role='group'
              aria-labelledby={`pricing-filter-${row.key}`}
              className='col-span-2 grid grid-cols-subgrid items-start'
            >
              <span
                id={`pricing-filter-${row.key}`}
                className='text-muted-foreground pt-1.5 text-sm whitespace-nowrap'
              >
                {row.title}
              </span>
              <div className='flex flex-wrap gap-2'>
                {row.options.map((option, index) => (
                  <FilterChip
                    key={option.value}
                    // The row title already names the filter, so its first
                    // chip says just "All".
                    option={
                      index === 0 ? { ...option, label: t('All') } : option
                    }
                    active={row.value === option.value}
                    onClick={() => row.onChange(option.value)}
                    pill
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        {props.hasActiveFilters && (
          <div className='mt-3 flex justify-end border-t pt-3'>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={props.onClearFilters}
              className='h-7 gap-1.5 px-2 text-xs'
            >
              <RotateCcw className='size-3.5' aria-hidden='true' />
              {t('Reset')}
            </Button>
          </div>
        )}
      </section>
    )
  }

  return (
    <aside className={cn('bg-card rounded-xl border p-3', props.className)}>
      <div className='mb-2.5 flex items-center justify-between gap-2'>
        <div>
          <h2 className='text-foreground text-sm font-bold'>{t('Filter')}</h2>
          <p className='text-muted-foreground mt-1 text-xs'>
            {t('Refine models by provider, group, type, and tags.')}
          </p>
        </div>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={props.onClearFilters}
          disabled={!props.hasActiveFilters}
          className='h-7 gap-1.5 px-2 text-xs'
        >
          <RotateCcw className='size-3.5' />
          {t('Reset')}
        </Button>
      </div>

      {props.hasActiveFilters && (
        <Badge variant='secondary' className='mb-3'>
          {t('Filters active')}
        </Badge>
      )}

      <div className='space-y-1'>
        {platformOptions.length > 1 && (
          <FilterSection
            title={t('Platform')}
            value={props.platformFilter}
            options={platformOptions}
            onChange={props.onPlatformChange}
          />
        )}
        <FilterSection
          title={t('Groups')}
          value={props.groupFilter}
          options={groupOptions}
          onChange={props.onGroupChange}
        />
        <FilterSection
          title={t('Model Tags')}
          value={props.tagFilter}
          options={tagOptions}
          onChange={props.onTagChange}
        />
        <FilterSection
          title={t('Pricing Type')}
          value={props.quotaTypeFilter}
          options={quotaOptions}
          onChange={props.onQuotaTypeChange}
        />
        <FilterSection
          title={t('Endpoint Type')}
          value={props.endpointTypeFilter}
          options={endpointOptions}
          onChange={props.onEndpointTypeChange}
        />
      </div>
    </aside>
  )
})
