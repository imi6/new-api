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
import type { TFunction } from 'i18next'

import type { AffiliateWithdrawalStatus } from '../types'

export function affiliateWithdrawalStatusLabel(
  status: AffiliateWithdrawalStatus,
  t: TFunction
): string {
  switch (status) {
    case 'pending':
      return t('Pending review')
    case 'approved':
      return t('Awaiting payment')
    case 'paying':
      return t('Payment in progress')
    case 'completed':
      return t('Completed')
    case 'rejected':
      return t('Rejected')
    case 'cancelled':
      return t('Cancelled')
    case 'failed':
      return t('Payment failed')
    default:
      return t('Unknown status')
  }
}

export function affiliateLedgerKindLabel(kind: string, t: TFunction): string {
  switch (kind) {
    case 'opening_accrued':
      return t('Opening earned rebate')
    case 'opening_deducted':
      return t('Opening claimed adjustment')
    case 'earned':
      return t('Rebate earned')
    case 'reversal':
      return t('Rebate reversal')
    case 'claim_platform':
      return t('Transfer to platform balance')
    case 'claim_u':
      return t('Convert to withdrawable U')
    case 'admin_grant':
      return t('Administrator transfer')
    case 'admin_revoke':
      return t('Administrative deduction')
    default:
      return t('Account adjustment')
  }
}
