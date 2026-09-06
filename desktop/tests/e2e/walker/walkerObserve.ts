/**
 * The walker's observation helpers (Playwright side).
 *
 * Everything the orchestrator reads back from the running app each step: the
 * live interactive DOM (for the policy), the current stage, an error toast, the
 * section / contact row ids to cross-check against the server, and a
 * responsiveness heartbeat. The pure invariant checks live in walkerInvariants;
 * these functions only GATHER, so they stay out of walker.spec.ts.
 */

import type { Page } from '@playwright/test'

import { checkEmptyView, checkPhantomRows, type Finding } from './walkerInvariants'
import { SPINE_STAGES } from './walkerPolicy'
import type { Candidate, SpineLabel } from './walkerTypes'

export const API_BASE = 'http://127.0.0.1:8765'
const MAX_CANDIDATES = 250
const HEARTBEAT_TIMEOUT_MS = 5000

const STAGE_TESTID = new Map<SpineLabel, string>(SPINE_STAGES.map(s => [s.label, s.testid]))
const TESTID_STAGE = new Map<string, SpineLabel>(SPINE_STAGES.map(s => [s.testid, s.label]))

/** Which stage tab is currently pressed, or null. */
export async function detectCurrentStage(page: Page): Promise<SpineLabel | null> {
  const id = await page
    .evaluate(() => {
      const el = document.querySelector('[data-testid^="stage-tab-"][aria-pressed="true"]')
      return el?.getAttribute('data-testid') ?? null
    })
    .catch(() => null)
  return id ? (TESTID_STAGE.get(id) ?? null) : null
}

/**
 * Discover the live interactive DOM. Stamps ``data-walker-target`` markers so
 * the executor can re-locate each element, and reports whether a menu / modal
 * is open. Runs entirely in the browser (a self-contained evaluate).
 */
export async function discover(page: Page): Promise<{ candidates: Candidate[]; openMenu: boolean }> {
  return page
    .evaluate((cap: number) => {
      const SEL = [
        'button', '[role="button"]', 'a[href]', 'input:not([type="hidden"])', 'select', 'textarea',
        '[role="menuitem"]', '[role="tab"]', '[role="radio"]', '[role="checkbox"]', '[role="switch"]',
        '[role="option"]', '[contenteditable=""]', '[contenteditable="true"]', 'canvas',
        '[data-testid]', 'summary', '[tabindex]:not([tabindex="-1"])',
      ].join(',')
      // Drop any previous markers so keys never collide across steps.
      document.querySelectorAll('[data-walker-target]').forEach(el => el.removeAttribute('data-walker-target'))

      const vw = window.innerWidth
      const vh = window.innerHeight
      const seen = new Set<Element>()
      const out: Array<Record<string, unknown>> = []
      let i = 0
      for (const el of Array.from(document.querySelectorAll(SEL))) {
        if (seen.has(el)) continue
        seen.add(el)
        if (out.length >= cap) break
        const rect = el.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) continue
        if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) continue
        const style = window.getComputedStyle(el)
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue

        const tag = el.tagName.toLowerCase()
        const role = el.getAttribute('role')
        const type = el.getAttribute('type')
        let kind = 'generic'
        if (tag === 'canvas') kind = 'canvas'
        else if (tag === 'select') kind = 'select'
        else if (tag === 'textarea') kind = 'input'
        else if (tag === 'input') kind = type === 'checkbox' || type === 'radio' ? 'checkbox' : 'input'
        else if (role === 'checkbox' || role === 'switch' || role === 'radio') kind = 'checkbox'
        else if (role === 'menuitem' || role === 'option') kind = 'menuitem'
        else if (tag === 'a') kind = 'link'
        else if (tag === 'button' || role === 'button') kind = 'button'

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const value = (el as any).value
        const text = String(el.textContent || el.getAttribute('aria-label') || value || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 60)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const disabled = Boolean((el as any).disabled) || el.getAttribute('aria-disabled') === 'true'

        const key = `wt:${i++}`
        el.setAttribute('data-walker-target', key)
        out.push({
          key,
          testid: el.getAttribute('data-testid'),
          role,
          tag,
          text,
          enabled: !disabled,
          kind,
          box: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        })
      }
      const menu = document.querySelector('[role="menu"], [role="dialog"], [role="alertdialog"]')
      const openMenu = menu !== null && (menu as HTMLElement).getClientRects().length > 0
      return { candidates: out, openMenu }
    }, MAX_CANDIDATES)
    .then(r => r as unknown as { candidates: Candidate[]; openMenu: boolean })
    .catch(() => ({ candidates: [], openMenu: false }))
}

