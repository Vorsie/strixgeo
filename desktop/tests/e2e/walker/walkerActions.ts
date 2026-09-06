/**
 * The walker's action executor (Playwright side).
 *
 * Turns a pure {@link ActionPlan} from walkerPolicy into real gestures on the
 * running app. Every gesture is best-effort: an ordinary failure (an
 * un-actionable click, a field that rejects junk) is swallowed so the walk
 * continues, and ONLY a fatal page/crash error is re-thrown so the orchestrator
 * can record ``appCrashed``. Kept out of walker.spec.ts to keep that file the
 * loop, not the plumbing.
 */

import type { ElectronApplication, Page } from '@playwright/test'

import { SPINE_STAGES } from './walkerPolicy'
import { mulberry32, mixSeed } from './walkerRng'
import type { ActionPlan, Candidate, SpineLabel } from './walkerTypes'

const ACTION_TIMEOUT_MS = 2500

/** Spine label -> stage-tab testid (StageSpine.tsx). */
const STAGE_TESTID = new Map<SpineLabel, string>(SPINE_STAGES.map(s => [s.label, s.testid]))

/** Locator for a discovered candidate's marker. */
function locFor(page: Page, key: string) {
  return page.locator(`[data-walker-target="${key}"]`)
}

/** Centre of a candidate's box, re-fetched live when possible. */
async function centreOf(
  page: Page,
  key: string,
  keyMap: Map<string, Candidate>,
): Promise<{ x: number; y: number } | null> {
  const live = await locFor(page, key)
    .boundingBox()
    .catch(() => null)
  if (live) return { x: live.x + live.width / 2, y: live.y + live.height / 2 }
  const box = keyMap.get(key)?.box
  if (!box) return null
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 }
}

/** True for a Playwright error that means the page / app is gone (a crash). */
export function isFatalPageError(err: unknown): boolean {
  const m = String((err as { message?: string })?.message ?? err)
  return /Target (page|closed)|crashed|has been closed|Browser has been closed/i.test(m)
}

/** Re-throw a fatal (crash) error; swallow every ordinary action failure. */
function rethrowIfFatal(err: unknown): void {
  if (isFatalPageError(err)) throw err
}

/**
 * Execute one action plan against the app. Throws ONLY on a fatal (crash)
 * error; every ordinary failure is swallowed so the walk goes on.
 *
 * @param app - The Electron application handle (for resize).
 * @param page - The renderer page.
 * @param plan - The decided action.
 * @param keyMap - Discovered candidates by key (box fallback for gestures).
 * @param seed - Run seed (for deterministic canvas offsets).
 * @param step - Step index (for deterministic canvas offsets).
 * @param tmpPath - The temp ``.strix`` path (for reopen).
 */
export async function executeAction(
  app: ElectronApplication,
  page: Page,
  plan: ActionPlan,
  keyMap: Map<string, Candidate>,
  seed: number,
  step: number,
  tmpPath: string,
): Promise<void> {
  const opts = { force: true, timeout: ACTION_TIMEOUT_MS } as const
  const target = plan.targetKey ? locFor(page, plan.targetKey) : null

  switch (plan.kind) {
    case 'click':
      await target?.click(opts).catch(rethrowIfFatal)
      break
    case 'multiClick':
      for (let i = 0; i < (plan.repeat ?? 2); i++) {
        await target?.click({ ...opts, delay: 10 }).catch(rethrowIfFatal)
      }
      break
    case 'rightClick':
      await target?.click({ ...opts, button: 'right' }).catch(rethrowIfFatal)
      break
    case 'hover':
      await target?.hover(opts).catch(rethrowIfFatal)
      break
    case 'toggleTwice':
      await target?.click(opts).catch(rethrowIfFatal)
      await target?.click(opts).catch(rethrowIfFatal)
      break
    case 'typeJunk':
      await typeJunk(page, target, plan.text ?? '').catch(rethrowIfFatal)
      break
    case 'pressKey':
      if (plan.pressKey) await page.keyboard.press(plan.pressKey).catch(rethrowIfFatal)
      break
    case 'wheel':
      await doWheel(page, plan, keyMap).catch(rethrowIfFatal)
      break
    case 'dragBetween':
      await doDrag(page, plan, keyMap).catch(rethrowIfFatal)
      break
    case 'canvasGesture':
      await doCanvas(page, plan, keyMap, seed, step).catch(rethrowIfFatal)
      break
    case 'switchStage':
      if (plan.stage) {
        const id = STAGE_TESTID.get(plan.stage)
        if (id) {
          // Run 1 (seed 20260906) stayed on the Data stage for 300 steps: every
          // switch click was swallowed (a menu or panel under the pointer, an
          // actionability timeout) and nothing said so. Close whatever is open,
          // click, and verify the tab actually took; on a miss, force once and
          // report it, so the run explains its own coverage.
          await page.keyboard.press('Escape').catch(() => {})
          await page.getByTestId(id).click({ ...opts, timeout: 5_000 }).catch(rethrowIfFatal)
          const took = await stageTabPressed(page, id)
          if (!took) {
            await page.getByTestId(id).click({ force: true, timeout: 5_000 }).catch(rethrowIfFatal)
            const tookForced = await stageTabPressed(page, id)
            console.log(`[walker] stage switch to ${plan.stage}: ${tookForced ? 'took after force' : 'DID NOT TAKE'}`)
          }
        }
      }
      break
    case 'resizeWindow':
      if (plan.size) await resize(app, plan.size).catch(() => {})
      break
    case 'reopenProject':
      await reopenProject(page, tmpPath).catch(rethrowIfFatal)
      break
  }
  await runFollowUp(page, plan)
}

