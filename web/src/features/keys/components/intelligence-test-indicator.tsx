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
import { Brain, Loader2 } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import { formatElapsed } from '../lib/intelligence-test'
import { useIntelligenceElapsed } from './dialogs/intelligence-test-dialog'
import { useIntelligenceTest } from './intelligence-test-provider'

/**
 * The minimized test in the bottom right corner. Leaving or reloading the
 * page while it runs asks the browser to confirm, since that ends the request.
 */
export function IntelligenceTestIndicator() {
  const { t } = useTranslation()
  const test = useIntelligenceTest()
  const elapsed = useIntelligenceElapsed()

  useEffect(() => {
    if (!test.running) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [test.running])

  if (!test.running || test.dialogOpen) return null

  return (
    <Button
      variant='outline'
      className='bg-background fixed right-4 bottom-4 z-50 shadow-lg'
      onClick={() => test.setDialogOpen(true)}
    >
      <Loader2 className='animate-spin' aria-hidden='true' />
      <Brain aria-hidden='true' />
      {t('Intelligence test running {{time}}', {
        time: formatElapsed(elapsed),
      })}
    </Button>
  )
}
