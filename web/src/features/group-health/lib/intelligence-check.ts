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
import type { IntelligenceCheck } from '../types'

/** Locale keys of the drawing checks stored in failed_checks. */
export const DRAWING_CHECK_LABEL_KEYS: Record<string, string> = {
  incomplete: 'Page is incomplete',
  no_svg: 'No SVG',
  no_animation: 'No animation',
  external_resource: 'Loads external resources',
  extra_text: 'Extra text or code fences',
}

export type IntelligenceVerdict =
  | 'running'
  | 'passed'
  | 'failed'
  | 'undetermined'
  | 'error'
  | 'interrupted'

export function intelligenceVerdict(
  check: IntelligenceCheck
): IntelligenceVerdict {
  if (check.interrupted) return 'interrupted'
  return check.status
}

export const INTELLIGENCE_VERDICT_LABEL_KEYS: Record<
  IntelligenceVerdict,
  string
> = {
  running: 'Checking',
  passed: 'Correct',
  failed: 'Wrong',
  undetermined: 'Undetermined',
  error: 'Request failed',
  interrupted: 'Interrupted',
}

/** Strip a code fence a model wrapped its page in, so it still renders. */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const fenced = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```\s*$/.exec(trimmed)
  if (fenced) return fenced[1]
  const start = trimmed.search(/<!doctype html|<html/i)
  const end = trimmed.toLowerCase().lastIndexOf('</html>')
  if (start >= 0 && end > start) return trimmed.slice(start, end + 7)
  return trimmed
}

/**
 * A page a model wrote, made safe to show: a content security policy at the
 * top forbids any network request, so the page cannot send data anywhere or
 * load outside code. It runs in a sandboxed frame with no access to this site.
 */
export function safeDrawingDocument(text: string): string {
  const csp =
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:\">"
  const page = stripCodeFence(text)
  // After <head>, or else after <html> or the doctype: anything before the
  // doctype would put the page in quirks mode.
  const anchor =
    /<head[^>]*>/i.exec(page) ??
    /<html[^>]*>/i.exec(page) ??
    /<!doctype[^>]*>/i.exec(page)
  if (anchor) {
    const at = anchor.index + anchor[0].length
    return page.slice(0, at) + csp + page.slice(at)
  }
  return csp + page
}

/** Passed checks among the finished ones. */
export function intelligencePassCount(checks: IntelligenceCheck[]) {
  const finished = checks.filter((check) => check.status !== 'running')
  return {
    passed: finished.filter((check) => check.status === 'passed').length,
    total: finished.length,
  }
}
