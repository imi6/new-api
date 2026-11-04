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
import { useNavigate } from '@tanstack/react-router'
import { Receipt, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { EmptyState } from '@/components/empty-state'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuthStore } from '@/stores/auth-store'

import { InvoiceForm } from './components/invoice-form'
import { InvoiceOrderList } from './components/invoice-order-list'
import { InvoiceStatCards } from './components/invoice-stat-cards'
import { MyInvoiceList } from './components/my-invoice-list'
import {
  useInvoiceableOrders,
  useInvoiceConfig,
  useInvoiceSummary,
  useRefreshInvoices,
} from './hooks/use-invoice'
import { orderKey } from './lib/invoice'
import type { InvoiceOrder } from './types'

interface InvoiceCenterProps {
  /** Set to "return" when Epay sends the user back after paying the tax. */
  pay?: string
}

export function InvoiceCenter(props: InvoiceCenterProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const email = useAuthStore((s) => s.auth.user?.email ?? '')
  const config = useInvoiceConfig()
  const summary = useInvoiceSummary()
  const orders = useInvoiceableOrders()
  const refresh = useRefreshInvoices()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [refreshing, setRefreshing] = useState(false)

  const orderList = orders.data ?? []
  const maxOrders = config.data?.max_orders ?? 0
  const selectedOrders = orderList.filter((order) =>
    selected.has(orderKey(order))
  )

  // The tax callback may land a moment after the browser returns.
  useEffect(() => {
    if (props.pay !== 'return') return
    toast.info(
      t('Payment received. The application status updates once confirmed.')
    )
    void refresh()
    void navigate({ to: '/invoice', search: {}, replace: true })
  }, [props.pay, refresh, navigate, t])

  // Drop selections that are no longer invoiceable after a refetch.
  useEffect(() => {
    if (!orders.data) return
    const keys = new Set(orders.data.map(orderKey))
    setSelected((current) => {
      const next = new Set([...current].filter((key) => keys.has(key)))
      return next.size === current.size ? current : next
    })
  }, [orders.data])

  const handleToggle = (order: InvoiceOrder, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      const key = orderKey(order)
      if (checked && next.size < maxOrders) next.add(key)
      if (!checked) next.delete(key)
      return next
    })
  }

  const handleToggleAll = (checked: boolean) => {
    if (!checked) {
      setSelected(new Set())
      return
    }
    setSelected(new Set(orderList.slice(0, maxOrders).map(orderKey)))
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await refresh()
    setRefreshing(false)
  }

  const handleSubmitted = () => {
    setSelected(new Set())
    void refresh()
  }

  const renderContent = () => {
    if (config.isLoading) {
      return (
        <div className='flex flex-col gap-4'>
          <Skeleton className='h-24 rounded-xl' />
          <Skeleton className='h-80 rounded-xl' />
        </div>
      )
    }
    if (!config.data?.enabled) {
      return (
        <EmptyState
          icon={Receipt}
          title={t('Invoicing is not available')}
          description={t('The administrator has not enabled invoicing.')}
          className='min-h-[320px]'
        />
      )
    }
    return (
      <div className='flex flex-col gap-4'>
        <InvoiceStatCards
          summary={summary.data}
          loading={summary.isLoading}
          error={summary.isError}
        />
        <div className='grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]'>
          <div className='flex min-w-0 flex-col gap-4'>
            <InvoiceOrderList
              orders={orderList}
              loading={orders.isLoading}
              selected={selected}
              maxOrders={maxOrders}
              orderDays={config.data.order_days}
              onToggle={handleToggle}
              onToggleAll={handleToggleAll}
            />
            <MyInvoiceList onChanged={() => void refresh()} />
          </div>
          <div className='lg:sticky lg:top-4'>
            <InvoiceForm
              config={config.data}
              orders={selectedOrders}
              defaultEmail={email}
              onSubmitted={handleSubmitted}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Invoice center')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          variant='outline'
          size='sm'
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw
            className={refreshing ? 'animate-spin' : undefined}
            aria-hidden='true'
          />
          {t('Refresh')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='mx-auto w-full max-w-6xl'>{renderContent()}</div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
