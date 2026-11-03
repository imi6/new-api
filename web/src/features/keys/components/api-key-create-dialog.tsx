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
import { useEffect, useId, useMemo, useState } from 'react'
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
import { quotaUnitsToEditableAmount } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import {
  requireServerSuccess,
  translateServerText,
} from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import { createApiKey, getApiKey, getTokenAutoGroups, updateApiKey } from '../api'
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../constants'
import {
  getApiKeyFormDefaultValues,
  routeGroupsToApiKeyFields,
  transformApiKeyToFormDefaults,
  transformFormDataToPayload,
} from '../lib'
import type { ApiKey } from '../types'
import {
  apiKeyGroupPlatform,
  formatApiKeyGroupRatio,
} from '../lib/api-key-group-platforms'
import type { ApiKeyGroupOption } from './api-key-group-combobox'
import { useApiKeys } from './api-keys-provider'

type ApiKeyCreateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRow?: ApiKey
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

/** Brand icon for each platform, rendered as a small inline SVG or emoji. */
function PlatformIcon({ name }: { name: string }) {
  const cls = 'size-4 shrink-0'
  switch (name) {
    case 'Claude':
      // Anthropic / Claude icon
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M17.304 3h-2.89l-5.83 9.013 2.513 3.88L17.304 3zM6.696 3H3.8L12 17.82 14.511 13.94 6.696 3zm-2.892 18h2.892l1.677-2.591-1.256-1.94L3.804 21zM17.304 21h2.892l-5.25-8.107-1.255 1.939L17.304 21z"/>
        </svg>
      )
    case 'GPT':
      // OpenAI icon
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0L4.06 14.39A4.5 4.5 0 0 1 2.34 7.896zm16.597 3.855-5.833-3.387 2.019-1.168a.076.076 0 0 1 .071 0l4.757 2.746a4.5 4.5 0 0 1-.676 8.123V12.47a.79.79 0 0 0-.338-.72zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.76-2.744a4.5 4.5 0 0 1 6.676 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
        </svg>
      )
    case 'Gemini':
      return (
        <svg className={cls} viewBox="0 0 24 24" aria-hidden="true">
          <defs><linearGradient id="gm" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#4285F4"/><stop offset="100%" stopColor="#34A853"/></linearGradient></defs>
          <path fill="url(#gm)" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.24 0 2.4.33 3.4.9L5.9 15.4A7.02 7.02 0 0 1 5 12c0-3.87 3.13-7 7-7zm0 14c-1.24 0-2.4-.33-3.4-.9l9.5-9.5c.57 1 .9 2.16.9 3.4 0 3.87-3.13 7-7 7z"/>
        </svg>
      )
    case 'Grok':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
      )
    case 'DeepSeek':
      return <span className={`${cls} text-[11px] font-bold text-blue-600`} aria-hidden="true">DS</span>
    case 'Azure':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="#0078D4" aria-hidden="true">
          <path d="M13.05 4.24L6.56 18.05l5.78.01 4.74-8.19-4.03-5.63zm.83 15.51H21l-6.13-10.68-1 1.73 3.87 6.74-3.86.21zm-7.4.3-2.48-.01L13.6 2.25l1.66 2.31-8.78 15.49z"/>
        </svg>
      )
    case 'AWS':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="#FF9900" aria-hidden="true">
          <path d="M6.763 10.036c0 .296.032.535.088.71.064.176.144.368.256.576.04.063.056.127.056.183 0 .08-.048.16-.152.24l-.503.335a.383.383 0 0 1-.208.072c-.08 0-.16-.04-.239-.112a2.47 2.47 0 0 1-.287-.375 6.18 6.18 0 0 1-.248-.471c-.622.734-1.405 1.101-2.347 1.101-.67 0-1.205-.191-1.596-.574-.391-.384-.59-.894-.59-1.533 0-.678.239-1.23.726-1.644.487-.415 1.133-.623 1.955-.623.272 0 .551.024.846.064.296.04.6.104.918.176v-.583c0-.607-.127-1.03-.375-1.277-.255-.248-.686-.367-1.3-.367-.28 0-.568.031-.863.103-.295.072-.583.16-.862.272a2.287 2.287 0 0 1-.28.104.488.488 0 0 1-.127.023c-.112 0-.168-.08-.168-.247v-.391c0-.128.016-.224.056-.28a.597.597 0 0 1 .224-.167c.279-.144.614-.264 1.005-.36a4.84 4.84 0 0 1 1.246-.151c.95 0 1.644.216 2.091.647.439.43.662 1.085.662 1.963v2.586zm-3.24 1.214c.263 0 .534-.048.822-.144.287-.096.543-.271.758-.51.128-.152.224-.32.272-.512.047-.191.08-.423.08-.694v-.335a6.66 6.66 0 0 0-.735-.136 6.02 6.02 0 0 0-.75-.048c-.535 0-.926.104-1.19.32-.263.215-.39.518-.39.917 0 .375.095.655.295.846.191.2.47.296.838.296zm6.41.862c-.144 0-.240-.024-.304-.08-.064-.048-.12-.16-.168-.311L7.586 5.55a1.398 1.398 0 0 1-.072-.32c0-.128.064-.2.191-.2h.783c.151 0 .255.025.31.08.065.048.113.16.16.312l1.342 5.284 1.245-5.284c.04-.16.088-.264.151-.312a.549.549 0 0 1 .32-.08h.638c.152 0 .256.025.32.08.063.048.12.16.151.312l1.261 5.348 1.381-5.348c.048-.16.104-.264.16-.312a.52.52 0 0 1 .311-.08h.743c.127 0 .2.065.2.2 0 .04-.009.08-.017.127a1.137 1.137 0 0 1-.056.2l-1.923 6.17c-.048.16-.104.263-.168.311a.51.51 0 0 1-.303.08h-.687c-.151 0-.255-.024-.32-.08-.063-.056-.119-.16-.15-.32l-1.238-5.148-1.23 5.14c-.04.16-.087.264-.15.32-.065.056-.177.08-.32.08zm10.256.215c-.415 0-.83-.048-1.229-.143-.399-.096-.71-.2-.918-.32-.128-.071-.215-.151-.247-.223a.563.563 0 0 1-.048-.224v-.407c0-.167.064-.247.183-.247.048 0 .096.008.144.024.048.016.12.048.2.08.271.12.566.215.878.279.319.064.63.096.95.096.502 0 .894-.088 1.165-.264a.86.86 0 0 0 .415-.758.777.777 0 0 0-.215-.559c-.144-.151-.416-.287-.806-.415l-1.157-.36c-.583-.183-1.014-.454-1.277-.813a1.902 1.902 0 0 1-.4-1.158c0-.335.073-.63.216-.886.144-.255.335-.479.575-.655.24-.184.51-.32.83-.415.32-.096.655-.136 1.006-.136.175 0 .359.008.535.032.183.024.35.056.518.088.16.04.312.08.455.127.144.048.256.096.336.144a.69.69 0 0 1 .24.2.43.43 0 0 1 .071.263v.375c0 .168-.064.256-.184.256a.83.83 0 0 1-.303-.096 3.652 3.652 0 0 0-1.532-.311c-.455 0-.815.071-1.062.223-.248.152-.375.383-.375.71 0 .224.08.416.24.567.159.152.454.304.877.44l1.134.358c.574.184.991.44 1.237.767.247.327.367.702.367 1.117 0 .343-.072.655-.207.926-.144.272-.336.511-.583.703-.248.2-.543.343-.886.447-.36.111-.743.167-1.158.167z"/>
        </svg>
      )
    case 'GLM':
      return <span className={`${cls} text-[10px] font-bold text-purple-600`} aria-hidden="true">GLM</span>
    case 'Kimi':
      return <span className={`${cls} text-[11px] font-bold text-blue-500`} aria-hidden="true">K</span>
    case 'OpenRouter':
      return <span className={`${cls} text-[10px] font-bold text-orange-500`} aria-hidden="true">OR</span>
    case 'Seedance':
      return <span className={`${cls} text-[10px] font-bold text-pink-500`} aria-hidden="true">SD</span>
    case 'Qwen':
      return <span className={`${cls} text-[10px] font-bold text-green-600`} aria-hidden="true">QW</span>
    case 'Doubao':
      return <span className={`${cls} text-[10px] font-bold text-red-500`} aria-hidden="true">DB</span>
    default:
      return null
  }
}

