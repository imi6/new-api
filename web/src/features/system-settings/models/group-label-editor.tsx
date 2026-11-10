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
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { GroupLabels } from '@/components/group-labels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  GROUP_LABEL_COLORS,
  GROUP_LABEL_ICONS,
  isGroupLabel,
  MAX_GROUP_LABEL_CATALOG,
  MAX_GROUP_LABELS,
  type GroupLabel,
  type GroupLabelColor,
  type GroupLabelIcon,
} from '@/lib/group-labels'

type GroupLabelEditorProps = {
  group: string
  labels: GroupLabel[]
  selected: string[]
  onClose: () => void
  onApply: (labels: GroupLabel[], selected: string[]) => void
}

export function GroupLabelEditor(props: GroupLabelEditorProps) {
  const { t } = useTranslation()
  const nameId = useId()
  const iconId = useId()
  const colorId = useId()
  const [labels, setLabels] = useState(props.labels)
  const [selected, setSelected] = useState(props.selected)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<GroupLabelIcon>('shield')
  const [color, setColor] = useState<GroupLabelColor>('teal')
  const [nameError, setNameError] = useState(false)
  const labelMap = new Map(labels.map((label) => [label.id, label]))
  const selectedLabels = selected.flatMap((id) => {
    const label = labelMap.get(id)
    return label ? [label] : []
  })
  const full = selected.length >= MAX_GROUP_LABELS
  const presets: GroupLabel[] = [
    { id: 'self', name: t('Self-run'), icon: 'shield', color: 'teal' },
    {
      id: 'authentic',
      name: t('Authentic'),
      icon: 'badge-check',
      color: 'amber',
    },
    { id: 'guarantee', name: t('Guarantee'), icon: 'award', color: 'violet' },
  ]
  const iconOptions = [
    { value: 'none', label: t('None') },
    { value: 'shield', label: t('Shield') },
    { value: 'badge-check', label: t('Certification') },
    { value: 'award', label: t('Award') },
    { value: 'sparkles', label: t('Sparkles') },
    { value: 'star', label: t('Star') },
    { value: 'zap', label: t('Lightning') },
    { value: 'heart', label: t('Heart') },
  ]
  const colorOptions = [
    { value: 'teal', label: t('Teal') },
    { value: 'amber', label: t('Amber') },
    { value: 'violet', label: t('Violet') },
    { value: 'blue', label: t('Blue') },
    { value: 'green', label: t('Green') },
    { value: 'red', label: t('Red') },
    { value: 'slate', label: t('Slate') },
  ]

  const choose = (label: GroupLabel) => {
    if (selected.includes(label.id)) {
      setSelected(selected.filter((id) => id !== label.id))
      return
    }
    if (
      full ||
      (!labelMap.has(label.id) && labels.length >= MAX_GROUP_LABEL_CATALOG)
    ) {
      return
    }
    if (!labelMap.has(label.id)) setLabels([...labels, label])
    setSelected([...selected, label.id])
  }

  const create = () => {
    const trimmed = name.trim()
    const label: GroupLabel = {
      id: `custom_${nanoid()}`,
      name: trimmed,
      icon,
      color,
    }
    if (!isGroupLabel(label)) {
      setNameError(true)
      return
    }
    if (full || labels.length >= MAX_GROUP_LABEL_CATALOG) return
    choose(label)
    setName('')
    setNameError(false)
  }

  const move = (index: number, direction: number) => {
    const next = [...selected]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setSelected(next)
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t('Group labels')}
      description={props.group}
      contentClassName='sm:max-w-xl'
      bodyClassName='space-y-5'
      footer={
        <>
          <Button type='button' variant='outline' onClick={props.onClose}>
            {t('Cancel')}
          </Button>
          <Button type='button' onClick={() => props.onApply(labels, selected)}>
            {t('Apply labels')}
          </Button>
        </>
      }
    >
      <div className='bg-muted/30 flex min-h-10 flex-wrap items-center gap-2 rounded-lg border p-3'>
        <GroupLabels labels={selectedLabels} />
        <span className='min-w-0 text-sm break-all'>{props.group}</span>
      </div>
      <div className='space-y-2'>
        <p className='text-sm font-medium'>{t('Quick labels')}</p>
        <div className='flex flex-wrap gap-2'>
          {presets.map((preset) => {
            const label = labelMap.get(preset.id) ?? preset
            const checked = selected.includes(label.id)
            return (
              <Button
                key={label.id}
                type='button'
                variant={checked ? 'secondary' : 'outline'}
                size='sm'
                aria-label={label.name}
                aria-pressed={checked}
                disabled={
                  !checked &&
                  (full ||
                    (!labelMap.has(label.id) &&
                      labels.length >= MAX_GROUP_LABEL_CATALOG))
                }
                onClick={() => choose(label)}
              >
                <GroupLabels labels={[label]} />
              </Button>
            )
          })}
        </div>
      </div>
      {labels.some(
        (label) => !presets.some((preset) => preset.id === label.id)
      ) && (
        <div className='space-y-2'>
          <p className='text-sm font-medium'>{t('Available labels')}</p>
          <div className='flex flex-wrap gap-2'>
            {labels
              .filter(
                (label) => !presets.some((preset) => preset.id === label.id)
              )
              .map((label) => (
                <Button
                  key={label.id}
                  type='button'
                  variant={
                    selected.includes(label.id) ? 'secondary' : 'outline'
                  }
                  size='sm'
                  aria-label={label.name}
                  aria-pressed={selected.includes(label.id)}
                  disabled={full && !selected.includes(label.id)}
                  onClick={() => choose(label)}
                >
                  <GroupLabels labels={[label]} />
                </Button>
              ))}
          </div>
        </div>
      )}
      <div className='space-y-2'>
        <p className='text-sm font-medium'>{t('Selected labels')}</p>
        {selected.length ? (
          <ol aria-label={t('Selected labels')} className='space-y-1'>
            {selectedLabels.map((label, index) => (
              <li
                key={label.id}
                className='flex items-center justify-between gap-2 rounded-md border p-1.5'
              >
                <GroupLabels labels={[label]} />
                <div className='flex gap-1'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-sm'
                    disabled={index === 0}
                    aria-label={t('Move {{group}} up', { group: label.name })}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp aria-hidden='true' />
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-sm'
                    disabled={index === selected.length - 1}
                    aria-label={t('Move {{group}} down', { group: label.name })}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown aria-hidden='true' />
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-sm'
                    aria-label={t('Remove {{group}}', { group: label.name })}
                    onClick={() => choose(label)}
                  >
                    <X aria-hidden='true' />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className='text-muted-foreground text-sm'>
            {t('No labels selected')}
          </p>
        )}
      </div>
      <div className='space-y-3 border-t pt-4'>
        <div className='space-y-1.5'>
          <Label htmlFor={nameId}>{t('Label name')}</Label>
          <Input
            id={nameId}
            value={name}
            aria-invalid={nameError}
            aria-describedby={nameError ? `${nameId}-error` : undefined}
            onChange={(event) => {
              setName(event.target.value)
              setNameError(false)
            }}
          />
          {nameError && (
            <p id={`${nameId}-error`} className='text-destructive text-sm'>
              {t('Enter a label name of 1–12 characters')}
            </p>
          )}
        </div>
        <div className='grid grid-cols-2 gap-3'>
          <div className='space-y-1.5'>
            <Label htmlFor={iconId}>{t('Label icon')}</Label>
            <Select
              value={icon}
              items={iconOptions}
              onValueChange={(value) => {
                if (GROUP_LABEL_ICONS.includes(value as GroupLabelIcon)) {
                  setIcon(value as GroupLabelIcon)
                }
              }}
            >
              <SelectTrigger id={iconId} className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {iconOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor={colorId}>{t('Label color')}</Label>
            <Select
              value={color}
              items={colorOptions}
              onValueChange={(value) => {
                if (GROUP_LABEL_COLORS.includes(value as GroupLabelColor)) {
                  setColor(value as GroupLabelColor)
                }
              }}
            >
              <SelectTrigger id={colorId} className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {colorOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={full || labels.length >= MAX_GROUP_LABEL_CATALOG}
          onClick={create}
        >
          {t('Create label')}
        </Button>
      </div>
    </Dialog>
  )
}
