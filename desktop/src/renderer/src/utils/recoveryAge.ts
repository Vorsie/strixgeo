// How old is this recovery file? — phrased the way the engineer asks it.
//
// The recovery prompt and the start screen's "Recovered work" list both have
// to answer "is this from the session I just lost, or from something I
// abandoned last week?". A duration ("3 hours ago") answers neither question
// well across a lunch break or an overnight; a wall time anchored to a
// calendar day does.
//
// Pure: no React, no I/O. ``now`` is injectable so the phrasing can be tested
// without freezing the system clock.

/** Short month names — fixed rather than locale-derived so the string is
 *  stable across machines and testable without an ICU dependency. */
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

/** Zero-pad to two digits (``7`` → ``"07"``). */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** Whole calendar days from ``b``'s date to ``a``'s date, ignoring the time. */
function calendarDayDelta(a: Date, b: Date): number {
  const dayA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()
  const dayB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
  return Math.round((dayA - dayB) / 86_400_000)
}

/**
 * Describe when a recovery file was written, in day-relative wall time.
 *
 * ``today 14:32`` / ``yesterday 23:05`` / ``12 Jul 08:07``. Callers prefix it
 * with "from" — the phrase itself carries no preposition so it can also sit
 * on its own line in a list.
 *
 * @param writtenAt - ISO-8601 timestamp off the recovery descriptor.
 * @param now - Reference instant; defaults to the current time.
 * @returns The phrase, or ``an unknown time`` when the stamp is unreadable —
 *   a corrupt timestamp costs the age line, never the recovery offer.
 */
export function formatRecoveryAge(writtenAt: string, now: Date = new Date()): string {
  const written = new Date(writtenAt)
  if (Number.isNaN(written.getTime())) return 'an unknown time'

  const clock = `${pad2(written.getHours())}:${pad2(written.getMinutes())}`
  const delta = calendarDayDelta(now, written)
  if (delta === 0) return `today ${clock}`
  if (delta === 1) return `yesterday ${clock}`
  return `${written.getDate()} ${MONTHS[written.getMonth()]} ${clock}`
}
