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

/** The finding threshold: a watched pid alive this long after the close lingers. */
export const LINGER_THRESHOLD_MS = 5_000

/** How long the close is observed, only to report when each survivor exited. */
export const LINGER_OBSERVE_MS = 20_000

/** How often the close observation re-reads the process list. */
export const LINGER_POLL_MS = 250

/** What the close observation saw. */
export interface SurvivorObservation {
  /** The pids still alive at the first poll at or after the threshold. */
  readonly atThreshold: number[]
  /** Per pid, ms from the start to the first poll that saw it gone. */
  readonly exitedAfterMs: Map<number, number>
}

/** The clock, sleep and process list the observation runs on (injected for tests). */
export interface ObserveDeps {
  readonly snapshot: () => readonly ProcRow[]
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
}

const REAL_DEPS: ObserveDeps = {
  snapshot: processSnapshot,
  now: () => Date.now(),
  sleep: ms => new Promise(r => setTimeout(r, ms)),
}

/**
 * Watch ``pids`` after the close: who is alive at the threshold, and when each exited.
 *
 * Polls every ``pollMs`` until every pid is gone or ``windowMs`` has passed.
 * The threshold set is taken at the first poll at or after ``thresholdMs``;
 * when every pid exits earlier it is empty. An EMPTY snapshot is a failed WMI
 * query, not "everything exited", so it changes nothing.
 *
 * @param pids - The watched pids (the app's main pid and its descendants).
 * @param opts - The threshold, the observation window and the poll interval,
 *   plus an optional callback fired once at the threshold with the survivors.
 * @param deps - Clock, sleep and snapshot; the real ones by default.
 * @returns The survivors at the threshold and the per-pid exit times.
 */
export async function observeSurvivors(
  pids: readonly number[],
  opts: {
    readonly thresholdMs: number
    readonly windowMs: number
    readonly pollMs: number
    readonly onThreshold?: (survivors: readonly number[]) => void
  },
  deps: ObserveDeps = REAL_DEPS,
): Promise<SurvivorObservation> {
  const start = deps.now()
  const exitedAfterMs = new Map<number, number>()
  let alive: number[] = [...pids]
  let atThreshold: number[] | null = null
  for (;;) {
    const snap = deps.snapshot()
    const elapsed = deps.now() - start
    if (snap.length > 0) {
      const live = new Set(snap.map(r => r.pid))
      for (const pid of alive) if (!live.has(pid)) exitedAfterMs.set(pid, elapsed)
      alive = alive.filter(pid => live.has(pid))
    }
    if (atThreshold === null && elapsed >= opts.thresholdMs) {
      atThreshold = [...alive]
      opts.onThreshold?.(atThreshold)
    }
    if (alive.length === 0 || elapsed >= opts.windowMs) break
    await deps.sleep(opts.pollMs)
  }
  return { atThreshold: atThreshold ?? [], exitedAfterMs }
}

/** How many characters of a survivor's command line a finding carries. */
export const SURVIVOR_CMD_HEAD_CHARS = 160

/**
 * The executable a command line runs: the basename of its first token.
 *
 * Windows command lines quote a program path that holds spaces
 * (``"C:\Program Files\...\electron.exe" --type=gpu-process``) and leave a
 * plain one bare (``C:\Windows\system32\conhost.exe 0x4``), so the first token
 * is the quoted run when the line opens with a quote, else the run up to the
 * first space.
 *
 * @param cmd - A process command line (may be empty: CIM returns no command
 *   line for some protected processes).
 * @returns The executable's file name, or ``''`` for an empty command line.
 */
export function exeNameOf(cmd: string): string {
  const line = cmd.trim()
  if (line === '') return ''
  let token: string
  if (line.startsWith('"')) {
    const close = line.indexOf('"', 1)
    token = close === -1 ? line.slice(1) : line.slice(1, close)
  } else {
    const space = line.indexOf(' ')
    token = space === -1 ? line : line.slice(0, space)
  }
  const parts = token.split(/[\\/]/)
  return parts[parts.length - 1]
}

/**
 * One process named from a snapshot, for a lingering-process finding.
 *
 * A bare pid is undiagnosable once the process has exited (walker deep run
 * 2026-10-16), so the survivor is named from the snapshot taken BEFORE the
 * close: parent pid, executable and the head of its command line.
 *
 * @param pid - The process id.
 * @param snap - The pre-close snapshot.
 * @param lifetime - Optional suffix (``exited after 7.3 s``) appended after a
 *   ``;`` inside the parentheses.
 * @returns ``<pid> (ppid <ppid>, <exe>, "<cmd head>")``, or
 *   ``<pid> (not in the pre-close snapshot)``.
 */
export function describeProcess(pid: number, snap: readonly ProcRow[], lifetime?: string): string {
  const tail = lifetime === undefined ? '' : `; ${lifetime}`
  const row = snap.find(r => r.pid === pid)
  if (row === undefined) return `${pid} (not in the pre-close snapshot${tail})`
  const cmd = row.cmd.trim()
  if (cmd === '') return `${pid} (ppid ${row.ppid}, unknown executable, no command line${tail})`
  const head = cmd.length > SURVIVOR_CMD_HEAD_CHARS ? `${cmd.slice(0, SURVIVOR_CMD_HEAD_CHARS)}...` : cmd
  return `${pid} (ppid ${row.ppid}, ${exeNameOf(cmd)}, "${head}"${tail})`
}

/**
 * How long a survivor lived after the close, for the finding and the trail.
 *
 * @param exitedAfterMs - Milliseconds from the close to the first poll that saw
 *   the process gone, or ``undefined`` when it outlived the observation window.
 * @param windowMs - The observation window.
 * @returns ``exited after 7.3 s`` or ``still alive at 20 s``.
 */
export function formatLifetime(exitedAfterMs: number | undefined, windowMs: number): string {
  if (exitedAfterMs === undefined) return `still alive at ${Math.round(windowMs / 1000)} s`
  return `exited after ${(exitedAfterMs / 1000).toFixed(1)} s`
}
