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
import type { LogOtherData } from '../types'

/** 优先使用规范化写入总数；有效期分项与旧总数不能重复累加。 */
export function getLogCacheWriteTokens(
  other: LogOtherData | null | undefined
): number {
  const normalized = other?.cache_write_tokens
  if (
    typeof normalized === 'number' &&
    Number.isFinite(normalized) &&
    normalized >= 0
  ) {
    return normalized
  }

  const total = other?.cache_creation_tokens ?? 0
  const shortLived = other?.cache_creation_tokens_5m ?? 0
  const longLived = other?.cache_creation_tokens_1h ?? 0
  const values = [total, shortLived, longLived]
  if (
    values.some(
      (value) =>
        typeof value !== 'number' || !Number.isFinite(value) || value < 0
    )
  ) {
    return 0
  }

  // 12 小时写入已经包含在总数内，不再额外相加。
  const tokens = Math.max(total, shortLived + longLived)
  return Number.isFinite(tokens) ? tokens : 0
}

/** 返回缓存读取占总输入的比例（0～1）；数据不全或口径不明时隐藏。 */
export function getLogCacheHitRate(
  promptTokens: number,
  other: LogOtherData | null | undefined
): number | null {
  const cacheRead = other?.cache_tokens
  if (
    typeof cacheRead !== 'number' ||
    !Number.isFinite(cacheRead) ||
    cacheRead < 0
  ) {
    return null
  }

  let inputTokens = other?.input_tokens_total
  if (inputTokens === undefined) {
    if (
      typeof promptTokens !== 'number' ||
      !Number.isFinite(promptTokens) ||
      promptTokens < 0
    ) {
      return null
    }

    const anthropic =
      other?.usage_semantic === 'anthropic' || other?.claude === true
    if (anthropic) {
      const writeFields =
        other?.cache_write_tokens !== undefined
          ? [other.cache_write_tokens]
          : [
              other?.cache_creation_tokens ?? 0,
              other?.cache_creation_tokens_5m ?? 0,
              other?.cache_creation_tokens_1h ?? 0,
            ]
      if (
        writeFields.some(
          (value) =>
            typeof value !== 'number' || !Number.isFinite(value) || value < 0
        )
      ) {
        return null
      }
      // Claude 普通输入不含缓存读取与写入。
      inputTokens = promptTokens + cacheRead + getLogCacheWriteTokens(other)
    } else {
      // 旧 Claude 转 OpenAI 的分项日志缺少语义标记，无法确定输入是否包含缓存。
      if (
        (other?.cache_creation_tokens_5m ?? 0) > 0 ||
        (other?.cache_creation_tokens_1h ?? 0) > 0
      ) {
        return null
      }
      inputTokens = promptTokens
    }
  }

  if (
    typeof inputTokens !== 'number' ||
    !Number.isFinite(inputTokens) ||
    inputTokens <= 0 ||
    cacheRead > inputTokens
  ) {
    return null
  }

  return cacheRead / inputTokens
}
