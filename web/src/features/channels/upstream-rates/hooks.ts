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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  getUpstreamRateConfig,
  getUpstreamRateTask,
  refreshUpstreamRates,
  upstreamRateQueryKey,
} from './api'

export function useUpstreamRateConfig(enabled = true) {
  return useQuery({
    queryKey: [...upstreamRateQueryKey, 'config'],
    queryFn: ({ signal }) => getUpstreamRateConfig(signal),
    staleTime: 30_000,
    enabled,
  })
}

export function useUpstreamRateRefresh() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [taskID, setTaskID] = useState<string | null>(null)
  const task = useQuery({
    queryKey: [...upstreamRateQueryKey, 'task', taskID],
    queryFn: ({ signal }) => {
      if (!taskID) throw new Error('Invalid upstream rate configuration')
      return getUpstreamRateTask(taskID, signal)
    },
    enabled: taskID !== null,
    retry: 1,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'succeeded' || status === 'failed' ? false : 1500
    },
  })
  const mutation = useMutation({
    mutationFn: refreshUpstreamRates,
    onSuccess: (value) => setTaskID(value.task_id),
  })

  useEffect(() => {
    if (!taskID) return
    if (task.isError) {
      setTaskID(null)
      void client.invalidateQueries({ queryKey: upstreamRateQueryKey })
      return
    }
    const status = task.data?.status
    if (status !== 'succeeded' && status !== 'failed') return
    setTaskID(null)
    void client.invalidateQueries({ queryKey: upstreamRateQueryKey })
    if (status === 'failed') {
      toast.error(t('Upstream rate refresh was not fully successful'))
    } else {
      toast.success(t('Upstream rate display updated'))
    }
  }, [taskID, task.data?.status, task.isError, client, t])

  return {
    refresh: mutation.mutate,
    busy: mutation.isPending || taskID !== null,
  }
}
