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
import { createFileRoute, redirect } from '@tanstack/react-router'

import { PartnerApply } from '@/features/partner'
import { getModuleAccessForGuard } from '@/lib/nav-modules'

// The console page follows the same "supplier application" switch as the
// public one; a signed-in user always passes its login requirement.
export const Route = createFileRoute('/_authenticated/partner-apply/')({
  beforeLoad: async ({ context }) => {
    const access = await getModuleAccessForGuard(
      context.queryClient,
      'partner'
    )
    if (!access.enabled) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: PartnerApply,
})
