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
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import {
  SideDrawerSection,
  SideDrawerSectionHeader,
  sideDrawerContentClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { GroupBadge } from '@/components/group-badge'
import { StatusBadge } from '@/components/status-badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { formatQuota, formatTimestampToDate } from '@/lib/format'

import { getAffiliateInviter } from '../api'
import type { AffiliateInviter } from '../types'

interface AffiliateInviterDrawerProps {
  inviter: AffiliateInviter | null
  onOpenChange: (open: boolean) => void
}

/** One inviter's invitees and rebate claims. */
export function AffiliateInviterDrawer(props: AffiliateInviterDrawerProps) {
  const { t } = useTranslation()
  const inviter = props.inviter
  const query = useQuery({
    queryKey: ['affiliate-rewards', 'inviter', inviter?.user_id],
    queryFn: () => getAffiliateInviter(inviter?.user_id ?? 0),
    enabled: inviter !== null,
  })
  const detail = query.data

  return (
    <Sheet open={inviter !== null} onOpenChange={props.onOpenChange}>
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[720px]')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>
            {inviter ? `${inviter.username} · ID ${inviter.user_id}` : ''}
          </SheetTitle>
          <SheetDescription render={<div />}>
            {inviter && (
              <span className='flex flex-wrap items-center gap-2'>
                <GroupBadge group={inviter.group} />
                {inviter.special_ratio && (
                  <StatusBadge
                    label={t('Special ratio')}
                    variant='warning'
                    size='sm'
                    copyable={false}
                  />
                )}
                <span>
                  {t('Rebate earned {{earned}}, claimed {{claimed}}', {
                    earned: formatQuota(inviter.accrued),
                    claimed: formatQuota(inviter.claimed),
                  })}
                </span>
              </span>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className={sideDrawerFormClassName()}>
          {query.isLoading && (
            <div className='flex flex-col gap-3'>
              <Skeleton className='h-48' />
              <Skeleton className='h-32' />
            </div>
          )}
          {detail && (
            <>
              <SideDrawerSection>
                <SideDrawerSectionHeader
                  title={t('Invited users')}
                  description={
                    detail.invitee_total > detail.invitees.length
                      ? t(
                          '{{total}} users; the {{shown}} with the most rebate are shown',
                          {
                            total: detail.invitee_total,
                            shown: detail.invitees.length,
                          }
                        )
                      : t('{{count}} users', { count: detail.invitee_total })
                  }
                />
                <StaticDataTable
                  tableClassName='min-w-[560px]'
                  data={detail.invitees}
                  getRowKey={(row) => row.user_id}
                  empty={detail.invitees.length === 0}
                  emptyContent={t('No invited users yet')}
                  columns={[
                    {
                      id: 'user',
                      header: t('User'),
                      cell: (row) => (
                        <span className='flex min-w-0 flex-col'>
                          <span className='truncate font-medium'>
                            {row.username}
                          </span>
                          <span className='text-muted-foreground text-xs'>
                            ID {row.user_id}
                          </span>
                        </span>
                      ),
                    },
                    {
                      id: 'group',
                      header: t('Group'),
                      cell: (row) => <GroupBadge group={row.group} />,
                    },
                    {
                      id: 'paid',
                      header: t('Paid consumption'),
                      cellClassName: 'tabular-nums',
                      cell: (row) => formatQuota(row.paid_consumed),
                    },
                    {
                      id: 'rebate',
                      header: t('Rebate earned'),
                      cellClassName: 'font-medium tabular-nums',
                      cell: (row) => formatQuota(row.rebate),
                    },
                    {
                      id: 'created',
                      header: t('Registered'),
                      cellClassName: 'text-muted-foreground text-xs',
                      cell: (row) => formatTimestampToDate(row.created_at),
                    },
                  ]}
                />
              </SideDrawerSection>

              <SideDrawerSection>
                <SideDrawerSectionHeader
                  title={t('Claim records')}
                  description={
                    detail.claim_total > detail.claims.length
                      ? t('{{total}} claims; the latest {{shown}} are shown', {
                          total: detail.claim_total,
                          shown: detail.claims.length,
                        })
                      : t('{{count}} claims', { count: detail.claim_total })
                  }
                />
                <StaticDataTable
                  data={detail.claims}
                  getRowKey={(row) => row.id}
                  empty={detail.claims.length === 0}
                  emptyContent={t('No claims yet')}
                  columns={[
                    {
                      id: 'quota',
                      header: t('Amount'),
                      cellClassName: 'font-medium tabular-nums',
                      cell: (row) => formatQuota(row.quota),
                    },
                    {
                      id: 'created',
                      header: t('Time'),
                      cellClassName: 'text-muted-foreground tabular-nums',
                      cell: (row) => formatTimestampToDate(row.created_at),
                    },
                  ]}
                />
              </SideDrawerSection>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
