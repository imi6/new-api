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
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type EpayGatewayDraft = {
  id: string
  name: string
  address: string
  epay_id: string
  epay_key: string
  price: number
}

type EpayGatewaysEditorProps = {
  value: string
  onChange: (value: string) => void
}

function createEpayGatewayID() {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )
}

export function parseEpayGateways(value: string): EpayGatewayDraft[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(value || '[]')
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const sites: EpayGatewayDraft[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || record.id === '') continue
    const price = typeof record.price === 'number' ? record.price : 1
    sites.push({
      id: record.id,
      name: typeof record.name === 'string' ? record.name : '',
      address: typeof record.address === 'string' ? record.address : '',
      epay_id: typeof record.epay_id === 'string' ? record.epay_id : '',
      epay_key: typeof record.epay_key === 'string' ? record.epay_key : '',
      price: price >= 0 ? price : 0,
    })
  }
  return sites
}

function writeEpayGateways(sites: EpayGatewayDraft[]) {
  return JSON.stringify(sites, null, 2)
}

export function EpayGatewaysEditor(props: EpayGatewaysEditorProps) {
  const { t } = useTranslation()
  const sites = parseEpayGateways(props.value)

  const updateSite = (
    id: string,
    patch: Partial<Omit<EpayGatewayDraft, 'id'>>
  ) => {
    props.onChange(
      writeEpayGateways(
        sites.map((site) => (site.id === id ? { ...site, ...patch } : site))
      )
    )
  }

  return (
    <div className='space-y-4'>
      {sites.map((site, index) => {
        const topupCallback = `<ServerAddress>/api/user/epay/gateway/${site.id}/notify`
        const subscriptionCallback = `<ServerAddress>/api/subscription/epay/gateway/${site.id}/notify`
        const subscriptionReturn = `<ServerAddress>/api/subscription/epay/gateway/${site.id}/return`
        return (
          <div key={site.id} className='space-y-4 rounded-lg border p-4'>
            <div className='flex items-center justify-between gap-3'>
              <h4 className='text-base font-medium'>
                {site.name.trim() ||
                  t('Epay site {{number}}', { number: index + 2 })}
              </h4>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() =>
                  props.onChange(
                    writeEpayGateways(
                      sites.filter((item) => item.id !== site.id)
                    )
                  )
                }
              >
                <Trash2 className='mr-2 h-3.5 w-3.5' />
                {t('Remove')}
              </Button>
            </div>
            <div className='grid gap-4 md:grid-cols-2'>
              <div className='space-y-2'>
                <Label htmlFor={`epay-site-name-${site.id}`}>
                  {t('Site name')}
                </Label>
                <Input
                  id={`epay-site-name-${site.id}`}
                  value={site.name}
                  placeholder={t('e.g. USDT')}
                  onChange={(event) =>
                    updateSite(site.id, { name: event.target.value })
                  }
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor={`epay-site-price-${site.id}`}>
                  {t('Price (local currency / USD)')}
                </Label>
                <Input
                  id={`epay-site-price-${site.id}`}
                  type='number'
                  step='0.01'
                  min={0}
                  value={site.price}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    updateSite(site.id, {
                      price: Number.isFinite(next) && next >= 0 ? next : 0,
                    })
                  }}
                />
                <p className='text-muted-foreground text-sm'>
                  {t(
                    'How much this site charges for each US dollar of balance. USDT merchants often use 1. Use 0 to follow the original Epay price.'
                  )}
                </p>
              </div>
            </div>
            <div className='grid gap-4 md:grid-cols-2'>
              <div className='space-y-2'>
                <Label htmlFor={`epay-site-address-${site.id}`}>
                  {t('Epay endpoint')}
                </Label>
                <Input
                  id={`epay-site-address-${site.id}`}
                  value={site.address}
                  placeholder={t('https://pay.example.com')}
                  onChange={(event) =>
                    updateSite(site.id, { address: event.target.value })
                  }
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor={`epay-site-id-${site.id}`}>
                  {t('Epay merchant ID')}
                </Label>
                <Input
                  id={`epay-site-id-${site.id}`}
                  value={site.epay_id}
                  autoComplete='off'
                  placeholder='10001'
                  onChange={(event) =>
                    updateSite(site.id, { epay_id: event.target.value })
                  }
                />
              </div>
            </div>
            <div className='space-y-2'>
              <Label htmlFor={`epay-site-key-${site.id}`}>
                {t('Epay secret key')}
              </Label>
              <Input
                id={`epay-site-key-${site.id}`}
                type='password'
                value={site.epay_key}
                autoComplete='new-password'
                placeholder={t('Enter new key to update')}
                onChange={(event) =>
                  updateSite(site.id, { epay_key: event.target.value })
                }
              />
              <p className='text-muted-foreground text-sm'>
                {t('Leave blank unless rotating the secret')}
              </p>
            </div>
            <div className='text-muted-foreground space-y-1 text-sm'>
              <div className='flex items-center gap-2'>
                <span className='shrink-0'>{t('Top-up callback')}</span>
                <code className='bg-muted truncate rounded px-1.5 py-0.5 text-xs'>
                  {topupCallback}
                </code>
                <CopyButton value={topupCallback} variant='ghost' size='icon' />
              </div>
              <div className='flex items-center gap-2'>
                <span className='shrink-0'>{t('Subscription callback')}</span>
                <code className='bg-muted truncate rounded px-1.5 py-0.5 text-xs'>
                  {subscriptionCallback}
                </code>
                <CopyButton
                  value={subscriptionCallback}
                  variant='ghost'
                  size='icon'
                />
              </div>
              <div className='flex items-center gap-2'>
                <span className='shrink-0'>{t('Subscription return')}</span>
                <code className='bg-muted truncate rounded px-1.5 py-0.5 text-xs'>
                  {subscriptionReturn}
                </code>
                <CopyButton
                  value={subscriptionReturn}
                  variant='ghost'
                  size='icon'
                />
              </div>
            </div>
          </div>
        )
      })}
      <Button
        type='button'
        variant='outline'
        disabled={sites.length >= 20}
        onClick={() =>
          props.onChange(
            writeEpayGateways([
              ...sites,
              {
                id: createEpayGatewayID(),
                name: '',
                address: '',
                epay_id: '',
                epay_key: '',
                price: 1,
              },
            ])
          )
        }
      >
        <Plus className='mr-2 h-4 w-4' />
        {t('Add Epay site')}
      </Button>
    </div>
  )
}
