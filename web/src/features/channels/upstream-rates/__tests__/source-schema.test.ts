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
import { expect, test } from 'vitest'

import { upstreamRateSourceSchema } from '../lib/source-schema'

const source = {
  id: '',
  name: '倍率来源',
  base_url: 'https://rates.example.com',
  token: 'test-only-token-01234567890123456789',
  enabled: true,
  poll_seconds: 60,
  scan_minutes: 30,
}

test('来源地址只接受 HTTPS 标准端口，拒绝 URL 凭据和查询参数', () => {
  expect(upstreamRateSourceSchema.safeParse(source).success).toBe(true)
  for (const base_url of [
    'not-a-url',
    'http://rates.example.com',
    'https://rates.example.com:8443',
    'https://user:secret@rates.example.com',
    'https://rates.example.com?token=secret',
    'https://rates.example.com#secret',
  ]) {
    expect(
      upstreamRateSourceSchema.safeParse({ ...source, base_url }).success
    ).toBe(false)
  }
})

test('新来源需要令牌，已保存来源可以留空且不接受带空白令牌', () => {
  expect(
    upstreamRateSourceSchema.safeParse({ ...source, token: '' }).success
  ).toBe(false)
  expect(
    upstreamRateSourceSchema.safeParse({ ...source, id: 'saved', token: '' })
      .success
  ).toBe(true)
  expect(
    upstreamRateSourceSchema.safeParse({ ...source, token: `${source.token} ` })
      .success
  ).toBe(false)
})

test('轮询和上游扫描周期必须是允许范围内的整数', () => {
  expect(
    upstreamRateSourceSchema.safeParse({ ...source, poll_seconds: 29 }).success
  ).toBe(false)
  expect(
    upstreamRateSourceSchema.safeParse({ ...source, scan_minutes: 0 }).success
  ).toBe(false)
  expect(
    upstreamRateSourceSchema.safeParse({ ...source, scan_minutes: 1.5 }).success
  ).toBe(false)
})