/** An error (red, sticky) toast on screen is a finding. */
export async function checkErrorToast(page: Page, step: number): Promise<Finding[]> {
  const text = await page
    .evaluate(() => {
      // Only error toasts get the dismiss button (useToasts: sticky = error).
      const btn = document.querySelector('[data-testid="toast-dismiss"]')
      if (!btn) return null
      return (btn.parentElement?.textContent ?? 'error toast').replace(/\s+/g, ' ').trim().slice(0, 200)
    })
    .catch(() => null)
  if (text === null) return []
  return [{ step, invariant: 'error-toast', detail: text }]
}

/** Section rows on screen vs GET /sections: phantom + empty view. */
export async function checkSectionRows(page: Page, projectId: string, step: number): Promise<Finding[]> {
  const apiIds = await page
    .evaluate(
      async ([base, pid]) => {
        try {
          const r = await fetch(`${base}/projects/${pid}/sections`)
          if (!r.ok) return null
          const list = (await r.json()) as Array<{ id: string }>
          return list.map(s => s.id)
        } catch {
          return null
        }
      },
      [API_BASE, projectId] as const,
    )
    .catch(() => null)
  if (apiIds === null) return []
  const domIds = await domIdsFor(page, 'section-row-')
  return [
    ...checkPhantomRows('section', domIds, apiIds, step),
    ...checkEmptyView('section', domIds.length, apiIds.length, true, step),
  ]
}

/** Contact lines on the canvas vs the union of every model's contacts (phantom). */
export async function checkContactRows(page: Page, projectId: string, step: number): Promise<Finding[]> {
  const apiIds = await page
    .evaluate(
      async ([base, pid]) => {
        try {
          const mr = await fetch(`${base}/projects/${pid}/geology/models`)
          if (!mr.ok) return null
          const models = (await mr.json()) as Array<{ id: string }>
          const ids: string[] = []
          for (const m of models) {
            const cr = await fetch(`${base}/projects/${pid}/geology/models/${m.id}/contacts`)
            if (!cr.ok) continue
            const contacts = (await cr.json()) as Array<{ id: string }>
            for (const c of contacts) ids.push(c.id)
          }
          return ids
        } catch {
          return null
        }
      },
      [API_BASE, projectId] as const,
    )
    .catch(() => null)
  if (apiIds === null) return []
  // contact-line-<id> is the rendered contact overlay (ContactsLayer).
  const domIds = await domIdsFor(page, 'contact-line-')
  return checkPhantomRows('contact', domIds, apiIds, step)
}

/** Extract the id suffix of every ``[data-testid^="<prefix>"]`` on screen. */
async function domIdsFor(page: Page, prefix: string): Promise<string[]> {
  return page
    .evaluate((p: string) => {
      const out: string[] = []
      for (const el of Array.from(document.querySelectorAll(`[data-testid^="${p}"]`))) {
        const id = (el.getAttribute('data-testid') ?? '').slice(p.length)
        if (id) out.push(id)
      }
      return out
    }, prefix)
    .catch(() => [])
}

/** Time a no-op click on the current stage tab; -1 when it never answered. */
export async function heartbeat(page: Page, stage: SpineLabel): Promise<number> {
  const testid = STAGE_TESTID.get(stage)
  if (!testid) return 0
  const t0 = Date.now()
  try {
    await page.getByTestId(testid).click({ timeout: HEARTBEAT_TIMEOUT_MS, force: true })
    await page.evaluate(() => 1)
    return Date.now() - t0
  } catch {
    return -1
  }
}

/** Fallback: pick the one project id that is not the synthetic fixture. */
export async function resolveProjectIdFallback(page: Page, syntheticId: string): Promise<string | null> {
  return page.evaluate(
    async ([base, synth]) => {
      try {
        const r = await fetch(`${base}/projects/`)
        if (!r.ok) return null
        const list = (await r.json()) as Array<{ id: string }>
        const other = list.map(p => p.id).filter(id => id !== synth)
        return other[0] ?? null
      } catch {
        return null
      }
    },
    [API_BASE, syntheticId] as const,
  )
}
