/**
 * Force-kill a whole process tree by its root pid (Windows ``taskkill``).
 *
 * Why this module exists: closing StrixGeo must leave no lingering process, or
 * the NSIS installer's ``CHECK_APP_RUNNING`` macro refuses to reinstall over a
 * "still running" app (owner, 2026-09-06). ``ChildProcess.kill()`` on Windows is
 * ``TerminateProcess`` on the DIRECT process only - the engine's
 * ``ProcessPoolExecutor`` parse workers (up to four ``python.exe`` grandchildren
 * once a DOV import ran) and PostgreSQL's per-connection backends + background
 * workers all survive it, reparented and orphaned. ``taskkill /PID <pid> /T /F``
 * is the cure: ``/T`` walks the whole tree while the parent still lives to link
 * its descendants, ``/F`` force-terminates each.
 *
 * The exact argv is a pure function so the load-bearing ``/T`` flag is
 * unit-pinned - the entire bug is "the old code lacked ``/T``".
 *
 * @module main/killProcessTree
 */

import { spawnSync } from 'child_process'

/**
 * The ``taskkill`` argv that force-kills the process tree rooted at ``pid``.
 *
 * Parameters
 * ----------
 * pid : number
 *     The root process id whose whole tree to terminate.
 *
 * Returns
 * -------
 * string[]
 *     ``['/PID', '<pid>', '/T', '/F']`` - ``/T`` (tree, incl. grandchildren),
 *     ``/F`` (force). Never a bare terminate: that is the orphan bug.
 */
export function taskkillTreeArgs(pid: number): string[] {
  return ['/PID', String(pid), '/T', '/F']
}

/** Minimal shape of ``spawnSync``'s return that {@link killProcessTreeSync} reads. */
export interface TreeKillResult {
  status: number | null
  stderr?: string | Buffer
}

/** How the kill is actually run - real ``spawnSync`` in production, a fake in tests. */
export type SpawnSyncLike = (command: string, args: string[]) => TreeKillResult

/**
 * Force-kill the process tree rooted at ``pid``, synchronously and best-effort.
 *
 * Synchronous because it runs on the quit path, where the event loop is about to
 * stop and a promise may never resolve. Best-effort because a pid that already
 * exited makes ``taskkill`` exit non-zero ("process not found") - the goal state
 * (that tree gone) already holds, so a non-zero status is logged, never thrown:
 * this must not be the thing that crashes the shutdown it is meant to complete.
 *
 * On a non-Windows dev machine ``taskkill`` does not exist and the run errors out
 * the same way (logged, ignored); the direct ``child.kill()`` the caller does
 * first is the actual terminate there. StrixGeo ships Windows-only.
 *
 * Parameters
 * ----------
 * pid : number
 *     Root pid whose tree to kill.
 * log : (line: string) => void
 *     Log sink for the outcome (INFO-level in the caller).
 * run : SpawnSyncLike, optional
 *     Injected runner; defaults to ``spawnSync('taskkill', …)``.
 */
export function killProcessTreeSync(
  pid: number,
  log: (line: string) => void,
  run: SpawnSyncLike = (command, args) => spawnSync(command, args, { encoding: 'utf8' }),
): void {
  let result: TreeKillResult
  try {
    result = run('taskkill', taskkillTreeArgs(pid))
  } catch (error) {
    // spawnSync itself failing (e.g. taskkill missing) must not throw out of the
    // teardown - record it and move on.
    log(`[shutdown] taskkill tree of pid ${pid} could not run: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  if (result.status === 0) {
    log(`[shutdown] taskkill tree of pid ${pid} ok`)
    return
  }
  const err = (result.stderr ?? '').toString().trim().slice(0, 200)
  log(`[shutdown] taskkill tree of pid ${pid} returned ${result.status}${err ? ` (${err})` : ''}`)
}
