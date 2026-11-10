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
import { ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { DataTableColumnHeader } from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { ChannelTypeLogo } from '@/features/channels/components/channel-type-badge'
import { apiKeyPlatformLabel } from '@/features/keys/lib/api-key-group-platforms'
import { isHttpUrl } from '@/lib/content-format'
import { formatTimestampToDate } from '@/lib/format'

import {
  PARTNER_CONTACT_LABEL_KEYS,
  PARTNER_STATUS_META,
  type PartnerOfferRow,
} from '@/features/partner/types'

/**
 * Columns of the supplier quote table. Everything a supplier typed is shown
 * as plain text; a site address becomes a link only when it is http(s).
 */
export function usePartnerOfferColumns(
  onMark: (row: PartnerOfferRow) => void,
  onDelete: (row: PartnerOfferRow) => void
): ColumnDef<PartnerOfferRow>[] {
  const { t } = useTranslation()
  return [
    {
      id: 'channel_type',
      accessorKey: 'channel_type',
      header: t('Platform'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className='flex items-center gap-1.5'>
          <ChannelTypeLogo type={row.original.channel_type} size={16} />
          <span className='truncate text-sm'>
            {apiKeyPlatformLabel(String(row.original.channel_type), t)}
          </span>
        </span>
      ),
      size: 150,
    },
    {
      id: 'group_name',
      accessorKey: 'group_name',
      header: t('Group name'),
      enableSorting: false,
      meta: { mobileTitle: true },
      cell: ({ row }) => (
        <span className='font-medium break-all'>{row.original.group_name}</span>
      ),
      size: 180,
    },
    {
      id: 'ratio',
      accessorKey: 'ratio',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Ratio')} />
      ),
      cell: ({ row }) => (
        <span className='text-warning font-semibold tabular-nums'>
          {row.original.ratio}x
        </span>
      ),
      size: 100,
    },
    {
      id: 'models',
      accessorKey: 'models',
      header: t('Main models'),
      enableSorting: false,
      meta: { mobileHidden: true },
      cell: ({ row }) =>
        row.original.models ? (
          <span
            className='text-muted-foreground line-clamp-2 font-mono text-xs break-all'
            title={row.original.models}
          >
            {row.original.models.split(',').join(', ')}
          </span>
        ) : (
          <span className='text-muted-foreground'>—</span>
        ),
      size: 220,
    },
    {
      id: 'description',
      accessorKey: 'description',
      header: t('Description'),
      enableSorting: false,
      meta: { mobileHidden: true },
      cell: ({ row }) =>
        row.original.description ? (
          <span
            className='line-clamp-2 text-xs break-all'
            title={row.original.description}
          >
            {row.original.description}
          </span>
        ) : (
          <span className='text-muted-foreground'>—</span>
        ),
      size: 220,
    },
    {
      id: 'site',
      header: t('Site'),
      enableSorting: false,
      cell: ({ row }) => {
        const site = row.original
        const safeUrl = site.site_url && isHttpUrl(site.site_url)
        return (
          <span className='flex min-w-0 flex-col'>
            <span className='truncate font-medium'>{site.site_name}</span>
            {site.site_url &&
              (safeUrl ? (
                <a
                  href={site.site_url}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-primary inline-flex min-w-0 items-center gap-1 text-xs hover:underline'
                  title={site.site_url}
                >
                  <span className='truncate'>{site.site_url}</span>
                  <ExternalLink className='size-3 shrink-0' aria-hidden='true' />
                </a>
              ) : (
                <span className='text-muted-foreground truncate text-xs'>
                  {site.site_url}
                </span>
              ))}
          </span>
        )
      },
      size: 200,
    },
    {
      id: 'contact',
      header: t('Contact'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className='flex min-w-0 items-center gap-1'>
          <span className='flex min-w-0 flex-col'>
            <span className='text-muted-foreground text-xs'>
              {t(PARTNER_CONTACT_LABEL_KEYS[row.original.contact_type])}
            </span>
            <span className='truncate text-sm'>{row.original.contact}</span>
          </span>
          <CopyButton
            value={row.original.contact}
            size='icon'
            variant='ghost'
            aria-label={t('Copy')}
          />
        </span>
      ),
      size: 180,
    },
    {
      id: 'submitter',
      header: t('Submitter'),
      enableSorting: false,
      meta: { mobileHidden: true },
      cell: ({ row }) => (
        <span className='flex flex-col text-xs'>
          <span>
            {row.original.user_id > 0
              ? (row.original.username ?? `ID ${row.original.user_id}`)
              : t('Visitor')}
          </span>
          <span className='text-muted-foreground tabular-nums'>
            {formatTimestampToDate(row.original.created_at)}
          </span>
        </span>
      ),
      size: 160,
    },
    {
      id: 'admin_status',
      accessorKey: 'admin_status',
      header: t('Mark'),
      enableSorting: false,
      meta: { mobileBadge: true },
      cell: ({ row }) => {
        const meta = PARTNER_STATUS_META[row.original.admin_status]
        return (
          <StatusBadge
            label={t(meta.labelKey)}
            variant={meta.variant}
            copyable={false}
            className='-ml-1.5'
          />
        )
      },
      size: 110,
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => (
        <span className='flex items-center justify-end gap-1'>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onMark(row.original)}
          >
            {t('Mark')}
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='text-destructive hover:text-destructive'
            onClick={() => onDelete(row.original)}
          >
            {t('Delete')}
          </Button>
        </span>
      ),
      // The table is wider than most screens, so the actions stay in view.
      // Delete removes this row only; the mark covers the whole site.
      meta: { pinned: 'right' as const },
      size: 170,
    },
  ]
}
