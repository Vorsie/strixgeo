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
 * WHAT DRIVES IT (walkerObserve + walkerPolicy). Every step it DISCOVERS the
 * live interactive DOM -- buttons, inputs, menu items, tabs, checkboxes,
 * canvases, links, anything with a role or a testid, INCLUDING elements with no
 * testid -- and a seeded policy picks the next action from that live set with
 * real weight, plus a large slice of deliberate chaos. The tutorial's verbs are
 * only a weighting prior, never the limit. The seed is printed and settable
 * (``WALKER_SEED``) so a finding replays exactly.
 *
 * WHAT IT CHECKS (walkerInvariants). After every action: a renderer error toast
 * / console error, a refused request the UI offered (409 excepted), a phantom
 * row (on screen but not on the server), an empty view over live data, an
 * unresponsive app, and -- after the final close -- a lingering process. Each
 * violation is a FINDING written to the report; the walk NEVER aborts on one.
 * The Playwright test only fails if the APP crashed.
 *
 * HOW IT LOADS THE PROJECT. Copies the bundled worked example
 * (``resources/sample/worked-example.strix``) to a temp path and opens it
 * through the app's OWN open-from-recents path: the main process decodes the
 * binary ``.strix`` (real strixCodec) and, finding no such project in the DB,
 * POSTs ``/restore`` (useProject.ts). That is the exact restore the onboarding's
 * "Load sample" would drive, minus its OS save dialog.
 *
 * RUN IT: ``.\scripts\run-e2e.ps1 walker`` (the runner sets WALKER=1 when
 * "walker" is in its args; without it this spec skips, so the deterministic
 * suite is unaffected). Prerequisites: the same harness as every other spec
 * (FastAPI :8765, Postgres :5433 integration DB). Windows-only (process
 * survivor check).
 */

import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs'

import { launchApp, closeApp } from '../helpers/electron_launch'
import { executeAction, isFatalPageError } from './walkerActions'
import {
  checkConsoleErrors,
  checkRefusedRequests,
  checkResponsiveness,
  checkSurvivors,
  type Finding,
} from './walkerInvariants'
import {
  checkContactRows,
  checkErrorToast,
  checkSectionRows,
  detectCurrentStage,
  discover,
  heartbeat,
  resolveProjectIdFallback,
} from './walkerObserve'
import { decideAction } from './walkerPolicy'
import { formatReport, summaryLine, type ReportFinding, type RunMeta } from './walkerReport'
import { parseSeed } from './walkerRng'
import { descendantsOf, processSnapshot, survivorsOf } from './processTree'
import type { BadResponse, SpineLabel, WalkerContext } from './walkerTypes'

const SETTLE_MS = 200
const TRAIL_LEN = 10

/** The walk is opt-in (see the file header) -- skip unless enabled. */
const WALKER_ENABLED = process.env.WALKER === '1'

/** Pull the worked-example project id out of a ``/projects/<uuid>/`` url. */
function projectIdFromUrl(url: string, syntheticId: string): string | null {
  const m = url.match(/\/projects\/([0-9a-fA-F-]{36})(?:\/|$)/)
  if (m && m[1] !== syntheticId) return m[1]
  return null
}

/** Remove every recovery slot in the shared e2e userData dir (see header). */
function clearRecoveryDir(): void {
  const dir = path.join(os.tmpdir(), 'strix-e2e-userdata', 'recovery')
  if (!fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir)) {
    try {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true })
    } catch {
      /* another launch may have taken it */
    }
  }
}

/**
 * Open the copied worked example through the app's own open-from-recents path.
 * Mirrors ``project_open.openFixtureProject`` but points at the sample temp file
 * (whose project the DB does not yet have, so the open triggers a /restore).
 */
async function openWorkedExample(page: Page, tmpPath: string): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })
  await page.evaluate(
    async ([filePath, name]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).electron.addRecentProject(filePath, name)
    },
    [tmpPath, 'StrixGeo worked example'] as const,
  )
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })
  const entry = page.getByTestId(`welcome-recent-entry-${tmpPath}`)
  await expect(entry).toBeVisible({ timeout: 10_000 })
  await entry.click()
  // Restoring a full worked example (formations, litho, geotech, bodies,
  // solids) plus the body reconcile can take a while -- be generous.
  await expect(page.getByTestId('welcome-screen')).toBeHidden({ timeout: 90_000 })
  await expect(page.getByRole('navigation', { name: 'Workflow stages' })).toBeVisible({ timeout: 90_000 })
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

