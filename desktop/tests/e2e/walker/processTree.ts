/**
 * Windows process-tree helpers for the walker's final close check.
 *
 * The brief reuses ``flow_close_kills_everything.spec.ts``'s check: after the
 * real close, no Electron helper descended from the app and no ``groundmodel``
 * engine may survive. That spec keeps its snapshot/descendants/allGone helpers
 * private, so the same shapes are re-stated here (small, Windows-only, CIM) and
 * the PURE part -- ``descendantsOf`` -- is unit tested. The source of truth for
 * the behaviour is that spec; keep them in step if the close path changes.
 */

import { execFileSync } from 'child_process'

/** One process row from the CIM snapshot. */
export interface ProcRow {
  readonly pid: number
  readonly ppid: number
  readonly cmd: string
}

/**
 * Snapshot every process as pid -> parent-pid + command line (Windows CIM).
 *
 * Returns an empty list rather than throwing if the query fails, so a flaky WMI
 * call degrades the poll into "try again" instead of a hard error.
 */
export function processSnapshot(): ProcRow[] {
  let raw: string
  try {
    raw = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress',
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
  } catch {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  return rows
    .map(r => r as { ProcessId?: number; ParentProcessId?: number; CommandLine?: string | null })
    .filter(r => typeof r.ProcessId === 'number')
    .map(r => ({ pid: Number(r.ProcessId), ppid: Number(r.ParentProcessId ?? 0), cmd: r.CommandLine ?? '' }))
}

/**
 * Every process descended (any depth) from ``rootPid`` in one snapshot.
 *
 * Pure -- takes the snapshot as data -- so it is unit tested without a real
 * process tree.
 *
 * @param rootPid - The ancestor pid.
 * @param snap - A process snapshot.
 * @returns The descendant rows (root excluded).
 */
export function descendantsOf(rootPid: number, snap: readonly ProcRow[]): ProcRow[] {
  const byParent = new Map<number, ProcRow[]>()
  for (const row of snap) {
    const list = byParent.get(row.ppid) ?? []
    list.push(row)
    byParent.set(row.ppid, list)
  }
  const out: ProcRow[] = []
  const queue = [rootPid]
  const seen = new Set<number>([rootPid])
  while (queue.length > 0) {
    const parent = queue.shift() as number
    for (const child of byParent.get(parent) ?? []) {
      if (seen.has(child.pid)) continue
      seen.add(child.pid)
      out.push(child)
      queue.push(child.pid)
    }
  }
  return out
}

/** Which of ``pids`` are still alive in a fresh snapshot. */
export function survivorsOf(pids: readonly number[]): number[] {
  const live = new Set(processSnapshot().map(r => r.pid))
  return pids.filter(pid => live.has(pid))
}
