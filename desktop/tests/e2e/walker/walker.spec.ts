/**
 * Scenario pass -- the "walker" (owner ruling 2026-09-06).
 *
 * Plays a NOVICE engineer through the worked-example project across the whole
 * spine (Data -> Sections -> Stratigraphy -> Litho -> Geotech -> Parameters ->
 * Export) BEFORE every installer build, so the owner has less dogfeeding to do.
 * The user is deliberately dumb: clicks in the wrong order, double- and
 * triple-clicks, opens a menu and clicks elsewhere, drags past edges, presses
 * Escape mid-dialog, ignores warnings, repeats actions on things already gone,
 * switches stage mid-action, types junk, fires shortcuts in the wrong stage,
 * resizes the window, and closes / reopens.
 *
 * DEEPER (owner 2026-10-13: "Walk again, add more steps. I test it once and
 * find a bug, walker is thus not doing its job."). The bug he found: opening a
 * SECOND project left the first project's models active. The walk now also
 * switches to ANOTHER project and back (the seeded synthetic fixture next to
 * the worked example, both on the welcome screen's recent list, switched
 * through File > Close Project in ONE renderer session -- a page reload would
 * throw away exactly the state that leaks), bursts undo/redo, saves, opens
 * Settings and every import route. The defaults rose to 900 steps / 1500 s,
 * the Playwright timeout follows the time budget, and WALKER_RUNS repeats the
 * walk with seeds seed, seed+1, ...
 *
 * WHAT DRIVES IT (walkerObserve + walkerPolicy). Every step it DISCOVERS the
 * live interactive DOM and a seeded policy picks the next action from that
 * live set, plus a slice of project-level verbs and a large slice of
 * deliberate chaos. The seed is printed and settable (``WALKER_SEED``) so a
 * finding replays exactly.
 *
 * WHAT IT CHECKS (walkerInvariants + walkerCrossProject). After every action:
 * a renderer error toast / console error, a refused request the UI offered
 * (409 excepted), a phantom row, an empty view over live data, an unresponsive
 * app, a request that mixes one project's path with another project's model
 * (or names the previous project while another is open), and -- after the
 * final close -- a lingering process. Each violation is a FINDING written to
 * the report; the walk NEVER aborts on one. A run's test only fails if the APP
 * crashed. The gate is "0 findings over all runs".
 *
 * WHERE IT WRITES. ``_results/walker/<start>-seed<seed>/``: ``findings.md``,
 * one screenshot per finding step, and ``trail.log`` (every step appended
 * BEFORE its action runs -- the reporters hide this test's console, so a hung
 * run's file ends on the step it hung on). ``batch-<runner pid>.json`` holds
 * the base seed and each run's count, so the total survives a worker restart.
 *
 * RUN IT: ``.\scripts\run-e2e.ps1 walker`` (the runner sets WALKER=1 when
 * "walker" is in its args; without it this spec skips). Knobs: WALKER_SEED,
 * WALKER_STEPS (900), WALKER_TIME_BUDGET_S (1500), WALKER_RUNS (1),
 * WALKER_TRACE=1. Windows-only (process survivor check).
 */

import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs'

import { e2eUserDataDir, launchApp, closeApp } from '../helpers/electron_launch'
import { writeFixtureProjectFile } from '../helpers/project_open'
import { executeAction, isFatalPageError, reopenProject } from './walkerActions'
import { batchFilePath, loadBatch, recordRun, type BatchState } from './walkerBatch'
import { readBudget, runSeeds, testTimeoutMs } from './walkerBudget'
import { CrossProjectLedger, type ObservedRequest } from './walkerCrossProject'
import {
  checkConsoleErrors,
  checkRefusedRequests,
  checkResponsiveness,
  checkSurvivors,
  isIgnoredConsoleError,
  type Finding,
} from './walkerInvariants'
import {
  API_BASE,
  checkContactRows,
  checkErrorToast,
  checkSectionRows,
  detectCurrentStage,
  discover,
  fetchModelIds,
  heartbeat,
  resolveProjectIdFallback,
} from './walkerObserve'
import { decideAction } from './walkerPolicy'
import { openWorkedExample, switchProject, type ProjectSlot } from './walkerProjectActions'
import { formatReport, summaryLine, totalSummaryLine, type ReportFinding, type RunMeta } from './walkerReport'
import { parseSeed } from './walkerRng'
import { TrailWriter } from './walkerTrail'
import { descendantsOf, processSnapshot, survivorsOf } from './processTree'
import type { BadResponse, SpineLabel, WalkerContext } from './walkerTypes'

