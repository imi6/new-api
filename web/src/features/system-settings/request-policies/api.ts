import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import type { SystemTask } from '../types'

export type PolicyConfig = {
  options: Record<string, string>
}
export type PolicyDecision = { action: string; reason: string; source: string }
export type PolicyEvent = {
  attempt: number
  channel_id?: number
  group?: string
  rule?: string
  status?: number
  error_code?: string
  error_source?: string
  elapsed_ms: number
  decision: PolicyDecision
  health?: string
}
type Response<T> = { success: boolean; message?: string; data: T }
export async function getPolicyConfig() {
  const response = await api.get<Response<PolicyConfig>>(
    '/api/option/request_policy'
  )
  return requireServerSuccess(response.data).data
}
/** Enabled models of every user-selectable group. */
export async function getIntelligenceCheckModels() {
  const response = await api.get<Response<Record<string, string[]>>>(
    '/api/option/intelligence_check/models'
  )
  return requireServerSuccess(response.data).data
}
/**
 * Queues a run of every enabled intelligence check, or returns the run
 * already going.
 */
/** Runs every listed group's checks now, or only one group's. */
export async function runIntelligenceChecksNow(group?: string) {
  const response = await api.post<
    Response<{ task_id: string; already_running: boolean }>
  >('/api/option/intelligence_check/run', { group: group ?? '' })
  return requireServerSuccess(response.data).data
}

export type IntelligenceCheckRun = SystemTask<
  { force?: boolean; group?: string },
  { total: number; processed: number; progress: number },
  { checked: number; passed: number; failed: number; other: number }
>

/**
 * Deletes stored check results created before the time, or all of them when
 * before is zero.
 */
export async function clearIntelligenceChecks(before: number) {
  const response = await api.post<Response<{ deleted: number }>>(
    '/api/option/intelligence_check/clear',
    { before }
  )
  return requireServerSuccess(response.data).data
}

/** The intelligence check run in progress, if any. */
export async function getActiveIntelligenceCheckRun() {
  const response = await api.get<Response<IntelligenceCheckRun | null>>(
    '/api/system-task/current',
    { params: { type: 'intelligence_check' } }
  )
  return requireServerSuccess(response.data).data
}

export async function getIntelligenceCheckRun(taskId: string) {
  const response = await api.get<Response<IntelligenceCheckRun>>(
    `/api/system-task/${taskId}`
  )
  return requireServerSuccess(response.data).data
}
export async function savePolicyConfig(options: Record<string, string>) {
  const response = await api.patch<Response<PolicyConfig>>(
    '/api/option/request_policy',
    { options }
  )
  return requireServerSuccess(response.data).data
}