test.describe('walker scenario pass', () => {
  test.skip(!WALKER_ENABLED, 'walker is opt-in -- run via .\\scripts\\run-e2e.ps1 walker')
  test.skip(process.platform !== 'win32', 'the process survivor check is Windows-only')

  // The walk plus the close survivor poll can run for the whole time budget.
  test.setTimeout(20 * 60_000)

  test('a novice walk of the worked example surfaces findings without crashing', async () => {
    const seed = parseSeed(process.env.WALKER_SEED) ?? (Math.floor(Math.random() * 0xffffffff) >>> 0)
    const stepBudget = Number(process.env.WALKER_STEPS ?? '300')
    const timeBudgetS = Number(process.env.WALKER_TIME_BUDGET_S ?? '900')
    // eslint-disable-next-line no-console
    console.log(`[walker] seed=${seed} steps=${stepBudget} timeBudgetS=${timeBudgetS} (WALKER_SEED to replay)`)

    const startedAt = new Date().toISOString()
    const resultsDir = path.join(
      __dirname,
      '..',
      '_results',
      'walker',
      `${startedAt.replace(/[:.]/g, '-')}-seed${seed}`,
    )
    fs.mkdirSync(resultsDir, { recursive: true })

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
    let workedProjectId: string | null = null
    let appCrashed = false

    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`))
    page.on('crash', () => {
      appCrashed = true
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
    let stepsSinceStageSwitch = 0
    let reopenCount = 0
    let stepsRun = 0
    let mainPid = -1
    const startMs = Date.now()

    try {
      await openWorkedExample(page, tmpPath)
      mainPid = await app.evaluate(() => process.pid).catch(() => -1)

      await page.waitForTimeout(1500)
      if (workedProjectId === null) workedProjectId = await resolveProjectIdFallback(page, syntheticId)

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
        }
        const plan = decideAction(ctx, seed)

        const beforeConsole = consoleErrors.length
        const beforeBad = badResponses.length

        try {
          await executeAction(app, page, plan, keyMap, seed, step, tmpPath)
        } catch (err) {
          if (isFatalPageError(err)) {
            appCrashed = true
            break
          }
          // A single un-actionable action is expected of a novice -- carry on.
        }
        stepsSinceStageSwitch = plan.kind === 'switchStage' ? 0 : stepsSinceStageSwitch + 1
        if (plan.kind === 'reopenProject') reopenCount += 1

        pushTrail(trail, `${plan.kind}: ${plan.note}`)
        await page.waitForTimeout(SETTLE_MS)
        if (page.isClosed()) {
          appCrashed = true
          break
        }

        const stepFindings: Finding[] = []
        stepFindings.push(...checkConsoleErrors(consoleErrors.slice(beforeConsole), step))
        stepFindings.push(...checkRefusedRequests(badResponses.slice(beforeBad), step))
        stepFindings.push(...(await checkErrorToast(page, step)))

        const post = await discover(page)
        // Runs 1 and 2 never left the Data stage: the heartbeat below clicked the
        // PRE-action stage tab and undid every switch. Read the stage as it is now.
        const stageNow = (await detectCurrentStage(page)) ?? currentStage
        if (stageNow !== null) visited.add(stageNow)
        if (stageNow === 'Sections' && workedProjectId) {
          stepFindings.push(...(await checkSectionRows(page, workedProjectId, step)))
          stepFindings.push(...(await checkContactRows(page, workedProjectId, step)))
        }
        // Heartbeat only when no modal is up (a modal legitimately covers the
        // spine -- clicking through it would false-flag as unresponsive).
        if (!post.openMenu && stageNow !== null) {
          stepFindings.push(...checkResponsiveness(await heartbeat(page, stageNow), step))
        }

        if (stepFindings.length > 0) {
          const screenshot = await captureShot(page, resultsDir, step, shotForStep)
          for (const f of stepFindings) findings.push({ ...f, trail: [...trail], screenshot })
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

      try {
        fs.unlinkSync(tmpPath)
      } catch {
        /* already gone */
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
      }
      fs.writeFileSync(path.join(resultsDir, 'findings.md'), formatReport(meta, findings), 'utf-8')
      // eslint-disable-next-line no-console
      console.log(`[walker] ${summaryLine(findings)} -> ${path.join(resultsDir, 'findings.md')}`)
    }

    // Findings are DATA (exit 0 always). The test only fails on a real crash.
    expect(appCrashed, 'the app crashed during the walk -- see the renderer console log').toBe(false)
  })
})
