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
import { useEffect, useState } from 'react'

interface RefreshCountdownProps {
  /** Time of the last fetch, successful or not, in milliseconds. */
  lastFetchedAt: number
  intervalSeconds: number
  fetching: boolean
  onRefresh: () => void
}

/**
 * Seconds until the next automatic refresh. It owns the timer and starts the
 * refresh itself, so a manual refresh restarts the count and only this
 * element re-renders every second.
 */
export function RefreshCountdown(props: RefreshCountdownProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const dueAt = props.lastFetchedAt + props.intervalSeconds * 1000
  const hidden = typeof document !== 'undefined' && document.hidden
  const due = props.lastFetchedAt > 0 && now >= dueAt && !hidden
  const onRefresh = props.onRefresh

  // A hidden tab waits; the next tick after it is shown again refreshes.
  useEffect(() => {
    if (due && !props.fetching) onRefresh()
  }, [due, props.fetching, onRefresh])

  if (props.lastFetchedAt <= 0) return null
  const secondsLeft = Math.max(0, Math.ceil((dueAt - now) / 1000))
  return <>{`${secondsLeft}s`}</>
}
