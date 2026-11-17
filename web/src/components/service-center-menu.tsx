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
import { Link, useRouterState } from '@tanstack/react-router'
import {
  ChevronDown,
  Gift,
  Info,
  LayoutDashboard,
  LifeBuoy,
  Mail,
  Megaphone,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useIsSidebarModuleVisible } from '@/hooks/use-sidebar-config'
import { useStatus } from '@/hooks/use-status'
import { parseHeaderNavModulesFromStatus } from '@/lib/nav-modules'
import { cn } from '@/lib/utils'

type ServiceCenterItem = {
  href:
    | '/dashboard'
    | '/referral'
    | '/system-announcements'
    | '/contact'
    | '/about'
  title: string
  description: string
  icon: LucideIcon
}

interface ServiceCenterMenuProps {
  variant?: 'dropdown' | 'inline'
  onNavigate?: () => void
  className?: string
}

function ServiceCenterItemContent(props: { item: ServiceCenterItem }) {
  const Icon = props.item.icon
  return (
    <>
      <span className='bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-full'>
        <Icon className='size-4' aria-hidden='true' />
      </span>
      <span className='flex min-w-0 flex-1 flex-col gap-1'>
        <span className='text-foreground text-sm font-medium'>
          {props.item.title}
        </span>
        <span className='text-muted-foreground text-xs leading-relaxed'>
          {props.item.description}
        </span>
      </span>
    </>
  )
}

/** 服务中心沿用现有页面和菜单开关，不额外维护一份功能权限。 */
export function ServiceCenterMenu(props: ServiceCenterMenuProps) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const consoleVisible = useIsSidebarModuleVisible('/dashboard')
  const referralVisible = useIsSidebarModuleVisible('/referral')
  const announcementsVisible = useIsSidebarModuleVisible(
    '/system-announcements'
  )
  const modules = parseHeaderNavModulesFromStatus(
    status as Record<string, unknown> | null
  )
  const items: ServiceCenterItem[] = []

  if (modules.console !== false) {
    if (consoleVisible) {
      items.push({
        href: '/dashboard',
        title: t('Console'),
        description: t('Manage API keys, balance and usage'),
        icon: LayoutDashboard,
      })
    }
    if (referralVisible) {
      items.push({
        href: '/referral',
        title: t('Referral rebate'),
        description: t('Invite friends and view referral rewards'),
        icon: Gift,
      })
    }
    if (announcementsVisible) {
      items.push({
        href: '/system-announcements',
        title: t('Announcements'),
        description: t('Latest platform updates and notices'),
        icon: Megaphone,
      })
    }
  }
  items.push({
    href: '/contact',
    title: t('Contact Us'),
    description: t('Get support and find our contact details'),
    icon: Mail,
  })
  if (modules.about !== false) {
    items.push({
      href: '/about',
      title: t('About'),
      description: t('Learn more'),
      icon: Info,
    })
  }

  if (props.variant === 'inline') {
    return (
      <section className={props.className} aria-label={t('Service Center')}>
        <p className='text-muted-foreground mb-2 text-xs font-medium'>
          {t('Service Center')}
        </p>
        <div className='bg-card flex flex-col gap-1 rounded-2xl border p-2'>
          {items.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              onClick={props.onNavigate}
              aria-current={pathname === item.href ? 'page' : undefined}
              className='hover:bg-accent focus-visible:ring-ring flex items-center gap-3 rounded-xl px-3 py-3 outline-none focus-visible:ring-2'
            >
              <ServiceCenterItemContent item={item} />
            </Link>
          ))}
        </div>
      </section>
    )
  }

  const active = items.some(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  )
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            type='button'
            variant='ghost'
            aria-label={t('Service Center')}
            className={cn(
              'group h-8 shrink-0 gap-1 rounded-lg px-2 text-sm font-medium sm:px-3',
              active ? 'text-foreground' : 'text-muted-foreground',
              props.className
            )}
          />
        }
      >
        <LifeBuoy className='size-4 sm:hidden' aria-hidden='true' />
        <span className='hidden sm:inline'>{t('Service Center')}</span>
        <ChevronDown
          className='hidden size-3 transition-transform group-data-popup-open:rotate-180 sm:block'
          aria-hidden='true'
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='end'
        sideOffset={10}
        className='w-[min(22rem,calc(100vw-1rem))] rounded-2xl p-2'
      >
        {items.map((item) => (
          <DropdownMenuItem
            key={item.href}
            className='cursor-pointer gap-3 rounded-xl px-3 py-3'
            render={
              <Link
                to={item.href}
                onClick={props.onNavigate}
                aria-current={pathname === item.href ? 'page' : undefined}
              />
            }
          >
            <ServiceCenterItemContent item={item} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
