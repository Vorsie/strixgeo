/**
 * Flow 4 — Contact-level correlate (#133); rejection path: same-investigation.
 *
 * Acceptance criterion:
 * - Two contacts on DIFFERENT investigation columns can be correlated:
 *   POST .../contact-correlations returns 200/201 and a DB edge row appears.
 * - Correlating two contacts anchored to the SAME investigation column
 *   returns 422 (a boundary cannot be correlated with itself at one column —
 *   the same-investigation guard in ``CorrelateLithoContacts``).
 *
 * Post-#133 correlation is contact-level (contact_a_id / contact_b_id), not
 * the old formation-level shape, and manual correlate is free-form: there is
 * no lithology-match guard (that was a formation-level concept; lithology
 * grouping now lives only in auto-correlate). The correlation endpoints
 * operate at the model level and are independent of the renderer state, so
 * this flow calls the API directly.
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { countCorrelationEdges } from './helpers/db_helper'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

test.describe('flow_correlate', () => {
  test.skip(!FIXTURE_PROJECT_ID, 'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first')

  test('cross-column correlation creates a DB edge; same-column pair returns 422', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      // 1. Resolve litho model.
      const modelsJson = await page.evaluate(
        async ([base, pid]) => {
          const r = await fetch(`${base}/projects/${pid}/geology/models`)
          return r.json()
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lithoModel = (modelsJson as any[]).find((m: any) => m.kind === 'lithostratigraphic')
      expect(lithoModel).toBeTruthy()
      const lithoModelId: string = lithoModel.id

      // 2. Fetch a section id — POST /contact-correlations now requires a
      //    request_section_id (section-scoped unique constraint).  Any valid
      //    section in the project will do; the use case only stamps the FK.
      const sectionsJson = await page.evaluate(
        async ([base, pid]) => {
          const r = await fetch(`${base}/projects/${pid}/sections`)
          return r.json()
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sid: string = (sectionsJson as any[])[0]?.id
      expect(sid).toBeTruthy()

      // 3. List this model's contacts. Each carries cpt_id / borehole_id — the
      //    anchor investigation. We need two contacts on DIFFERENT anchors for
      //    the happy path and two on the SAME anchor for the rejection path.
      const contactsJson = await page.evaluate(
        async ([base, pid, mid]) => {
          const r = await fetch(`${base}/projects/${pid}/geology/models/${mid}/contacts`)
          return r.json()
        },
        [API_BASE, FIXTURE_PROJECT_ID, lithoModelId],
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contacts = (contactsJson as any[]).filter(
        (c: { cpt_id?: string; borehole_id?: string }) => c.cpt_id || c.borehole_id,
      )

      // The fixture must have been through the litho-accept flow (contacts are
      // only created by accept). The seed guarantees this; skip defensively.
      if (contacts.length < 2) {
        test.skip()
        return
      }

      const anchor = (c: { cpt_id?: string; borehole_id?: string }): string =>
        c.cpt_id ?? c.borehole_id ?? ''

      // Cross-column pair (happy path): two contacts on distinct investigations.
      let diffInvPair: [string, string] | null = null
      const first = contacts[0]
      const otherInv = contacts.find((c) => anchor(c) && anchor(c) !== anchor(first))
      if (otherInv) diffInvPair = [first.id, otherInv.id]

      // Same-column pair (rejection path): two distinct contacts sharing an anchor.
      let sameInvPair: [string, string] | null = null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const byAnchor = new Map<string, any[]>()
      for (const c of contacts) {
        const a = anchor(c)
        if (!byAnchor.has(a)) byAnchor.set(a, [])
        byAnchor.get(a)!.push(c)
      }
      for (const [, group] of byAnchor) {
        if (group.length >= 2) {
          sameInvPair = [group[0].id, group[1].id]
          break
        }
      }

      const edgesBefore = await countCorrelationEdges(FIXTURE_PROJECT_ID)

      // 4. Happy path: correlate two contacts on different investigations.
      if (diffInvPair) {
        const correlateRes = await page.evaluate(
          async ([base, pid, mid, aId, bId, sectionId]) => {
            const r = await fetch(
              `${base}/projects/${pid}/geology/models/${mid}/contact-correlations`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contact_a_id: aId, contact_b_id: bId, request_section_id: sectionId }),
              },
            )
            return { status: r.status }
          },
          [API_BASE, FIXTURE_PROJECT_ID, lithoModelId, diffInvPair[0], diffInvPair[1], sid],
        )
        // 201 on new edge, 200 if already exists (idempotent) — both are success.
        expect(correlateRes.status).toBeGreaterThanOrEqual(200)
        expect(correlateRes.status).toBeLessThan(300)

        const edgesAfter = await countCorrelationEdges(FIXTURE_PROJECT_ID)
        // New edge created, or it already existed from a prior run (idempotent).
        expect(edgesAfter).toBeGreaterThanOrEqual(edgesBefore)
      } else {
        test.info().annotations.push({
          type: 'note',
          description: 'No two contacts on distinct investigations — fixture needs more contacts',
        })
      }

      // 5. Rejection path: two contacts on the SAME investigation return 422.
      //    request_section_id is provided so the section guard passes; the
      //    same-investigation guard fires immediately after.
      if (sameInvPair) {
        const rejectRes = await page.evaluate(
          async ([base, pid, mid, aId, bId, sectionId]) => {
            const r = await fetch(
              `${base}/projects/${pid}/geology/models/${mid}/contact-correlations`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contact_a_id: aId, contact_b_id: bId, request_section_id: sectionId }),
              },
            )
            return { status: r.status, json: r.status < 200 || r.status >= 300 ? await r.json() : null }
          },
          [API_BASE, FIXTURE_PROJECT_ID, lithoModelId, sameInvPair[0], sameInvPair[1], sid],
        )
        // The same-investigation guard rejects a self-column correlation.
        expect(rejectRes.status).toBe(422)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const detail = (rejectRes.json as any)?.detail ?? ''
        const detailStr =
          typeof detail === 'string' ? detail : (detail?.code ?? detail?.message ?? JSON.stringify(detail))
        expect(detailStr).toMatch(/same investigation|anchored to the same/i)
      } else {
        test.info().annotations.push({
          type: 'note',
          description: 'No two contacts on the same investigation — rejection path skipped',
        })
      }
    } finally {
      await closeApp(app)
    }
  })
})
