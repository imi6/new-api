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
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import type { IntelligenceCheck } from '@/features/group-health/types'
import { getServerErrorMessage } from '@/lib/server-error-message'

import {
  askIntelligenceQuestion,
  gradeIntelligenceTest,
  IntelligenceRequestError,
  type IntelligenceQuestion,
} from '../lib/intelligence-test'

export type IntelligenceTestPhase =
  | 'idle'
  | 'running'
  | 'grading'
  | 'done'
  | 'failed'

export interface IntelligenceTestRun {
  phase: IntelligenceTestPhase
  keyName: string
  model: string
  question: IntelligenceQuestion | null
  startedAt: number
  finishedAt: number
  receivedChars: number
  requestId: string
  result: IntelligenceCheck | null
  /** The raw answer, kept when grading fails. */
  answer: string
  error: string
}

const idleRun: IntelligenceTestRun = {
  phase: 'idle',
  keyName: '',
  model: '',
  question: null,
  startedAt: 0,
  finishedAt: 0,
  receivedChars: 0,
  requestId: '',
  result: null,
  answer: '',
  error: '',
}

export interface StartIntelligenceTest {
  keyName: string
  resolveKey: () => Promise<string | null>
  model: string
  question: IntelligenceQuestion
  endpoints: string[]
}

type IntelligenceTestContextType = {
  run: IntelligenceTestRun
  running: boolean
  dialogOpen: boolean
  /** The key the dialog opens with; null lets the user choose. */
  initialKeyId: number | null
  openDialog: (keyId?: number | null) => void
  setDialogOpen: (open: boolean) => void
  start: (params: StartIntelligenceTest) => Promise<void>
  stop: () => void
  reset: () => void
}

const IntelligenceTestContext =
  React.createContext<IntelligenceTestContextType | null>(null)

/**
 * Keeps one test going while its dialog is closed: the request lives here,
 * not in the dialog, so closing the dialog only hides it. Leaving the page
 * still ends the request.
 */
export function IntelligenceTestProvider(props: {
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const [run, setRun] = useState<IntelligenceTestRun>(idleRun)
  const [dialogOpen, setDialogOpenState] = useState(false)
  const [initialKeyId, setInitialKeyId] = useState<number | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const dialogOpenRef = useRef(false)

  const setDialogOpen = useCallback((open: boolean) => {
    dialogOpenRef.current = open
    setDialogOpenState(open)
  }, [])

  const openDialog = useCallback(
    (keyId?: number | null) => {
      setInitialKeyId(keyId ?? null)
      setDialogOpen(true)
    },
    [setDialogOpen]
  )

  useEffect(() => () => controllerRef.current?.abort(), [])

  const start = useCallback(
    async (params: StartIntelligenceTest) => {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      const startedAt = Date.now()
      setRun({
        ...idleRun,
        phase: 'running',
        keyName: params.keyName,
        model: params.model,
        question: params.question,
        startedAt,
      })

      const finish = (patch: Partial<IntelligenceTestRun>) => {
        if (controller.signal.aborted) return
        setRun((previous) => ({ ...previous, ...patch, finishedAt: Date.now() }))
        if (!dialogOpenRef.current) {
          const message =
            patch.phase === 'done'
              ? t('Intelligence test finished')
              : t('Intelligence test failed')
          toast(message, {
            action: {
              label: t('View result'),
              onClick: () => setDialogOpen(true),
            },
          })
        }
      }

      const apiKey = await params.resolveKey()
      if (!apiKey) {
        finish({ phase: 'failed', error: t('Could not read the API key') })
        return
      }
      let answer = ''
      try {
        const streamed = await askIntelligenceQuestion({
          apiKey,
          model: params.model,
          question: params.question,
          endpoints: params.endpoints,
          signal: controller.signal,
          onProgress: (receivedChars) => {
            if (controller.signal.aborted) return
            setRun((previous) => ({ ...previous, receivedChars }))
          },
        })
        answer = streamed.answer
        if (controller.signal.aborted) return
        setRun((previous) => ({
          ...previous,
          phase: 'grading',
          requestId: streamed.requestId,
          answer,
        }))
        const result = await gradeIntelligenceTest({
          question: params.question.key,
          response: streamed.answer,
          cutAtLimit: streamed.cutAtLimit,
        })
        finish({
          phase: 'done',
          result: {
            ...result,
            model_name: params.model,
            latency_ms: Date.now() - startedAt,
            output_tokens: streamed.outputTokens,
            created_at: Math.floor(startedAt / 1000),
          },
        })
      } catch (error) {
        if (controller.signal.aborted) return
        const requestId =
          error instanceof IntelligenceRequestError ? error.requestId : ''
        finish({
          phase: 'failed',
          answer,
          error: getServerErrorMessage(error, t('Intelligence test failed')),
          ...(requestId ? { requestId } : {}),
        })
      }
    },
    [setDialogOpen, t]
  )

  const stop = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setRun(idleRun)
  }, [])

  const reset = useCallback(() => {
    if (run.phase === 'running' || run.phase === 'grading') return
    setRun(idleRun)
  }, [run.phase])

  const running = run.phase === 'running' || run.phase === 'grading'

  return (
    <IntelligenceTestContext.Provider
      value={{
        run,
        running,
        dialogOpen,
        initialKeyId,
        openDialog,
        setDialogOpen,
        start,
        stop,
        reset,
      }}
    >
      {props.children}
    </IntelligenceTestContext.Provider>
  )
}

export function useIntelligenceTest() {
  const context = React.useContext(IntelligenceTestContext)
  if (!context) {
    throw new Error(
      'useIntelligenceTest must be used within IntelligenceTestProvider'
    )
  }
  return context
}
