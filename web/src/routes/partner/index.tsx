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

import { PartnerPublic } from '@/features/partner'
import { getModuleAccessForGuard } from '@/lib/nav-modules'
import { useAuthStore } from '@/stores/auth-store'

// The public page follows the "supplier application" top navigation switch:
// closed sends visitors home, and a required sign-in sends them to sign in.
export const Route = createFileRoute('/partner/')({
  beforeLoad: async ({ context, location }) => {
    const access = await getModuleAccessForGuard(
      context.queryClient,
      'partner'
    )
    if (!access.enabled) {
      throw redirect({ to: '/' })
    }
    if (access.requireAuth) {
      const { auth } = useAuthStore.getState()
      if (!auth.user) {
        throw redirect({
          to: '/sign-in',
          search: { redirect: location.href },
        })
      }
    }
  },
  component: PartnerPublic,
})