const SETTLE_MS = 200
const TRAIL_LEN = 10

/** The walk is opt-in (see the file header) -- skip unless enabled. */
const WALKER_ENABLED = process.env.WALKER === '1'

/** Steps / time / runs for this invocation (walkerBudget defaults when unset). */
const BUDGET = readBudget(process.env)

const WALKER_RESULTS_ROOT = path.join(__dirname, '..', '_results', 'walker')

/** Pull the worked-example project id out of a ``/projects/<uuid>/`` url. */
function projectIdFromUrl(url: string, syntheticId: string): string | null {
  const m = url.match(/\/projects\/([0-9a-fA-F-]{36})(?:\/|$)/)
  if (m && m[1] !== syntheticId) return m[1]
  return null
}

/** Remove every recovery slot in THIS run's e2e userData dir (suffix included). */
function clearRecoveryDir(): void {
  const dir = path.join(e2eUserDataDir(), 'recovery')
  if (!fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir)) {
    try {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true })
    } catch {
      /* another launch may have taken it */
    }
  }
}

/** This invocation's batch file (walkerBatch.ts: survives a worker restart). */
const BATCH_FILE = batchFilePath(WALKER_RESULTS_ROOT, process.ppid)

/** The base seed: WALKER_SEED, else a fresh random one (drawn once per invocation). */
function drawBaseSeed(): number {
  return parseSeed(process.env.WALKER_SEED) ?? Math.floor(Math.random() * 0xffffffff) >>> 0
}

/** One screenshot per finding-step (deduped). Returns its relative name. */
async function captureShot(page: Page, dir: string, step: number, done: Set<number>): Promise<string | undefined> {
  const name = `step-${step}.png`
  if (done.has(step)) return name
  done.add(step)
  try {
    await page.screenshot({ path: path.join(dir, name) })
    return name
  } catch {
    return undefined
  }
}

/** Keep ``trail`` at the last {@link TRAIL_LEN} notes. */
function pushTrail(trail: string[], note: string): void {
  trail.push(note)
  if (trail.length > TRAIL_LEN) trail.shift()
}

/** What one walk reports back to its test. */
interface WalkResult {
  readonly findings: number
  readonly appCrashed: boolean
  readonly resultsDir: string
}

/**
 * One independent walk: its own launch, its own close, its own results dir.
 *
 * @param seed - This run's seed.
 * @param runIndex - 1-based run number.
 * @param runs - Runs planned in this invocation.
 */
