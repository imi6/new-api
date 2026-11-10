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
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { deletePartnerOffer } from '@/features/partner/api'
import type { PartnerOfferRow } from '@/features/partner/types'
import { handleServerError } from '@/lib/handle-server-error'

interface PartnerDeleteDialogProps {
  /** The quote to delete; null keeps the dialog closed. */
  row: PartnerOfferRow | null
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
}

/**
 * Confirms and deletes one row of the quote table, which is one group of a
 * site. The other groups of the site stay.
 */
export function PartnerDeleteDialog(props: PartnerDeleteDialogProps) {
  const { t } = useTranslation()
  const row = props.row

  const remove = useMutation({
    mutationFn: (offerId: number) => deletePartnerOffer(offerId),
    onSuccess: () => {
      toast.success(t('Deleted successfully'))
      props.onOpenChange(false)
      props.onDeleted()
    },
    onError: (error) => handleServerError(error),
    meta: { errorToast: false },
  })

  return (
    <ConfirmDialog
      open={row !== null}
      onOpenChange={props.onOpenChange}
      title={t('Delete quote')}
      desc={
        <div className='flex flex-col gap-1'>
          {row && (
            <span className='text-foreground font-medium break-all'>
              {row.group_name} · {row.site_name}
            </span>
          )}
          <span>
            {t(
              'Only this group is deleted. The other groups of the site stay. This cannot be undone.'
            )}
          </span>
        </div>
      }
      handleConfirm={() => {
        if (row) remove.mutate(row.offer_id)
      }}
      isLoading={remove.isPending}
      destructive
      confirmText={t('Delete')}
    />
  )
}
