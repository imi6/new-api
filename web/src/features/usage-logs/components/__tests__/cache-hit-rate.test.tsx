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
import { act, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { useSystemConfigStore } from '@/stores/system-config-store'

import {
  getLogCacheHitRate,
  getLogCacheWriteTokens,
} from '../../lib/cache-hit-rate'
import type { LogOtherData } from '../../types'
import { CacheHitRate } from '../cache-hit-rate'

describe('日志缓存命中率口径', () => {
  test.each<{
    name: string
    prompt: number
    other: LogOtherData
    expected: number
  }>([
    {
      name: 'OpenAI 输入已含缓存，不重复累加缓存读取',
      prompt: 120993,
      other: { cache_tokens: 115072, cache_ratio: 0.1 },
      expected: 115072 / 120993,
    },
    {
      name: 'Claude 普通输入加缓存读写组成总输入',
      prompt: 2,
      other: {
        usage_semantic: 'anthropic',
        cache_tokens: 246500,
        cache_creation_tokens: 3900,
        cache_creation_tokens_5m: 3900,
      },
      expected: 246500 / 250402,
    },
    {
      name: '旧 Claude 标记兼容分项缓存写入',
      prompt: 50,
      other: {
        claude: true,
        cache_tokens: 800,
        cache_creation_tokens_5m: 100,
        cache_creation_tokens_1h: 50,
      },
      expected: 0.8,
    },
    {
      name: '可靠总输入优先于旧 Claude 字段',
      prompt: 50,
      other: {
        input_tokens_total: 1000,
        claude: true,
        cache_tokens: 800,
        cache_creation_tokens_5m: 300,
      },
      expected: 0.8,
    },
    {
      name: '纯缓存输入仍有有效百分比',
      prompt: 0,
      other: { claude: true, cache_tokens: 800 },
      expected: 1,
    },
    {
      name: '明确零缓存命中显示零',
      prompt: 100,
      other: { cache_tokens: 0 },
      expected: 0,
    },
    {
      name: '写入预热请求不沿用分组统计的排除规则',
      prompt: 0,
      other: { claude: true, cache_tokens: 0, cache_write_tokens: 100 },
      expected: 0,
    },
    {
      name: 'OpenAI 缓存读取与写入可能重叠',
      prompt: 3619,
      other: { cache_tokens: 2921, cache_creation_tokens: 3616 },
      expected: 2921 / 3619,
    },
    {
      name: 'Claude 规范写入总数优先于旧分项',
      prompt: 50,
      other: {
        claude: true,
        cache_tokens: 800,
        cache_write_tokens: 150,
        cache_creation_tokens: 200,
        cache_creation_tokens_5m: 300,
      },
      expected: 0.8,
    },
  ])('$name', ({ prompt, other, expected }) => {
    expect(getLogCacheHitRate(prompt, other)).toBeCloseTo(expected, 10)
  })

  test.each<{
    name: string
    prompt: number
    other: LogOtherData | null
  }>([
    { name: '缺少缓存信息', prompt: 100, other: null },
    { name: '缺少读取数', prompt: 100, other: { cache_ratio: 0.1 } },
    { name: '总输入为零', prompt: 0, other: { cache_tokens: 0 } },
    { name: '输入非法', prompt: Number.NaN, other: { cache_tokens: 10 } },
    { name: '读取为负', prompt: 100, other: { cache_tokens: -1 } },
    { name: '读取非有限数', prompt: 100, other: { cache_tokens: Infinity } },
    { name: '读取大于总输入', prompt: 100, other: { cache_tokens: 200 } },
    {
      name: '已记录的总输入非法时不猜测',
      prompt: 100,
      other: { cache_tokens: 10, input_tokens_total: 0 },
    },
    {
      name: 'Claude 写入数据异常时不当成零',
      prompt: 100,
      other: { claude: true, cache_tokens: 10, cache_write_tokens: -5 },
    },
    {
      name: '没有语义标记的旧分项日志无法可靠区分输入口径',
      prompt: 1000,
      other: { cache_tokens: 500, cache_creation_tokens_5m: 100 },
    },
  ])('$name时隐藏百分比', ({ prompt, other }) => {
    expect(getLogCacheHitRate(prompt, other)).toBeNull()
  })

  test.each([
    { other: { cache_write_tokens: 0, cache_creation_tokens: 100 }, total: 0 },
    {
      other: {
        cache_creation_tokens: 100,
        cache_creation_tokens_5m: 10,
        cache_creation_tokens_1h: 20,
      },
      total: 100,
    },
    {
      other: {
        cache_creation_tokens: 20,
        cache_creation_tokens_5m: 10,
        cache_creation_tokens_1h: 20,
      },
      total: 30,
    },
    {
      other: { cache_creation_tokens: 100, cache_creation_tokens_12h: 80 },
      total: 100,
    },
  ])('写入总数不重复累加 TTL 分项：$total', ({ other, total }) => {
    expect(getLogCacheWriteTokens(other)).toBe(total)
  })
})

describe('缓存命中率标签', () => {
  beforeEach(() => {
    useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  })

  afterEach(() => {
    useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  })

  test('后台关闭时隐藏标签，重新开启后立即显示', () => {
    const view = render(
      <CacheHitRate promptTokens={1000} other={{ cache_tokens: 985 }} />
    )
    expect(screen.getByText('98.5%')).toBeVisible()

    act(() => {
      useSystemConfigStore
        .getState()
        .setConfig({ logCacheHitRateEnabled: false })
    })
    expect(view.container).toBeEmptyDOMElement()

    act(() => {
      useSystemConfigStore
        .getState()
        .setConfig({ logCacheHitRateEnabled: true })
    })
    expect(screen.getByText('98.5%')).toBeVisible()
  })

  test('显示浅橙色百分比标签，且无进度条和点击交互', () => {
    render(<CacheHitRate promptTokens={1000} other={{ cache_tokens: 985 }} />)
    expect(screen.getByText('Cache hit rate')).toBeVisible()
    const value = screen.getByText('98.5%')
    expect(value).toBeVisible()
    expect(value.closest('[data-slot="status-badge"]')).toHaveClass(
      'border-orange-200',
      'bg-orange-50',
      'text-orange-700'
    )
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  test('无命中显示 0.0%，缺失数据则不占位', () => {
    const view = render(
      <CacheHitRate promptTokens={100} other={{ cache_tokens: 0 }} />
    )
    expect(screen.getByText('0.0%')).toBeVisible()
    view.rerender(<CacheHitRate promptTokens={100} />)
    expect(view.container).toBeEmptyDOMElement()
  })

  test.each([
    { language: 'zhCN', expected: '95.1%' },
    { language: 'zhTW', expected: '95.1%' },
    { language: 'en', expected: '95.1%' },
    { language: 'ja', expected: '95.1%' },
    { language: 'fr', expected: '95,1\u00a0%' },
    { language: 'ru', expected: '95,1\u00a0%' },
    { language: 'vi', expected: '95,1%' },
    { language: 'invalid_locale', expected: '95.1%' },
  ])(
    '$language 使用合法的区域设置或安全降级',
    async ({ language, expected }) => {
      const i18n = createInstance()
      await i18n.use(initReactI18next).init({
        lng: language,
        fallbackLng: false,
        resources: {
          [language]: { translation: { 'Cache hit rate': 'Cache hit rate' } },
        },
      })
      render(
        <I18nextProvider i18n={i18n}>
          <CacheHitRate promptTokens={1000} other={{ cache_tokens: 951 }} />
        </I18nextProvider>
      )
      expect(screen.getByText(/^95/).textContent).toBe(expected)
    }
  )

  test('切换语言后文字和百分比格式同时更新', async () => {
    const i18n = createInstance()
    await i18n.use(initReactI18next).init({
      lng: 'zhCN',
      fallbackLng: 'en',
      resources: {
        zhCN: { translation: { 'Cache hit rate': '缓存命中率' } },
        fr: { translation: { 'Cache hit rate': 'Taux de cache' } },
      },
    })
    render(
      <I18nextProvider i18n={i18n}>
        <CacheHitRate promptTokens={1000} other={{ cache_tokens: 951 }} />
      </I18nextProvider>
    )
    expect(screen.getByText('缓存命中率')).toBeVisible()
    expect(screen.getByText('95.1%')).toBeVisible()

    await act(() => i18n.changeLanguage('fr'))
    expect(screen.getByText('Taux de cache')).toBeVisible()
    expect(screen.getByText(/^95/).textContent).toBe('95,1\u00a0%')
  })
})