async function typeJunk(page: Page, target: ReturnType<typeof locFor> | null, text: string): Promise<void> {
  if (!target) {
    await page.keyboard.type(text.slice(0, 100))
    return
  }
  await target.click({ force: true, timeout: ACTION_TIMEOUT_MS }).catch(() => {})
  // fill() sets the value directly but throws on a number field fed letters --
  // fall back to typing the characters the field will accept.
  try {
    await target.fill(text, { timeout: ACTION_TIMEOUT_MS })
  } catch {
    await page.keyboard.type(text.slice(0, 100)).catch(() => {})
  }
}

async function doWheel(page: Page, plan: ActionPlan, keyMap: Map<string, Candidate>): Promise<void> {
  const centre = plan.targetKey ? await centreOf(page, plan.targetKey, keyMap) : { x: 400, y: 300 }
  if (centre) await page.mouse.move(centre.x, centre.y)
  const mods = plan.modifiers ?? []
  for (const m of mods) await page.keyboard.down(m)
  try {
    await page.mouse.wheel(0, plan.deltaY ?? 0)
  } finally {
    for (const m of mods) await page.keyboard.up(m)
  }
}

async function doDrag(page: Page, plan: ActionPlan, keyMap: Map<string, Candidate>): Promise<void> {
  const a = plan.targetKey ? await centreOf(page, plan.targetKey, keyMap) : null
  const b = plan.secondaryKey ? await centreOf(page, plan.secondaryKey, keyMap) : null
  if (!a || !b) return
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 8 })
  await page.mouse.up()
}

/** A pseudo-random canvas gesture, made deterministic by (seed, step). */
async function doCanvas(
  page: Page,
  plan: ActionPlan,
  keyMap: Map<string, Candidate>,
  seed: number,
  step: number,
): Promise<void> {
  if (!plan.targetKey) return
  const live = await locFor(page, plan.targetKey)
    .boundingBox()
    .catch(() => null)
  const fallback = keyMap.get(plan.targetKey)?.box
  const box = live
    ? { x: live.x, y: live.y, w: live.width, h: live.height }
    : fallback
      ? { x: fallback.x, y: fallback.y, w: fallback.w, h: fallback.h }
      : null
  if (!box) return
  const rng = mulberry32(mixSeed(seed, step) ^ 0x5bd1e995)
  const px = (): number => box.x + Math.max(2, Math.min(box.w - 2, box.w * (0.15 + 0.7 * rng())))
  const py = (): number => box.y + Math.max(2, Math.min(box.h - 2, box.h * (0.15 + 0.7 * rng())))
  const kinds = ['left', 'right', 'double', 'drag', 'shiftDrag'] as const
  const kind = kinds[Math.min(kinds.length - 1, Math.floor(rng() * kinds.length))]
  const x1 = px()
  const y1 = py()
  if (kind === 'left') await page.mouse.click(x1, y1)
  else if (kind === 'right') await page.mouse.click(x1, y1, { button: 'right' })
  else if (kind === 'double') await page.mouse.dblclick(x1, y1)
  else {
    if (kind === 'shiftDrag') await page.keyboard.down('Shift')
    await page.mouse.move(x1, y1)
    await page.mouse.down()
    await page.mouse.move(px(), py(), { steps: 6 })
    await page.mouse.up()
    if (kind === 'shiftDrag') await page.keyboard.up('Shift')
  }
}

async function resize(app: ElectronApplication, size: { width: number; height: number }): Promise<void> {
  await app.evaluate(({ BrowserWindow }, s) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    win.setBounds({ x: 0, y: 0, width: s.width, height: s.height })
  }, size)
}

/** Close-and-reopen: reload to Welcome, click the recent entry again. */
async function reopenProject(page: Page, tmpPath: string): Promise<void> {
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await page
    .getByTestId('welcome-screen')
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => {})
  await page
    .getByTestId(`welcome-recent-entry-${tmpPath}`)
    .click({ timeout: 10_000 })
    .catch(() => {})
  await page
    .getByRole('navigation', { name: 'Workflow stages' })
    .waitFor({ state: 'visible', timeout: 60_000 })
    .catch(() => {})
}

/** The novice tail after the main action. */
async function runFollowUp(page: Page, plan: ActionPlan): Promise<void> {
  switch (plan.followUp) {
    case 'undo':
      await page.keyboard.press('Control+z').catch(() => {})
      break
    case 'redo':
      await page.keyboard.press('Control+Shift+z').catch(() => {})
      break
    case 'escape':
      await page.keyboard.press('Escape').catch(() => {})
      break
    case 'enter':
      await page.keyboard.press('Enter').catch(() => {})
      break
    default:
      break
  }
}

/** Whether the stage tab with this testid is the pressed (active) one right now. */
async function stageTabPressed(page: Page, testid: string): Promise<boolean> {
  await page.waitForTimeout(300)
  return page
    .evaluate(
      (id: string) => document.querySelector(`[data-testid="${id}"]`)?.getAttribute('aria-pressed') === 'true',
      testid,
    )
    .catch(() => false)
}
