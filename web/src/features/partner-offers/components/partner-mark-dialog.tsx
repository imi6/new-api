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
import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { deletePartnerSite, markPartnerSite } from '@/features/partner/api'
import {
  PARTNER_STATUSES,
  PARTNER_STATUS_META,
  type PartnerOfferRow,
  type PartnerStatus,
} from '@/features/partner/types'
import { handleServerError } from '@/lib/handle-server-error'

const NOTE_LIMIT = 1000

interface PartnerMarkDialogProps {
  row: PartnerOfferRow | null
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}

/**
 * The administrator's mark and note of a site, and deleting it. A mark
 * covers the whole site, so every group of the site shows it.
 */
export function PartnerMarkDialog(props: PartnerMarkDialogProps) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<PartnerStatus>('pending')
  const [note, setNote] = useState('')
  const [deleting, setDeleting] = useState(false)
  const row = props.row

  useEffect(() => {
    if (!row) return
    setStatus(row.admin_status)
    setNote(row.admin_note)
  }, [row])

  const save = useMutation({
    mutationFn: () => markPartnerSite(row?.site_id ?? 0, status, note.trim()),
    onSuccess: () => {
      toast.success(t('Saved successfully'))
      props.onChanged()
      props.onOpenChange(false)
    },
    onError: (error) => handleServerError(error),
    meta: { errorToast: false },
  })

  const remove = useMutation({
    mutationFn: () => deletePartnerSite(row?.site_id ?? 0),
    onSuccess: () => {
      toast.success(t('Deleted successfully'))
      setDeleting(false)
      props.onChanged()
      props.onOpenChange(false)
    },
    onError: (error) => handleServerError(error),
    meta: { errorToast: false },
  })

  return (
    <>
      <Dialog
        open={row !== null}
        onOpenChange={props.onOpenChange}
        title={row ? row.site_name : ''}
        description={
          row?.submit_ip
            ? t('Submitted from {{ip}}', { ip: row.submit_ip })
            : undefined
        }
        contentClassName='sm:max-w-lg'
        footer={
          <div className='flex w-full flex-wrap items-center justify-between gap-2'>
            <Button
              type='button'
              variant='destructive'
              size='sm'
              onClick={() => setDeleting(true)}
              disabled={remove.isPending}
            >
              <Trash2 aria-hidden='true' />
              {t('Delete submission')}
            </Button>
            <Button
              type='button'
              size='sm'
              onClick={() => save.mutate()}
              disabled={save.isPending}
            >
              {t('Save')}
            </Button>
          </div>
        }
      >
        {row && (
          <div className='flex flex-col gap-4'>
            {row.remark && (
              <div className='flex flex-col gap-1'>
                <span className='text-muted-foreground text-xs'>
                  {t('Remark from the supplier')}
                </span>
                <p className='bg-muted/40 rounded-lg px-3 py-2 text-sm break-all whitespace-pre-wrap'>
                  {row.remark}
                </p>
              </div>
            )}
            <div className='flex flex-col gap-1.5'>
              <Label>{t('Mark')}</Label>
              <Select
                items={PARTNER_STATUSES.map((value) => ({
                  value,
                  label: t(PARTNER_STATUS_META[value].labelKey),
                }))}
                value={status}
                onValueChange={(value) => {
                  if (value) setStatus(value as PartnerStatus)
                }}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {PARTNER_STATUSES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(PARTNER_STATUS_META[value].labelKey)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label>{t('Note')}</Label>
              <Textarea
                rows={4}
                maxLength={NOTE_LIMIT}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t(
                  'Only administrators see this. For example, how the talk went.'
                )}
              />
            </div>
          </div>
        )}
      </Dialog>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('Delete submission')}
        desc={t(
          'The site and all of its groups are deleted. This cannot be undone.'
        )}
        handleConfirm={() => remove.mutate()}
        isLoading={remove.isPending}
        destructive
        confirmText={t('Delete')}
      />
    </>
  )
}
