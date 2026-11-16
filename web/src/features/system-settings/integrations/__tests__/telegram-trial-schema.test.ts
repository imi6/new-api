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
import { describe, expect, test } from 'vitest'

import { createTelegramTrialSchema } from '../telegram-trial-schema'

const t = ((key: string) => key) as TFunction
const schema = createTelegramTrialSchema(t)
const config = {
  enabled: true,
  quota: 500000,
  daily_limit: 1000000,
  total_limit: 5000000,
  require_membership: false,
  chat_id: '',
  join_url: '',
  version: 1,
}

describe('Telegram 试用设置', () => {
  test('启用时额度和预算必须为安全正整数，预算至少覆盖一次领取', () => {
    expect(schema.safeParse(config).success).toBe(true)
    for (const quota of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(schema.safeParse({ ...config, quota }).success).toBe(false)
    }
    for (const field of ['daily_limit', 'total_limit']) {
      expect(
        schema.safeParse({ ...config, [field]: config.quota - 1 }).success
      ).toBe(false)
    }
    expect(
      schema.safeParse({
        ...config,
        enabled: false,
        quota: 0,
        daily_limit: 0,
        total_limit: 0,
      }).success
    ).toBe(true)
  })

  test('入群门槛关闭时无需目标，开启时接受群用户名及 int64 范围内的规范负数', () => {
    const required = {
      ...config,
      require_membership: true,
      join_url: 'https://t.me/example',
    }
    for (const chat_id of [
      '@example',
      '-123456',
      '-1001234567890',
      '-9223372036854775808',
    ]) {
      expect(schema.safeParse({ ...required, chat_id }).success).toBe(true)
    }
    for (const chat_id of [
      '',
      '@abcd',
      '123456',
      '-0',
      '-0123',
      '-9223372036854775809',
      '-12345678901234567890',
    ]) {
      expect(schema.safeParse({ ...required, chat_id }).success).toBe(false)
    }
  })

  test('加入链接只接受无凭据、查询参数、片段及显式端口的 Telegram HTTPS 链接', () => {
    const required = {
      ...config,
      require_membership: true,
      chat_id: '-123456',
    }
    expect(
      schema.safeParse({ ...required, join_url: 'https://t.me/+invite' })
        .success
    ).toBe(true)
    for (const join_url of [
      'http://t.me/example',
      'https://example.com/example',
      'https://t.me/',
      'https://user@t.me/example',
      'https://t.me:443/example',
      'https://t.me:8443/example',
      'https://t.me/example?start=trial',
      'https://t.me/example#trial',
      `https://t.me/${'a'.repeat(245)}`,
    ]) {
      expect(schema.safeParse({ ...required, join_url }).success).toBe(false)
    }
  })

  test('提交设置剔除发放统计等服务端只读字段', () => {
    expect(
      schema.parse({ ...config, total_granted: 5, today_granted: 2 })
    ).toEqual(config)
  })
})
