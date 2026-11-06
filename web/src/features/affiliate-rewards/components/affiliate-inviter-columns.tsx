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
import type { ColumnDef } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'

import { DataTableColumnHeader } from '@/components/data-table'
import { GroupBadge } from '@/components/group-badge'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { formatQuota, formatTimestampToDate } from '@/lib/format'

import type { AffiliateInviter } from '../types'

/**
 * Ranking columns. The sortable ones use the server's sort keys as ids;
 * the rank counts from the first row of the page.
 */
export function useAffiliateInviterColumns(
  firstRank: number,
  onOpen: (inviter: AffiliateInviter) => void
): ColumnDef<AffiliateInviter>[] {
  const { t } = useTranslation()
  return [
    {
      id: 'rank',
      header: t('Rank'),
      enableSorting: false,
      meta: { mobileHidden: true },
      cell: ({ row }) => (
        <span className='text-muted-foreground tabular-nums'>
          {firstRank + row.index}
        </span>
      ),
      size: 64,
    },
    {
      id: 'user',
      header: t('User'),
      enableSorting: false,
      meta: { mobileTitle: true },
      cell: ({ row }) => {
        const inviter = row.original
        return (
          <div className='flex min-w-0 flex-col'>
            <span className='flex min-w-0 items-center gap-1.5'>
              <span className='truncate font-medium'>{inviter.username}</span>
              {inviter.special_ratio && (
                <StatusBadge
                  label={t('Special ratio')}
                  variant='warning'
                  size='sm'
                  copyable={false}
                />
              )}
            </span>
            <span className='text-muted-foreground truncate text-xs'>
              {inviter.display_name
                ? `${inviter.display_name} · ID ${inviter.user_id}`
                : `ID ${inviter.user_id}`}
            </span>
          </div>
        )
      },
      size: 220,
    },
    {
      id: 'group',
      header: t('Group'),
      enableSorting: false,
      cell: ({ row }) => <GroupBadge group={row.original.group} />,
      size: 140,
    },
    {
      id: 'invitees',
      accessorKey: 'invitee_count',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Invited users')} />
      ),
      cell: ({ row }) => (
        <span className='tabular-nums'>{row.original.invitee_count}</span>
      ),
      size: 120,
    },
    {
      id: 'signup',
      accessorKey: 'signup_reward',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Signup reward')} />
      ),
      cell: ({ row }) => formatQuota(row.original.signup_reward),
      size: 130,
    },
    {
      id: 'paid',
      accessorKey: 'invitee_paid',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('Invitee paid consumption')}
        />
      ),
      cell: ({ row }) => formatQuota(row.original.invitee_paid),
      size: 150,
    },
    {
      id: 'accrued',
      accessorKey: 'accrued',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Rebate earned')} />
      ),
      cell: ({ row }) => (
        <span className='font-medium'>
          {formatQuota(row.original.accrued)}
        </span>
      ),
      size: 130,
    },
    {
      id: 'claimed',
      accessorKey: 'claimed',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Claimed')} />
      ),
      cell: ({ row }) => formatQuota(row.original.claimed),
      size: 120,
    },
    {
      id: 'unclaimed',
      accessorKey: 'unclaimed',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Not claimed')} />
      ),
      cell: ({ row }) => formatQuota(row.original.unclaimed),
      size: 120,
    },
    {
      id: 'last_claim_at',
      header: t('Last claim'),
      enableSorting: false,
      meta: { mobileHidden: true },
      cell: ({ row }) =>
        row.original.last_claim_at > 0 ? (
          <span className='text-muted-foreground text-xs tabular-nums'>
            {formatTimestampToDate(row.original.last_claim_at)}
          </span>
        ) : (
          <span className='text-muted-foreground'>—</span>
        ),
      size: 160,
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => (
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={() => onOpen(row.original)}
        >
          {t('Details')}
        </Button>
      ),
      size: 80,
    },
  ]
}
