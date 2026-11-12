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
import { Loader2 } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import {
  CandyCheckCard,
  PelicanCheckCard,
} from '@/features/group-health/components/intelligence-check-cards'
import { DrawingDetail } from '@/features/group-health/components/intelligence-check-dialog'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { getApiKeys } from '../../api'
import {
  formatElapsed,
  getIntelligenceTestConfig,
  keyGroup,
  keyModels,
  keyUnavailableReason,
  type IntelligenceQuestionKey,
} from '../../lib/intelligence-test'
import { useApiKeys } from '../api-keys-provider'
import { useIntelligenceTest } from '../intelligence-test-provider'

const QUESTION_LABEL_KEYS: Record<IntelligenceQuestionKey, string> = {
  pelican: 'Pelican on a bicycle (SVG animation)',
  candy: 'Candy (logic question)',
}

/** Seconds since the test started, ticking while it runs. */
export function useIntelligenceElapsed(): number {
  const { run, running } = useIntelligenceTest()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  if (!run.startedAt) return 0
  const end = running ? now : run.finishedAt || now
  return Math.max(0, Math.floor((end - run.startedAt) / 1000))
}

export function IntelligenceTestDialog() {
  const { t } = useTranslation()
  const id = useId()
  const test = useIntelligenceTest()
  const { resolveRealKey } = useApiKeys()
  const elapsed = useIntelligenceElapsed()
  const [keyId, setKeyId] = useState<string | null>(null)
  const [questionKey, setQuestionKey] = useState<IntelligenceQuestionKey | null>(
    null
  )
  const [model, setModel] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [showDrawing, setShowDrawing] = useState(false)

  const config = useQuery({
    queryKey: ['intelligence-test-config'],
    queryFn: getIntelligenceTestConfig,
    enabled: test.dialogOpen,
    meta: { errorToast: false },
  })
  // The page size cap of the token list; users rarely hold more keys.
  const keys = useQuery({
    queryKey: ['intelligence-test-keys'],
    queryFn: async () => (await getApiKeys({ p: 1, size: 100 })).data?.items ?? [],
    enabled: test.dialogOpen,
  })

  useEffect(() => {
    if (!test.dialogOpen || test.initialKeyId === null) return
    setKeyId(String(test.initialKeyId))
    setModel(null)
  }, [test.dialogOpen, test.initialKeyId])

  const questions = config.data?.questions ?? []
  const question =
    questions.find((item) => item.key === questionKey) ?? questions[0] ?? null
  const selectedKey = keys.data?.find((key) => String(key.id) === keyId) ?? null
  const userGroup = config.data?.user_group ?? ''
  const group = selectedKey ? keyGroup(selectedKey, userGroup) : ''
  const models = useMemo(
    () => (selectedKey && config.data ? keyModels(selectedKey, config.data) : []),
    [selectedKey, config.data]
  )

  const keyOptions = (keys.data ?? []).map((key) => {
    const reason = keyUnavailableReason(key)
    return {
      value: String(key.id),
      label: `${key.name} · ${keyGroup(key, userGroup) || t('User group')}`,
      disabled: reason !== null,
      description: reason ? t(reason) : undefined,
    }
  })
  const modelOptions = models.map((name) => ({ value: name, label: name }))

  const run = test.run
  const canStart =
    !test.running &&
    selectedKey !== null &&
    keyUnavailableReason(selectedKey) === null &&
    question !== null &&
    model !== null &&
    models.includes(model)

  const handleStart = () => {
    if (!canStart || !selectedKey || !question || !model) return
    setShowDrawing(false)
    void test.start({
      keyName: selectedKey.name,
      resolveKey: () => resolveRealKey(selectedKey.id),
      model,
      question,
      endpoints: config.data?.model_endpoints[model] ?? [],
    })
  }

  const handleOpenChange = (open: boolean) => {
    if (open) {
      test.setDialogOpen(true)
      return
    }
    if (test.running) {
      setConfirmClose(true)
      return
    }
    test.setDialogOpen(false)
  }

  let startLabel = t('Start test')
  if (run.phase === 'running') {
    startLabel = t('Testing {{time}}', { time: formatElapsed(elapsed) })
  } else if (run.phase === 'grading') {
    startLabel = t('Grading...')
  } else if (run.phase === 'done' || run.phase === 'failed') {
    startLabel = t('Test again')
  }

  const groupHint =
    group === 'auto'
      ? t('Auto group, billed at the group each request is routed to')
      : t('Group: {{group}} · billed at the price of this group', { group })

  return (
    <>
      <Dialog
        open={test.dialogOpen}
        onOpenChange={handleOpenChange}
        title={t('Intelligence test')}
        description={t(
          'Sends a fixed question to the chosen model with this key. It is charged to your balance at the price of the key group.'
        )}
        contentClassName={showDrawing ? 'sm:max-w-5xl' : 'sm:max-w-2xl'}
        footer={
          <>
            <Button variant='outline' onClick={() => handleOpenChange(false)}>
              {t('Close')}
            </Button>
            <Button onClick={handleStart} disabled={!canStart}>
              {test.running && (
                <Loader2 className='animate-spin' aria-hidden='true' />
              )}
              {startLabel}
            </Button>
          </>
        }
      >
        {config.isLoading && <LoadingState message={t('Loading...')} />}
        {config.isError && (
          <Alert variant='destructive'>
            <AlertDescription>
              {getServerErrorMessage(config.error)}
            </AlertDescription>
          </Alert>
        )}
        {config.data && showDrawing && run.result && (
          <DrawingDetail
            check={run.result}
            onBack={() => setShowDrawing(false)}
            backLabel={t('Back to result')}
          />
        )}
        {config.data && !showDrawing && (
          <div className='flex flex-col gap-5'>
            <div className='flex flex-col gap-2'>
              <Label id={`${id}-key`}>
                {t('API key')}
                <span className='text-destructive'>*</span>
              </Label>
              <Combobox
                options={keyOptions}
                value={keyId}
                onValueChange={(value) => {
                  setKeyId(value)
                  setModel(null)
                }}
                disabled={test.running}
                placeholder={t('Choose an API key')}
                emptyText={t('No API keys')}
                className='w-full min-w-0'
                aria-labelledby={`${id}-key`}
              />
              {selectedKey && (
                <p className='text-muted-foreground text-xs'>{groupHint}</p>
              )}
            </div>

            {question && (
              <div className='flex flex-col gap-2'>
                <Label id={`${id}-question`}>{t('Question')}</Label>
                <RadioGroup
                  aria-labelledby={`${id}-question`}
                  value={question.key}
                  className='flex flex-wrap gap-4'
                  onValueChange={(value) => {
                    if (value === 'pelican' || value === 'candy') {
                      setQuestionKey(value)
                    }
                  }}
                  disabled={test.running}
                >
                  {questions.map((item) => (
                    <label
                      key={item.key}
                      className='flex cursor-pointer items-center gap-2 text-sm'
                    >
                      <RadioGroupItem value={item.key} />
                      {t(QUESTION_LABEL_KEYS[item.key])}
                    </label>
                  ))}
                </RadioGroup>
                <Textarea
                  readOnly
                  value={question.prompt}
                  rows={4}
                  aria-label={t('Question')}
                  className='bg-muted/40 text-muted-foreground resize-none text-xs'
                />
                <p className='text-muted-foreground text-xs'>
                  {t('At most {{count}} output tokens', {
                    count: question.max_tokens,
                  })}
                </p>
              </div>
            )}

            <div className='flex flex-col gap-2'>
              <Label id={`${id}-model`}>
                {t('Model')}
                <span className='text-destructive'>*</span>
              </Label>
              <Combobox
                options={modelOptions}
                value={model}
                onValueChange={setModel}
                disabled={test.running || !selectedKey}
                placeholder={t('Choose a model')}
                searchPlaceholder={t('Search models')}
                emptyText={t('No models')}
                className='w-full min-w-0'
                aria-labelledby={`${id}-model`}
              />
            </div>

            <IntelligenceTestOutcome onOpenDrawing={() => setShowDrawing(true)} />
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title={t('The test is still running')}
        desc={t(
          'Minimize it to keep testing, or stop it. Stopping does not refund what has already been used.'
        )}
        cancelBtnText={t('Cancel')}
        confirmText={t('Stop test')}
        destructive
        handleConfirm={() => {
          test.stop()
          setConfirmClose(false)
          test.setDialogOpen(false)
        }}
      >
        <Button
          variant='outline'
          onClick={() => {
            setConfirmClose(false)
            test.setDialogOpen(false)
          }}
        >
          {t('Minimize and keep testing')}
        </Button>
      </ConfirmDialog>
    </>
  )
}

/** Progress while the test runs, then the graded result. */
function IntelligenceTestOutcome(props: { onOpenDrawing: () => void }) {
  const { t } = useTranslation()
  const { run } = useIntelligenceTest()
  if (run.phase === 'idle') return null

  if (run.phase === 'running' || run.phase === 'grading') {
    return (
      <div className='bg-muted/30 text-muted-foreground flex items-center gap-2 rounded-xl border px-3 py-3 text-sm'>
        <Loader2 className='size-4 animate-spin' aria-hidden='true' />
        {run.phase === 'grading'
          ? t('Grading the answer...')
          : t('The model is answering, {{count}} characters received', {
              count: run.receivedChars,
            })}
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-3 border-t pt-4'>
      <div className='text-muted-foreground text-xs'>
        {t('{{model}} · key {{key}}', { model: run.model, key: run.keyName })}
      </div>
      {run.phase === 'failed' && (
        <Alert variant='destructive'>
          <AlertDescription className='break-all'>{run.error}</AlertDescription>
        </Alert>
      )}
      {run.result && run.question?.key === 'candy' && (
        <CandyCheckCard check={run.result} hideExpected />
      )}
      {run.result && run.question?.key === 'pelican' && (
        <PelicanCheckCard check={run.result} onOpen={props.onOpenDrawing} />
      )}
      {run.requestId && (
        <div className='text-muted-foreground flex min-w-0 items-center gap-2 text-xs'>
          <span className='shrink-0'>{t('Request ID')}</span>
          <code className='bg-muted truncate rounded px-1.5 py-0.5'>
            {run.requestId}
          </code>
          <CopyButton
            value={run.requestId}
            variant='ghost'
            size='icon'
            aria-label={t('Copy')}
          />
        </div>
      )}
      <p className='text-muted-foreground text-xs'>
        {t(
          'This result covers one request only. Requests of a group go to different routes and can differ; see the channel status page for how a group does over time.'
        )}
      </p>
    </div>
  )
}