export function ApiKeyCreateDialog({
  open,
  onOpenChange,
  currentRow,
}: ApiKeyCreateDialogProps) {
  const { t } = useTranslation()
  const { triggerRefresh } = useApiKeys()
  const isUpdate = currentRow !== undefined
  const [name, setName] = useState('')
  const [quota, setQuota] = useState('')
  const [validDays, setValidDays] = useState('')
  const [loadedDays, setLoadedDays] = useState('')
  const [loadedExpiry, setLoadedExpiry] = useState<Date | undefined>()
  const [loadedKeyId, setLoadedKeyId] = useState<number | null>(null)
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
  const [crossGroupRetry, setCrossGroupRetry] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const crossGroupRetryLabelId = useId()
  const crossGroupRetryDescriptionId = useId()

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

  const { data: apiKeyData } = useQuery({
    queryKey: ['api-key', currentRow?.id],
    queryFn: async () => requireServerSuccess(await getApiKey(currentRow?.id ?? 0)),
    enabled: open && isUpdate,
    staleTime: 0,
  })

  const { data: groupsData, isLoading: groupsLoading } = useQuery({
    queryKey: ['user-groups'],
    queryFn: async () => requireServerSuccess(await getUserGroups()),
    enabled: open,
    staleTime: 0,
  })

  // Admin-assigned platforms arrive with each group; groups without one fall
  // back to name matching inside apiKeyGroupPlatform.
  const platformMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const [key, info] of Object.entries(groupsData?.data || {})) {
      if (info.platform) map[key] = info.platform
    }
    return map
  }, [groupsData])

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
      const name = apiKeyGroupPlatform(group.label, platformMap)
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return [...counts.entries()].sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1]
      return left[0].localeCompare(right[0])
    })
  }, [groups, platformMap])

  const visibleGroups = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = groups.filter((group) => {
      const groupPlatform = apiKeyGroupPlatform(group.label, platformMap)
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
    setLoadedDays('')
    setLoadedExpiry(undefined)
    setLoadedKeyId(null)
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
    setCrossGroupRetry(true)
  }, [open])

  useEffect(() => {
    if (!open || !currentRow || loadedKeyId === currentRow.id) return
    if (!apiKeyData?.success || !apiKeyData.data) return
    const defaults = transformApiKeyToFormDefaults(
      apiKeyData.data,
      groups.map((group) => group.value),
      maxRoutes
    )
    if (!groups.length) return
    if (
      defaults.group === 'auto' &&
      defaults.auto_groups.length === 0 &&
      !autoGroupsData
    ) {
      return
    }
    setName(defaults.name)
    setQuota(
      defaults.unlimited_quota
        ? ''
        : String(
            quotaUnitsToEditableAmount(
              apiKeyData.data.unlimited_quota ? 0 : apiKeyData.data.remain_quota
            )
          )
    )
    if (defaults.expired_time) {
      const remainingDays = Math.max(
        1,
        Math.ceil(
          (defaults.expired_time.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
        )
      )
      setValidDays(String(remainingDays))
      setLoadedDays(String(remainingDays))
      setLoadedExpiry(defaults.expired_time)
    } else {
      setValidDays('')
      setLoadedDays('')
      setLoadedExpiry(undefined)
    }
    setModelLimits(defaults.model_limits)
    setAllowIps(defaults.allow_ips)
    setAllowUserQuotaQuery(defaults.allow_user_quota_query)
    // A non-Auto key has no stored retry choice; keep the default for when it
    // is switched to smart routing.
    setCrossGroupRetry(
      defaults.group === 'auto' ? defaults.cross_group_retry === true : true
    )
    if (defaults.group === 'auto' && defaults.auto_groups.length > 0) {
      setChannelMode('smart')
      setRoutes(defaults.auto_groups)
      setPreview(null)
    } else if (defaults.group === 'auto') {
      const inherited = (autoGroupsData?.data?.groups || []).filter((group) =>
        groups.some((item) => item.value === group)
      )
      setChannelMode('smart')
      setRoutes(inherited)
      setPreview(null)
    } else if (defaults.group) {
      setChannelMode('primary')
      setPreview(defaults.group)
      setRoutes([])
    }
    setLoadedKeyId(currentRow.id)
  }, [apiKeyData, autoGroupsData, currentRow, groups, loadedKeyId, maxRoutes, open])

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
      isUpdate && daysText === loadedDays
        ? loadedExpiry
        : days === undefined
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
      const payload = transformFormDataToPayload({
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
        // Only an Auto route keeps this; transformFormDataToPayload clears it
        // for a single group.
        cross_group_retry: crossGroupRetry,
      })
      const result = currentRow
        ? await updateApiKey({ ...payload, id: currentRow.id })
        : await createApiKey(payload)
      if (!result.success) {
        handleServerError(
          result,
          t(isUpdate ? ERROR_MESSAGES.UPDATE_FAILED : ERROR_MESSAGES.CREATE_FAILED)
        )
        return
      }
      toast.success(
        isUpdate
          ? t(SUCCESS_MESSAGES.API_KEY_UPDATED)
          : t('Successfully created {{count}} API Key(s)', { count: 1 })
      )
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
      title={isUpdate ? t('Update API Key') : t('Create API Key')}
      contentClassName='sm:max-w-6xl'
      contentHeight='auto'
    >
      <div className='flex flex-col gap-4'>
        <div
          className={cn(
            'grid gap-3',
            channelMode === 'smart' ? 'md:grid-cols-4' : 'md:grid-cols-3'
          )}
        >
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
          {/* Retry across groups only applies to an Auto (smart) route. */}
          {channelMode === 'smart' && (
            <div className='flex flex-col gap-1.5 text-sm'>
              <span id={crossGroupRetryLabelId} className='font-medium'>
                {t('Cross-group retry')}
              </span>
              <div className='flex min-h-9 items-center justify-between gap-3'>
                <span
                  id={crossGroupRetryDescriptionId}
                  className='text-muted-foreground line-clamp-2 text-xs'
                >
                  {t(
                    'When enabled, if channels in the current group fail, it will try channels in the next group in order.'
                  )}
                </span>
                <Switch
                  aria-labelledby={crossGroupRetryLabelId}
                  aria-describedby={crossGroupRetryDescriptionId}
                  checked={crossGroupRetry}
                  onCheckedChange={(checked) =>
                    setCrossGroupRetry(checked === true)
                  }
                />
              </div>
            </div>
          )}
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
              platform='__all__'
            />
            {platforms.map(([name, count]) => (
              <PlatformButton
                key={name}
                active={platform === name}
                label={platformLabel(name, t)}
                count={count}
                onClick={() => setPlatform(name)}
                platform={name}
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
                actionLabel={isUpdate ? t('Save changes') : t('Create')}
              />
            ) : previewGroup ? (
              <>
                <div>
                  <p className='text-muted-foreground text-xs'>
                    {platformLabel(apiKeyGroupPlatform(previewGroup.label, platformMap), t)}
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
                  {isUpdate ? t('Save changes') : t('Set as primary channel')}
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
  actionLabel: string
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
        {props.actionLabel}
      </Button>
    </div>
  )
}

function PlatformButton(props: {
  active: boolean
  label: string
  count: number
  onClick: () => void
  platform?: string
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
      <span className='flex items-center gap-1.5 truncate min-w-0'>
        {props.platform && props.platform !== '__all__' && (
          <PlatformIcon name={props.platform} />
        )}
        <span className='truncate'>{props.label}</span>
      </span>
      <span className='text-muted-foreground ms-2 text-xs tabular-nums shrink-0'>
        {props.count}
      </span>
    </button>
  )
}

