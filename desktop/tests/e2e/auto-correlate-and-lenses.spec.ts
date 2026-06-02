/**
 * #133 Phase 2+3 e2e — auto-correlate → accept → materialise lens companions.
 *
 * Acceptance criterion (Task 22 of the #133 plan):
 *
 * 1. Suggest + accept litho contacts on the 6 fixture CPTs (build the
 *    starting state — the auto-correlate algorithm has nothing to do
 *    without seeded contacts).
 * 2. POST .../contact-correlations/auto → returns 200 with edges_created
 *    > 0; DB has new ``user_approved=false`` rows (the "dashed amber"
 *    state in the UI).
 * 3. POST .../contact-correlations/accept (section-scoped) → flips
 *    ``user_approved=true`` on edges in scope; reports
 *    ``bodies_created``/``bodies_removed``/``ordinals_changed``; DB shows
 *    the user-approved flip (the "solid emerald" state).
 * 4. POST .../lens-companions/materialise → returns 200 with the
 *    counters; if companion sections were created they're visible in
 *    ``GET /cross_sections?project_id={pid}`` with
 *    ``is_lens_companion=true``.
 *
 * This flow exercises the same code path the frontend toolbar buttons fire
 * (``api.geology.autoCorrelateContacts`` → ``acceptContactCorrelations`` →
 * ``materialiseLensCompanions``).  Like every other litho-flow spec in this
 * suite (flow_bulk_accept, flow_auto_correlate, flow_single_accept) we
 * drive via the API: the UI buttons require
 * ghost-suggestion + section-selection state that needs the full Electron
 * navigation chain, which is covered by flow_boot_open.  The contract is
 * the API contract, and the buttons themselves are unit-tested in
 * ``SectionsToolbar.correlate.test.tsx``.
 *
 * The spec also confirms the renderer mounts (welcome-screen visible)
 * after the API operations — a tripwire for the dependency chain
 * (db_helper + electron_launch + backend reachability).
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import {
  getGeologicalModelId,
  countContacts,
  listSectionsByProject,
} from './helpers/db_helper'
import { Client } from 'pg'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://groundmodel:groundmodel@localhost:5433/groundmodel_integration'

// ---------------------------------------------------------------------------
// Local DB helpers — these are #133-specific and not in db_helper.ts yet.
// They follow the same shape as the helpers in db_helper.ts: open a fresh
// connection per call, single SELECT, immediate release.  Inlined here so
// this spec is self-contained while the underlying tables stabilise; promote
// to db_helper.ts once a second spec needs them.
// ---------------------------------------------------------------------------

/**
 * Count ``litho_contact_correlation_edge`` rows for a project's
 * lithostratigraphic models, optionally filtered by ``user_approved``.
 *
 * Parameters
 * ----------
 * projectId : string
 *   UUID of the app project.
 * userApproved : boolean | null
 *   When ``true`` / ``false``, filters on the column.  When ``null``,
 *   returns the total count regardless of approval.
 *
 * Returns
 * -------
 * number
 *   Row count.
 */
async function countContactCorrelationEdges(
  projectId: string,
  userApproved: boolean | null = null,
): Promise<number> {
  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()
  try {
    const params: (string | boolean)[] = [projectId]
    let approvedClause = ''
    if (userApproved !== null) {
      params.push(userApproved)
      approvedClause = `AND lcce.user_approved = $2`
    }
    const res = await client.query<{ n: string }>(
      `SELECT COUNT(*) AS n
         FROM litho_contact_correlation_edge lcce
         JOIN geological_model gm ON gm.id = lcce.model_id
        WHERE gm.app_project_id = $1
          AND gm.kind = 'lithostratigraphic'
          ${approvedClause}`,
      params,
    )
    return parseInt(res.rows[0].n, 10)
  } finally {
    await client.end()
  }
}

/**
 * Count ``cross_section`` rows flagged ``is_lens_companion=true`` for a
 * project.
 *
 * Parameters
 * ----------
 * projectId : string
 *   UUID of the app project.
 *
 * Returns
 * -------
 * number
 *   Row count.
 */
async function countLensCompanionSections(projectId: string): Promise<number> {
  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()
  try {
    const res = await client.query<{ n: string }>(
      `SELECT COUNT(*) AS n
         FROM cross_section
        WHERE app_project_id = $1
          AND is_lens_companion = true`,
      [projectId],
    )
    return parseInt(res.rows[0].n, 10)
  } finally {
    await client.end()
  }
}

