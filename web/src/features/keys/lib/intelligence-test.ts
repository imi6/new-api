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
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import type { IntelligenceCheck } from '@/features/group-health/types'

import { API_KEY_STATUS } from '../constants'
import type { ApiKey } from '../types'

// A user's own intelligence test: the browser asks the question with the
// user's key through the normal API, so it is billed and logged like any other
// call. The server only serves the questions and grades the answer.

export type IntelligenceQuestionKey = 'pelican' | 'candy'

export interface IntelligenceQuestion {
  key: IntelligenceQuestionKey
  prompt: string
  max_tokens: number
}

export interface IntelligenceTestConfig {
  questions: IntelligenceQuestion[]
  user_group: string
  auto_groups: string[]
  group_models: Record<string, string[]>
  model_endpoints: Record<string, string[]>
}

interface ServerResponse<T> {
  success: boolean
  message?: string
  data: T
}

export async function getIntelligenceTestConfig(): Promise<IntelligenceTestConfig> {
  const res = await api.get<ServerResponse<IntelligenceTestConfig>>(
    '/api/user/intelligence-check',
    { skipErrorHandler: true }
  )
  return requireServerSuccess(res.data).data
}

export async function gradeIntelligenceTest(params: {
  question: IntelligenceQuestionKey
  response: string
  cutAtLimit: boolean
}): Promise<IntelligenceCheck> {
  const res = await api.post<ServerResponse<IntelligenceCheck>>(
    '/api/user/intelligence-check/grade',
    {
      question: params.question,
      response: params.response,
      cut_at_limit: params.cutAtLimit,
    },
    { skipErrorHandler: true }
  )
  return requireServerSuccess(res.data).data
}

/** The group a key's requests use: its own, or the user's when unset. */
export function keyGroup(key: ApiKey, userGroup: string): string {
  return key.group || userGroup
}

/**
 * Why a key cannot be tested from the browser, as a locale key, or null.
 * An IP allow list never holds the browser's address, so such a key would
 * only fail.
 */
export function keyUnavailableReason(key: ApiKey): string | null {
  if (key.status === API_KEY_STATUS.DISABLED) return 'Disabled'
  if (key.status === API_KEY_STATUS.EXPIRED) return 'Expired'
  if (
    key.status === API_KEY_STATUS.EXHAUSTED ||
    (!key.unlimited_quota && key.remain_quota <= 0)
  ) {
    return 'Exhausted'
  }
  if (key.status !== API_KEY_STATUS.ENABLED) return 'Disabled'
  if ((key.allow_ips ?? '').trim() !== '') {
    return 'This key limits IPs and cannot be tested from the browser'
  }
  return null
}

/** The models a key can call, the way the API serves them. */
export function keyModels(key: ApiKey, config: IntelligenceTestConfig): string[] {
  const group = keyGroup(key, config.user_group)
  let groups = [group]
  if (group === 'auto') {
    const own = key.auto_groups ?? []
    groups = own.length > 0 ? own : config.auto_groups
  }
  const models = new Set<string>()
  for (const name of groups) {
    for (const model of config.group_models[name] ?? []) models.add(model)
  }
  if (key.model_limits_enabled) {
    const allowed = new Set(
      (key.model_limits ?? '')
        .split(',')
        .map((model) => model.trim())
        .filter(Boolean)
    )
    for (const model of [...models]) {
      if (!allowed.has(model)) models.delete(model)
    }
  }
  return [...models].sort((a, b) => a.localeCompare(b))
}

export interface IntelligenceStreamResult {
  answer: string
  cutAtLimit: boolean
  outputTokens: number
  requestId: string
}

export class IntelligenceRequestError extends Error {
  requestId: string

  constructor(message: string, requestId: string) {
    super(message)
    this.requestId = requestId
  }
}

interface StreamEvent {
  type?: string
  delta?: unknown
  response?: {
    usage?: { output_tokens?: number }
    incomplete_details?: { reason?: string }
  }
  choices?: Array<{
    delta?: { content?: unknown }
    finish_reason?: string | null
  }>
  usage?: { completion_tokens?: number; output_tokens?: number }
}

/**
 * Asks the question with the key and reads the stream. Models that serve the
 * Responses API use it; the rest use Chat Completions. Reasoning text is left
 * out of the answer.
 */
export async function askIntelligenceQuestion(params: {
  apiKey: string
  model: string
  question: IntelligenceQuestion
  endpoints: string[]
  signal: AbortSignal
  onProgress: (receivedChars: number) => void
}): Promise<IntelligenceStreamResult> {
  const useResponses = params.endpoints.includes('openai-response')
  const url = useResponses ? '/v1/responses' : '/v1/chat/completions'
  const body = useResponses
    ? {
        model: params.model,
        stream: true,
        max_output_tokens: params.question.max_tokens,
        input: [{ role: 'user', content: params.question.prompt }],
      }
    : {
        model: params.model,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: params.question.max_tokens,
        messages: [{ role: 'user', content: params.question.prompt }],
      }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: params.signal,
  })
  const requestId = response.headers.get('X-Oneapi-Request-Id') ?? ''
  if (!response.ok || !response.body) {
    let message = `HTTP ${response.status}`
    try {
      const data = (await response.json()) as {
        error?: { message?: string }
        message?: string
      }
      message = data.error?.message || data.message || message
    } catch {
      // Keep the status line when the body is not JSON.
    }
    throw new IntelligenceRequestError(message, requestId)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let answer = ''
  let cutAtLimit = false
  let outputTokens = 0
  const readLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const payload = trimmed.slice(5).trim()
    if (payload === '' || payload === '[DONE]') return
    let event: StreamEvent
    try {
      event = JSON.parse(payload) as StreamEvent
    } catch {
      return
    }
    if (event.type === 'response.output_text.delta') {
      if (typeof event.delta === 'string') answer += event.delta
      return
    }
    if (event.response?.incomplete_details?.reason === 'max_output_tokens') {
      cutAtLimit = true
    }
    if (event.response?.usage?.output_tokens) {
      outputTokens = event.response.usage.output_tokens
    }
    for (const choice of event.choices ?? []) {
      if (typeof choice.delta?.content === 'string') {
        answer += choice.delta.content
      }
      if (choice.finish_reason === 'length') cutAtLimit = true
    }
    if (event.usage?.completion_tokens) {
      outputTokens = event.usage.completion_tokens
    }
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    pending += decoder.decode(value, { stream: true })
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) readLine(line)
    params.onProgress(answer.length)
  }
  readLine(pending)
  return { answer, cutAtLimit, outputTokens, requestId }
}

/** Seconds as m:ss, for the running clock. */
export function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}
