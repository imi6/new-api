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
import { Search } from 'lucide-react'
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  getServerErrorMessage,
  getServerErrorSources,
  getServerErrorStatus,
} from '@/lib/server-error-message'

import {
  exportKeyUsage,
  getKeyUsage,
  type KeyUsageAccess,
  type KeyUsageFilters,
  type KeyUsageResult,
} from '../api'
import { KeyUsageRecords } from './key-usage-records'
import { KeyUsageSummary } from './key-usage-summary'

interface AppliedUsage {
  data: KeyUsageResult
  filters: KeyUsageFilters
}

export function KeyUsageLookup(props: { keyId?: string }) {
  const { t, i18n } = useTranslation()
  const [apiKey, setApiKey] = useState('')
  const [usage, setUsage] = useState<AppliedUsage | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const request = useRef<AbortController | null>(null)
  const failedPage = useRef<{ filters: KeyUsageFilters; page: number }>({
    filters: {},
    page: 1,
  })
  const keyId = props.keyId
  const owner = keyId !== undefined

  async function runLookup(
    access: KeyUsageAccess,
    filters: KeyUsageFilters,
    page: number
  ) {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    failedPage.current = { filters, page }
    setLoading(true)
    setError(null)
    try {
      const data = await getKeyUsage(
        access,
        filters,
        page,
        controller.signal,
        i18n.language
      )
      if (controller.signal.aborted) return
      setUsage({
        data,
        filters: {
          ...filters,
          start_timestamp: data.start_timestamp,
          end_timestamp: data.end_timestamp,
        },
      })
    } catch (failure) {
      if (controller.signal.aborted) return
      if (keyUsageAccessRejected(failure)) setUsage(null)
      setError(failure)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  function clearLookup() {
    request.current?.abort()
    setUsage(null)
    setError(null)
    setLoading(false)
  }

  const loadOwnerUsage = useEffectEvent((id: string) => {
    void runLookup({ kind: 'owner', keyId: id }, {}, 1)
  })

  const clearPublicUsage = useEffectEvent(() => {
    flushSync(() => {
      clearLookup()
      setApiKey('')
    })
  })

  useEffect(() => {
    if (keyId !== undefined) {
      loadOwnerUsage(keyId)
      return () => request.current?.abort()
    }
    const clearOnPageHide = () => clearPublicUsage()
    window.addEventListener('pagehide', clearOnPageHide)
    return () => {
      request.current?.abort()
      window.removeEventListener('pagehide', clearOnPageHide)
    }
  }, [keyId])

  function access(): KeyUsageAccess {
    return keyId === undefined
      ? { kind: 'public', key: apiKey.trim() }
      : { kind: 'owner', keyId }
  }

  function submitKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    clearLookup()
    const current = access()
    if (
      current.kind === 'public' &&
      !/^sk-[a-zA-Z0-9]{1,128}$/.test(current.key)
    ) {
      setError(new Error(t('Enter a complete API key')))
      return
    }
    void runLookup(current, {}, 1)
  }

  return (
    <div className='space-y-4'>
      {!owner && (
        <Card>
          <CardContent>
            <form onSubmit={submitKey} className='space-y-2'>
              <Label htmlFor='usage-api-key'>{t('API Key')}</Label>
              <div className='flex flex-wrap items-center gap-2'>
                <Input
                  id='usage-api-key'
                  type='password'
                  autoComplete='off'
                  spellCheck={false}
                  autoCapitalize='none'
                  placeholder='sk-…'
                  maxLength={140}
                  value={apiKey}
                  aria-invalid={error !== null}
                  onChange={(event) => {
                    clearLookup()
                    setApiKey(event.target.value)
                  }}
                  className='h-9 min-w-52 flex-1 font-mono'
                />
                <Button
                  type='submit'
                  size='lg'
                  disabled={!apiKey.trim() || loading}
                >
                  <Search aria-hidden='true' />
                  {t('Search')}
                </Button>
                <Button
                  type='button'
                  size='lg'
                  variant='outline'
                  disabled={!apiKey}
                  onClick={() => {
                    clearLookup()
                    setApiKey('')
                  }}
                >
                  {t('Clear')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loading && !usage && <LoadingState />}
      {error !== null &&
        (owner && !usage ? (
          <ErrorState
            title={t('Failed to query API key usage')}
            description={getServerErrorMessage(
              error,
              t('Failed to query logs')
            )}
            onRetry={() => {
              const { filters, page } = failedPage.current
              void runLookup(access(), filters, page)
            }}
          />
        ) : (
          <Alert variant='destructive'>
            <AlertDescription>
              {getServerErrorMessage(error, t('Failed to query logs'))}
            </AlertDescription>
          </Alert>
        ))}

      {usage && (
        <>
          <KeyUsageSummary token={usage.data.token} />
          <KeyUsageRecords
            data={usage.data}
            filters={usage.filters}
            busy={loading}
            onQuery={(filters, page) => void runLookup(access(), filters, page)}
            onExport={async (signal) => {
              try {
                return (
                  await exportKeyUsage(
                    access(),
                    usage.filters,
                    signal,
                    i18n.language
                  )
                ).items
              } catch (failure) {
                if (!signal.aborted && keyUsageAccessRejected(failure)) {
                  clearLookup()
                  setError(failure)
                }
                throw failure
              }
            }}
          />
        </>
      )}
    </div>
  )
}

function keyUsageAccessRejected(failure: unknown): boolean {
  const status = getServerErrorStatus(failure)
  if (status === 401 || status === 404) return true
  if (status !== 403) return false
  return !getServerErrorSources(failure).some(
    (source) => source.message_key === 'Log export is disabled'
  )
}
