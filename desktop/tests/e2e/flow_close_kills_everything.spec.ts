/**
 * Flow - closing StrixGeo leaves no lingering process (owner ruling 2026-09-06).
 *
 * "When reinstalling, it always says the app is still open when it isn't ... kill
 * all lingering processes." The NSIS installer's ``CHECK_APP_RUNNING`` refuses to
 * reinstall while a ``StrixGeo.exe`` survives, and the old quit teardown blocked
 * the main thread on ``pg_ctl stop -w -t 30`` (up to thirty seconds) and killed
 * the engine with a bare ``child.kill()`` that orphaned its parse-pool workers on
 * Windows. ``shutdownSequencer`` + ``killProcessTree`` make the close
 * deterministic: kill the engine + database process TREES, 2s hard deadline, exit.
 *
 * This spec closes the app through the REAL close path (the window close →
 * renderer save-prompt handshake → ``window-all-closed`` teardown, NOT
 * ``app.exit``) and then proves that neither the Electron process tree nor any
 * ``groundmodel`` Python engine descended from it survives.
 *
 * Scope note - this runs against the DEV/e2e stack, not the packaged one:
 *   * There is no embedded PostgreSQL here (Docker owns :5433), so the pg_ctl /
 *     postmaster-tree kill is exercised only by the unit tests, not here.
 *   * The harness's OWN uvicorn on :8765 is external - NOT a descendant of the
 *     launched Electron pid - so it is correctly excluded from the assertion.
 *     The app still spawns its own short-lived engine child (which loses the
 *     :8765 race); if it is alive at close, ``killEngineTree`` must take it.
 * The packaged Postgres + persistent-engine-child path can only be proven by the
 * owner on a packaged build.
 *
 * Windows-only (the process-tree enumeration + taskkill are Windows). NOTE: needs
 * the :8765 backend + integration DB - run only through scripts/run-e2e.ps1.
 */

import { test, expect } from '@playwright/test'
import { execFileSync } from 'child_process'
import { launchApp, closeApp } from './helpers/electron_launch'

/** One process row from the CIM snapshot. */
interface ProcRow {
  pid: number
  ppid: number
  cmd: string
}

/**
 * Snapshot every process as pid → parent-pid + command line (Windows CIM).
 *
 * ``CommandLine`` is null for some protected/system processes; those become an
 * empty string. Returns an empty list rather than throwing if the query fails,
 * so a flaky WMI call degrades the poll into "try again" instead of a hard error.
 */
function processSnapshot(): ProcRow[] {
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
    .map(r => ({
      pid: Number(r.ProcessId),
      ppid: Number(r.ParentProcessId ?? 0),
      cmd: r.CommandLine ?? '',
    }))
}

/** Every pid descended (any depth) from ``rootPid`` in one snapshot. */
function descendantsOf(rootPid: number, snap: ProcRow[]): ProcRow[] {
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

/** True once none of ``pids`` appears in a fresh snapshot. */
function allGone(pids: number[]): boolean {
  const live = new Set(processSnapshot().map(r => r.pid))
  return pids.every(pid => !live.has(pid))
}

test.describe('closing StrixGeo kills every lingering process', () => {
  test.skip(process.platform !== 'win32', 'process-tree kill is Windows-only')

  test('the real close path leaves no Electron helper or groundmodel engine alive', async () => {
    const { app, page } = await launchApp()

    // The Electron main pid; every helper (renderer/GPU/utility) and any engine
    // child the app spawned descends from it.
    const mainPid = await app.evaluate(() => process.pid)

    // Give the app a moment so its engine child (startApi) has been spawned -
    // it loses the :8765 race and dies, but a slow .venv import can keep it
    // alive into the close, which is exactly the case killEngineTree must cover.
    await page.waitForTimeout(1500)

    const snap = processSnapshot()
    const descendants = descendantsOf(mainPid, snap)
    const enginePids = descendants.filter(r => /groundmodel/i.test(r.cmd)).map(r => r.pid)
    const watched = [mainPid, ...descendants.map(r => r.pid)]

    // Close through the REAL path: app.close() drives the window close →
    // renderer handshake → window-all-closed teardown (not app.exit). On the
    // clean fixture project the handshake approves immediately; a Discard race
    // inside closeApp covers a dirty one.
    await closeApp(app)

    // Poll up to 5s: the main process, every descendant, and every groundmodel
    // engine child must be gone. Fail with the survivors named.
    const deadline = Date.now() + 5000
    let survivors: number[] = watched
    while (Date.now() < deadline) {
      const live = new Set(processSnapshot().map(r => r.pid))
      survivors = watched.filter(pid => live.has(pid))
      if (survivors.length === 0) break
      await new Promise(r => setTimeout(r, 250))
    }

    expect(
      survivors,
      `still alive 5s after the close: pids ${survivors.join(', ')} (engine pids were ${enginePids.join(', ') || 'none'})`,
    ).toEqual([])
    // Redundant with the above (engine pids are a subset of watched) but names
    // the specific failure the owner reported.
    expect(allGone(enginePids)).toBe(true)
  })
})