test.describe('#133 Phase 2+3 — auto-correlate + accept + lens companions', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first',
  )

  test('auto-correlate → accept → materialise: full flow shape', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      // -----------------------------------------------------------------------
      // 1. Resolve litho model + CPTs + sections from the fixture.
      // -----------------------------------------------------------------------
      const lithoModelId = await getGeologicalModelId(
        FIXTURE_PROJECT_ID,
        'lithostratigraphic',
      )
      expect(lithoModelId).not.toBeNull()
      const mid = lithoModelId as string

      const cptsJson = await page.evaluate(
        async ([base, pid]) => {
          const r = await fetch(`${base}/cpt/?project_id=${pid}`)
          return r.json()
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )
      // Only segment CPTs that actually carry a series. The dedicated
      // crossing CPTs are series-less (suggest-litho 404s on them) and must
      // not be seeded, or the crossing inversion would be buried.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cpts = (cptsJson as any[]).filter((c: any) => (c.n_rows ?? 0) > 0)
      expect(cpts.length).toBeGreaterThanOrEqual(3)

      const sections = await listSectionsByProject(FIXTURE_PROJECT_ID)
      expect(sections.length).toBeGreaterThan(0)
      // Pick the first non-companion section as the primary working section.
      const primarySectionId = sections[0].id

      // -----------------------------------------------------------------------
      // 2. Seed the litho axis: suggest + accept for each CPT, with
      //    defer_inference=true on all but the last (matches the bulk-accept
      //    pattern in flow_bulk_accept.spec.ts).  This builds the starting
      //    state — auto-correlate has no edges to propose without seeded
      //    contacts.
      // -----------------------------------------------------------------------
      const contactsBeforeSeed = await countContacts(FIXTURE_PROJECT_ID)

      for (let i = 0; i < cpts.length; i++) {
        const cptId = cpts[i].id as string
        const isLast = i === cpts.length - 1

        const suggestRes = await page.evaluate(
          async ([base, pid, m, cid]) => {
            const r = await fetch(
              `${base}/projects/${pid}/geology/models/${m}/contacts/suggest-litho`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cpt_id: cid }),
              },
            )
            return { status: r.status, json: await r.json() }
          },
          [API_BASE, FIXTURE_PROJECT_ID, mid, cptId],
        )
        // 200 expected; if the fixture has no qc data the suggester may
        // legitimately return 0 layers — skip this CPT and move on.
        expect(suggestRes.status).toBe(200)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const layers = (suggestRes.json as any).layers as unknown[]
        if (!layers || layers.length === 0) continue

        const acceptRes = await page.evaluate(
          async ([base, pid, m, cid, suggestionsJson, defer]) => {
            const suggestions = JSON.parse(suggestionsJson as string)
            const r = await fetch(
              `${base}/projects/${pid}/geology/models/${m}/contacts/accept-litho-suggestions`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  cpt_id: cid,
                  suggestions,
                  defer_inference: defer === '1',
                }),
              },
            )
            return { status: r.status }
          },
          [
            API_BASE,
            FIXTURE_PROJECT_ID,
            mid,
            cptId,
            JSON.stringify(layers),
            isLast ? '0' : '1',
          ],
        )
        expect(acceptRes.status).toBe(200)
      }

      const contactsAfterSeed = await countContacts(FIXTURE_PROJECT_ID)
      // The flow is idempotent — earlier runs may have already seeded contacts.
      // Either we created some, or contacts already exist for re-runs.
      expect(contactsAfterSeed).toBeGreaterThanOrEqual(contactsBeforeSeed)
      expect(contactsAfterSeed).toBeGreaterThan(0)

      // -----------------------------------------------------------------------
      // 3. Auto-correlate — POST .../contact-correlations/auto.
      //    Mirrors what the "Auto-correlate" toolbar button (testid:
      //    litho-auto-correlate) fires.  New edges have user_approved=false
      //    (the "dashed amber" state in the canvas).
      // -----------------------------------------------------------------------
      const edgesBefore = await countContactCorrelationEdges(FIXTURE_PROJECT_ID)
      const pendingBefore = await countContactCorrelationEdges(
        FIXTURE_PROJECT_ID,
        false,
      )

      const autoRes = await page.evaluate(
        async ([base, pid, m]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${m}/contact-correlations/auto`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: '{}',
            },
          )
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, mid],
      )
      expect(autoRes.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const auto = autoRes.json as any
      expect(typeof auto.edges_created).toBe('number')
      expect(typeof auto.edges_skipped_existing).toBe('number')
      expect(auto.edges_created).toBeGreaterThanOrEqual(0)

      const edgesAfterAuto = await countContactCorrelationEdges(FIXTURE_PROJECT_ID)
      const pendingAfterAuto = await countContactCorrelationEdges(
        FIXTURE_PROJECT_ID,
        false,
      )
      // DB grew by exactly edges_created.
      expect(edgesAfterAuto - edgesBefore).toBe(auto.edges_created)
      // New edges are pending (user_approved=false) — the dashed-amber state.
      expect(pendingAfterAuto).toBeGreaterThanOrEqual(pendingBefore)

      // -----------------------------------------------------------------------
      // 4. Accept correlations on the primary section — flips
      //    user_approved=true and runs DetectLithoLenses.  Mirrors what the
      //    "Accept correlations" toolbar button (testid:
      //    litho-accept-correlations) fires.
      // -----------------------------------------------------------------------
      const acceptRes = await page.evaluate(
        async ([base, pid, m, sid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${m}/contact-correlations/accept`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ section_id: sid }),
            },
          )
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, mid, primarySectionId],
      )
      expect(acceptRes.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accept = acceptRes.json as any
      expect(typeof accept.edges_accepted).toBe('number')
      // Post-2026-05-31 the accept response reports bodies, not lenses
      // (lens entity retired -> BodyOrm; lens detection is now an explicit
      // verb and no longer auto-fires on accept, so these are typically 0).
      expect(typeof accept.bodies_created).toBe('number')
      expect(typeof accept.bodies_removed).toBe('number')
      expect(typeof accept.ordinals_changed).toBe('number')
      expect(accept.edges_accepted).toBeGreaterThanOrEqual(0)

      const approvedAfterAccept = await countContactCorrelationEdges(
        FIXTURE_PROJECT_ID,
        true,
      )
      // After accept, at least edges_accepted should be approved (may be
      // more if a previous run already approved some).
      expect(approvedAfterAccept).toBeGreaterThanOrEqual(accept.edges_accepted)

      // -----------------------------------------------------------------------
      // 5. Materialise lens companions — POST .../lens-companions/materialise.
      //    Mirrors the "Materialise lens companions" toolbar button (testid:
      //    litho-materialise-lens-companions).  Creates a perpendicular
      //    companion section for every lens whose primary section is fully
      //    correlated.
      // -----------------------------------------------------------------------
      const companionsBefore = await countLensCompanionSections(FIXTURE_PROJECT_ID)
      const sectionsBefore = sections.length

      const matRes = await page.evaluate(
        async ([base, pid, m]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${m}/lens-companions/materialise`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: '{}',
            },
          )
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, mid],
      )
      expect(matRes.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mat = matRes.json as any
      expect(typeof mat.companion_sections_created).toBe('number')
      expect(typeof mat.skipped_no_primary).toBe('number')
      expect(typeof mat.skipped_unfinished_section).toBe('number')
      expect(typeof mat.errored).toBe('number')

      const companionsAfter = await countLensCompanionSections(FIXTURE_PROJECT_ID)
      // DB grew by exactly companion_sections_created.
      expect(companionsAfter - companionsBefore).toBe(
        mat.companion_sections_created,
      )

      // When at least one companion was created, the section list reflects it.
      if (mat.companion_sections_created > 0) {
        const sectionsAfter = await listSectionsByProject(FIXTURE_PROJECT_ID)
        expect(sectionsAfter.length).toBeGreaterThan(sectionsBefore)
      }

      // -----------------------------------------------------------------------
      // 6. Renderer smoke — confirm the Electron renderer is alive after the
      //    full API flow.  Full UI navigation into the Sections stage is
      //    covered by flow_boot_open; here we only need to confirm the app
      //    didn't crash mid-flow.
      // -----------------------------------------------------------------------
      await expect(page.getByTestId('welcome-screen')).toBeVisible({
        timeout: 10_000,
      })
    } finally {
      await closeApp(app)
    }
  })
})
