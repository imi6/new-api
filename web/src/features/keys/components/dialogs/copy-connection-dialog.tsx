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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { encodeChannelConnectionInfo } from '@/lib/channel-connection-info'

import { useApiKeyEndpoints } from '../../hooks/use-api-key-endpoints'
import { ApiEndpointSelect } from '../api-endpoint-select'

export function CopyConnectionDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tokenKey: string
}) {
  const { t } = useTranslation()
  const { endpoints, loading } = useApiKeyEndpoints()
  const [selectedUrl, setSelectedUrl] = useState('')
  const selected =
    endpoints.find((endpoint) => endpoint.url === selectedUrl) ?? endpoints[0]

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Copy Connection Info')}
      description={t('Choose an API node to copy its connection information.')}
      contentClassName='sm:max-w-md'
      footer={
        <>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <CopyButton
            value={encodeChannelConnectionInfo(
              props.tokenKey,
              selected?.url ?? ''
            )}
            variant='default'
            size='default'
            disabled={loading || !selected || !props.tokenKey}
            notify
            aria-label={t('Copy Connection Info')}
          >
            {t('Copy Connection Info')}
          </CopyButton>
        </>
      }
    >
      <ApiEndpointSelect
        id='copy-connection-endpoint'
        endpoints={endpoints}
        value={selected?.url ?? ''}
        onValueChange={setSelectedUrl}
        disabled={loading}
      />
    </Dialog>
  )
}
