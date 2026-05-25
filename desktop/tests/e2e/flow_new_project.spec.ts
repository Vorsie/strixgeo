/**
 * Flow A — New project creation.
 *
 * Acceptance criteria (debt #130):
 * - Welcome screen renders on boot.
 * - POST /projects creates a project row in the DB.
 * - The project name input and submit button carry the expected testids.
 * - Submitting with an empty name: no new project row is created (the
 *   button is disabled — enforced by the ``!name.trim()`` guard in
 *   WelcomeScreen / NewProjectDialog; a direct empty-name POST returns
 *   422 from the backend).
 *
 * Regression anchor: if the ``welcome-new-project-button`` testid is
 * removed the selector assertion fails, catching a testid regression in
 * the same commit.
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { countProjects, getProjectByName } from './helpers/db_helper'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

test.describe('flow_new_project', () => {
  test.skip(!FIXTURE_PROJECT_ID, 'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first')

  test('welcome screen renders with expected testids', async () => {
    const { app, page } = await launchApp({
      E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID,
    })

    try {
      // 1. Welcome screen must be visible on boot.
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })

      // 2. Key interactive elements carry the testids the flows rely on.
      //    The project-name input is in the WelcomeScreen body (NOT a separate dialog).
      await expect(page.getByTestId('welcome-project-name-input')).toBeVisible()
      await expect(page.getByTestId('welcome-new-project-button')).toBeVisible()
      await expect(page.getByTestId('welcome-open-button')).toBeVisible()

      // 3. The new-project button is disabled when the name input is empty
      //    (WelcomeScreen guards: ``disabled={!name.trim() || busy}``).
      const createBtn = page.getByTestId('welcome-new-project-button')
      await expect(createBtn).toBeDisabled()
    } finally {
      await closeApp(app)
    }
  })

  test('POST /projects creates a project; empty-name POST returns 422', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      const projectsBefore = await countProjects()

      // 1. Happy path — create a project via the API (same path as
      //    the frontend's ``api.project.create`` in useProject.newProject).
      const name = `E2E-NewProject-${Date.now()}`
      const createRes = await page.evaluate(
        async ([base, projectName]) => {
          const r = await fetch(`${base}/projects`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: projectName }),
          })
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, name],
      )
      expect(createRes.status).toBe(201)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const created = createRes.json as any
      expect(created.id).toBeTruthy()
      expect(created.name).toBe(name)

      // 2. DB has grown by exactly one row.
      const projectsAfter = await countProjects()
      expect(projectsAfter).toBe(projectsBefore + 1)

      // 3. The row is discoverable by name.
      const row = await getProjectByName(name)
      expect(row).not.toBeNull()
      expect(row!.id).toBe(created.id)

      // 4. Clean up — archive the test project so it doesn't pollute
      //    future runs (countProjects uses archived_at IS NULL).
      await page.evaluate(
        async ([base, pid]) => {
          await fetch(`${base}/projects/${pid}/archive`, { method: 'POST' })
        },
        [API_BASE, created.id],
      )

      // 5. Rejection path — empty name returns 422 (backend validation:
      //    ``name`` is a non-empty string field in ``ProjectCreatePayload``).
      //    This mirrors what happens when ``!name.trim()`` slips past the
      //    UI gate (e.g. whitespace-only input).
      const emptyRes = await page.evaluate(
        async ([base]) => {
          const r = await fetch(`${base}/projects`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: '' }),
          })
          return { status: r.status }
        },
        [API_BASE],
      )
      expect(emptyRes.status).toBe(422)

      // 6. Whitespace-only name also rejected (same backend validation).
      const wsRes = await page.evaluate(
        async ([base]) => {
          const r = await fetch(`${base}/projects`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: '   ' }),
          })
          return { status: r.status }
        },
        [API_BASE],
      )
      expect(wsRes.status).toBe(422)

      // 7. Project count is still projectsBefore + 1 after the rejected attempts
      //    (no extra rows were created) AND the archived project is gone.
      //    Note: archive fires asynchronously above; we already confirmed create
      //    gave +1 and the empties gave 422.  The archived project brought the
      //    count back to projectsBefore — verify it.
      const projectsAfterArchive = await countProjects()
      expect(projectsAfterArchive).toBe(projectsBefore)
    } finally {
      await closeApp(app)
    }
  })
})
