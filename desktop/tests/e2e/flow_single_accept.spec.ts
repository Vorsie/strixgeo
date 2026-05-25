/**
 * Flow 2 — Single-anchor litho suggest + accept.
 *
 * Acceptance criterion (debt #128):
 * - POST suggest-litho for one CPT returns ≥1 suggestion layers.
 * - POST accept-litho-suggestions returns 200 with contact ids.
 * - DB has a new contact row after accept.
 *
 * This flow tests the basic accept path (single anchor, no defer_inference)
 * which is the building block the bulk flow composes from.
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { countContacts } from './helpers/db_helper'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

test.describe('flow_single_accept', () => {
  test.skip(!FIXTURE_PROJECT_ID, 'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first')

  test('suggest + accept one CPT, contact appears in DB', async () => {
    const { app, page } = await launchApp()

    try {
      // Wait for the app to be responsive.
      await page.waitForLoadState('domcontentloaded')

      // 1. Resolve litho model + one CPT id from the fixture.
      const modelsRes = await page.evaluate(
        async ([base, pid]) => {
          const r = await fetch(`${base}/projects/${pid}/geology/models`)
          return r.json()
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lithoModel = (modelsRes as any[]).find((m: any) => m.kind === 'lithostratigraphic')
      expect(lithoModel).toBeTruthy()
      const lithoModelId: string = lithoModel.id

      const cptsRes = await page.evaluate(
        async ([base, pid]) => {
          const r = await fetch(`${base}/projects/${pid}/cpts`)
          return r.json()
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((cptsRes as any[]).length).toBeGreaterThan(0)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cptId: string = (cptsRes as any[])[0].id

      // 2. Request suggestions for this CPT.
      const suggestRes = await page.evaluate(
        async ([base, pid, mid, cid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/contacts/suggest-litho`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cpt_id: cid }),
            },
          )
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, lithoModelId, cptId],
      )
      expect(suggestRes.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const suggestions = (suggestRes.json as any).layers
      expect(suggestions.length).toBeGreaterThan(0)

      // 3. Accept all suggestions for this CPT (single anchor, with inference).
      const contactsBefore = await countContacts(FIXTURE_PROJECT_ID)

      const acceptRes = await page.evaluate(
        async ([base, pid, mid, cid, suggestionsJson]) => {
          const suggestions = JSON.parse(suggestionsJson as string)
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/contacts/accept-litho-suggestions`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                cpt_id: cid,
                suggestions,
                defer_inference: false,
              }),
            },
          )
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, lithoModelId, cptId, JSON.stringify(suggestions)],
      )
      expect(acceptRes.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const created: string[] = (acceptRes.json as any).created_contact_ids ?? []
      expect(created.length).toBeGreaterThan(0)

      // 4. DB has more contacts than before.
      const contactsAfter = await countContacts(FIXTURE_PROJECT_ID)
      expect(contactsAfter).toBeGreaterThan(contactsBefore)
    } finally {
      await closeApp(app)
    }
  })
})