async function walkOnce(seed: number, runIndex: number, runs: number): Promise<WalkResult> {
  const stepBudget = BUDGET.steps
  const timeBudgetS = BUDGET.timeBudgetS
  // eslint-disable-next-line no-console
  console.log(
    `[walker] run ${runIndex} of ${runs} seed=${seed} steps=${stepBudget} timeBudgetS=${timeBudgetS} (WALKER_SEED to replay)`,
  )

  const startedAt = new Date().toISOString()
  const resultsDir = path.join(WALKER_RESULTS_ROOT, `${startedAt.replace(/[:.]/g, '-')}-seed${seed}`)
  fs.mkdirSync(resultsDir, { recursive: true })
  const trailFile = new TrailWriter(resultsDir)
  trailFile.note(`run ${runIndex} of ${runs} seed=${seed} steps=${stepBudget} timeBudgetS=${timeBudgetS}`)

  clearRecoveryDir()

  const samplePath = path.resolve(__dirname, '..', '..', '..', 'resources', 'sample', 'worked-example.strix')
  if (!fs.existsSync(samplePath)) {
    throw new Error(`worked example not found at ${samplePath} -- build resources/sample first`)
  }
  const tmpPath = path.join(os.tmpdir(), `strix-walker-${process.pid}-${Date.now()}.strix`)
  fs.copyFileSync(samplePath, tmpPath)

  const syntheticId = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

  const { app, page } = await launchApp({ WALKER: '1' })
  const consoleErrors: string[] = []
  const badResponses: BadResponse[] = []
  const requests: ObservedRequest[] = []
  const ledger = new CrossProjectLedger()
  let workedProjectId: string | null = null
  // The project open when a request is SENT; null mid-switch / on welcome, so
  // nothing sent then is judged by the cross-project invariant.
  let currentProjectId: string | null = null
  let appCrashed = false

  page.on('console', msg => {
    if (msg.type() !== 'error') return
    // An external host's network failure (a basemap tile reset) is not the
    // app; see isIgnoredConsoleError for the exact shape that is dropped.
    const captured = { source: 'console', text: msg.text(), locationUrl: msg.location().url } as const
    if (isIgnoredConsoleError(captured)) return
    consoleErrors.push(msg.text())
  })
  page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`))
  page.on('crash', () => {
    appCrashed = true
  })
  page.on('request', req => {
    const url = req.url()
    if (!url.startsWith(API_BASE)) return
    requests.push({ method: req.method(), url, currentProjectId })
  })
  page.on('response', resp => {
    const pid = projectIdFromUrl(resp.url(), syntheticId)
    if (pid && workedProjectId === null) workedProjectId = pid
    if (resp.status() >= 400) {
      badResponses.push({ method: resp.request().method(), url: resp.url(), status: resp.status() })
    }
  })

  const findings: ReportFinding[] = []
  const trail: string[] = []
  const visited = new Set<SpineLabel>()
  const shotForStep = new Set<number>()
  const switchLog: string[] = []
  const importRoutesDone: string[] = []
  let stepsSinceStageSwitch = 0
  let reopenCount = 0
  let projectSwitchCount = 0
  let stepsSinceProjectSwitch = 0
  let stepsRun = 0
  let mainPid = -1
  const startMs = Date.now()

  // Slot 0 = the worked example; slot 1 = the seeded synthetic fixture, the
  // SECOND project a switch opens (absent when the runner seeded none).
  const slots: ProjectSlot[] = [{ label: 'worked', path: tmpPath }]
  let fixturePath: string | null = null
  let currentSlot = 0
  const idOfSlot = (i: number): string | null => (i === 0 ? workedProjectId : syntheticId || null)

  try {
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })
    if (syntheticId !== '') {
      try {
        fixturePath = await writeFixtureProjectFile(page, syntheticId, 'E2E Fixture (walker second project)')
        slots.push({ label: 'fixture', path: fixturePath })
      } catch (err) {
        trailFile.note(`no second project: ${String((err as Error)?.message ?? err)}`)
      }
    } else {
      trailFile.note('no second project: E2E_FIXTURE_PROJECT_ID is unset, switchProject disabled')
    }
    await openWorkedExample(page, tmpPath)
    mainPid = await app.evaluate(() => process.pid).catch(() => -1)

    await page.waitForTimeout(1500)
    if (workedProjectId === null) workedProjectId = await resolveProjectIdFallback(page, syntheticId)
    // Both projects' models are registered while nothing is judged yet
    // (currentProjectId still null), so these probe requests are not findings.
    for (let i = 0; i < slots.length; i++) {
      const pid = idOfSlot(i)
      if (pid) ledger.registerModels(pid, await fetchModelIds(page, pid))
    }
    currentProjectId = idOfSlot(currentSlot)
    trailFile.note(`projects: ${slots.map((s, i) => `${s.label}=${idOfSlot(i) ?? '?'}`).join(' ')}`)

    for (let step = 0; step < stepBudget; step++) {
      if ((Date.now() - startMs) / 1000 >= timeBudgetS) break
      if (page.isClosed()) {
        appCrashed = true
        break
      }
      stepsRun = step + 1

      const currentStage = await detectCurrentStage(page)
      if (currentStage !== null) visited.add(currentStage)
      const { candidates, openMenu } = await discover(page)
      const keyMap = new Map(candidates.map(c => [c.key, c]))

      const ctx: WalkerContext = {
        stepIndex: step,
        currentStage,
        visitedStages: [...visited],
        stepsSinceStageSwitch,
        candidates,
        openMenu,
        reopenCount,
        projectSwitchCount,
        stepsSinceProjectSwitch,
        canSwitchProject: slots.length > 1,
        importRoutesDone,
      }
      const plan = decideAction(ctx, seed)
      // On disk BEFORE the action: a hang leaves this as the file's last line.
      trailFile.step(step, currentStage, plan.kind, plan.note)
      // WALKER_TRACE=1: the same line on the console as well.
      if (process.env.WALKER_TRACE === '1') {
        console.log(`[walker] step ${step} stage=${currentStage ?? '?'} ${plan.kind}: ${plan.note}`)
      }

      const beforeConsole = consoleErrors.length
      const beforeBad = badResponses.length
      const beforeRequests = requests.length

      try {
        if (plan.kind === 'switchProject' && slots.length > 1) {
          const from = currentSlot
          const to = 1 - currentSlot
          currentProjectId = null
          const outcome = await switchProject(app, page, plan.closeChoice ?? 'discard', slots[from], slots[to], s => {
            // Judge every request from the first one the opening project sends.
            currentProjectId = idOfSlot(slots.indexOf(s))
          })
          if (outcome === 'switched') currentSlot = to
          currentProjectId = outcome === 'welcome' ? null : idOfSlot(currentSlot)
          const line = `step ${step}: ${slots[from].label} -> ${slots[to].label} (${plan.closeChoice}): ${outcome}`
          switchLog.push(line)
          trailFile.note(`switch project ${line}`)
          projectSwitchCount += 1
          stepsSinceProjectSwitch = 0
          const pid = idOfSlot(currentSlot)
          if (outcome === 'switched' && pid) ledger.registerModels(pid, await fetchModelIds(page, pid))
        } else {
          const outcome = await executeAction(app, page, plan, keyMap, seed, step, slots[currentSlot].path)
          if (outcome !== undefined) trailFile.note(`step ${step} outcome: ${outcome}`)
        }
      } catch (err) {
        if (isFatalPageError(err)) {
          appCrashed = true
          break
        }
        // A single un-actionable action is expected of a novice -- carry on.
      }
      stepsSinceStageSwitch = plan.kind === 'switchStage' ? 0 : stepsSinceStageSwitch + 1
      if (plan.kind !== 'switchProject') stepsSinceProjectSwitch += 1
      if (plan.kind === 'reopenProject') reopenCount += 1
      if (plan.kind === 'openImportDialog' && plan.importRoute) importRoutesDone.push(plan.importRoute)

      pushTrail(trail, `${plan.kind}: ${plan.note}`)
      await page.waitForTimeout(SETTLE_MS)
      if (page.isClosed()) {
        appCrashed = true
        break
      }

      const stepFindings: Finding[] = []
      stepFindings.push(...checkConsoleErrors(consoleErrors.slice(beforeConsole), step))
      stepFindings.push(...checkRefusedRequests(badResponses.slice(beforeBad), step))
      stepFindings.push(...ledger.check(requests.slice(beforeRequests), step))
      stepFindings.push(...(await checkErrorToast(page, step)))

      const post = await discover(page)
      // Runs 1 and 2 never left the Data stage: the heartbeat below clicked the
      // PRE-action stage tab and undid every switch. Read the stage as it is now.
      const stageNow = (await detectCurrentStage(page)) ?? currentStage
      if (stageNow !== null) visited.add(stageNow)
      if (stageNow === 'Sections' && currentProjectId) {
        stepFindings.push(...(await checkSectionRows(page, currentProjectId, step)))
        stepFindings.push(...(await checkContactRows(page, currentProjectId, step)))
      }
      // A novice can close the project through the app's own Close verb (run
      // 28 did, step 275), or a switch can end on the welcome screen: the
      // welcome screen has no spine, so a heartbeat there would false-flag as
      // unresponsive. Walk back into the CURRENT project and count a reopen.
      const onWelcome = await page.getByTestId('welcome-screen').isVisible().catch(() => false)
      if (onWelcome) {
        pushTrail(trail, `welcome: the project was closed, reopening ${slots[currentSlot].label} from recents`)
        trailFile.note(`step ${step}: on the welcome screen, reopening ${slots[currentSlot].label}`)
        currentProjectId = null
        await reopenProject(page, slots[currentSlot].path).catch(() => {})
        currentProjectId = idOfSlot(currentSlot)
        reopenCount += 1
      } else if (!post.openMenu && stageNow !== null) {
        // Heartbeat only when no modal is up (a modal legitimately covers the
        // spine -- clicking through it would false-flag as unresponsive).
        stepFindings.push(...checkResponsiveness(await heartbeat(page, stageNow), step))
      }

      if (stepFindings.length > 0) {
        const screenshot = await captureShot(page, resultsDir, step, shotForStep)
        for (const f of stepFindings) findings.push({ ...f, trail: [...trail], screenshot })
        trailFile.note(`step ${step}: ${stepFindings.length} finding(s): ${stepFindings.map(f => f.invariant).join(', ')}`)
      }
    }
  } finally {
    // Clear any transient overlay so the close handshake is not blocked.
    if (!page.isClosed()) {
      await page.keyboard.press('Escape').catch(() => {})
      await page.keyboard.press('Escape').catch(() => {})
    }
    const preCloseSnap = mainPid > 0 ? processSnapshot() : []
    const watched = mainPid > 0 ? [mainPid, ...descendantsOf(mainPid, preCloseSnap).map(r => r.pid)] : []

    trailFile.note('closing the app')
    await closeApp(app).catch(() => {})

    if (watched.length > 0) {
      const deadline = Date.now() + 5000
      let survivors = watched
      while (Date.now() < deadline) {
        survivors = survivorsOf(watched)
        if (survivors.length === 0) break
        await new Promise(r => setTimeout(r, 250))
      }
      for (const f of checkSurvivors(survivors, stepsRun)) findings.push({ ...f, trail: [...trail] })
    }

    for (const p of [tmpPath, fixturePath]) {
      if (p === null) continue
      try {
        fs.unlinkSync(p)
      } catch {
        /* already gone */
      }
    }

    const meta: RunMeta = {
      seed,
      steps: stepsRun,
      stepBudget,
      timeBudgetS,
      durationS: (Date.now() - startMs) / 1000,
      stagesVisited: [...visited],
      projectId: workedProjectId ?? 'unknown',
      startedAt,
      appCrashed,
      run: { index: runIndex, total: runs },
      projectSwitches: switchLog,
    }
    fs.writeFileSync(path.join(resultsDir, 'findings.md'), formatReport(meta, findings), 'utf-8')
    trailFile.note(`${summaryLine(findings)} (run ${runIndex} of ${runs})`)
    // eslint-disable-next-line no-console
    console.log(
      `[walker] run ${runIndex} of ${runs}: ${findings.length} findings -> ${path.join(resultsDir, 'findings.md')}`,
    )
  }
  return { findings: findings.length, appCrashed, resultsDir }
}

test.describe('walker scenario pass', () => {
  test.skip(!WALKER_ENABLED, 'walker is opt-in -- run via .\\scripts\\run-e2e.ps1 walker')
  test.skip(process.platform !== 'win32', 'the process survivor check is Windows-only')

  // The timeout FOLLOWS the time budget (owner 2026-10-13): budget + a fixed
  // margin for the launch, the restore, the close and the survivor poll.
  test.setTimeout(testTimeoutMs(BUDGET.timeBudgetS))

  for (let i = 0; i < BUDGET.runs; i++) {
    const title =
      BUDGET.runs === 1
        ? 'a novice walk of the worked example surfaces findings without crashing'
        : `run ${i + 1} of ${BUDGET.runs}: a novice walk of the worked example surfaces findings without crashing`
    test(title, async () => {
      const seed = runSeeds(loadBatch(BATCH_FILE, drawBaseSeed).baseSeed, BUDGET.runs)[i]
      let result: WalkResult = { findings: 0, appCrashed: true, resultsDir: '' }
      try {
        result = await walkOnce(seed, i + 1, BUDGET.runs)
      } finally {
        recordRun(BATCH_FILE, { index: i + 1, seed, ...result })
      }
      // Findings are DATA (exit 0 always). The test only fails on a real crash.
      expect(result.appCrashed, 'the app crashed during the walk -- see the renderer console log').toBe(false)
    })
  }

  test.afterAll(() => {
    if (!WALKER_ENABLED || process.platform !== 'win32') return
    let state: BatchState
    try {
      state = JSON.parse(fs.readFileSync(BATCH_FILE, 'utf-8')) as BatchState
    } catch {
      return
    }
    // The grep line over every run (the gate is 0 findings over all runs).
    // eslint-disable-next-line no-console
    console.log(
      `[walker] ${totalSummaryLine(
        state.runs.map(r => r.findings),
        BUDGET.runs,
      )} (seeds ${state.runs.map(r => r.seed).join(', ')})`,
    )
  })
})
