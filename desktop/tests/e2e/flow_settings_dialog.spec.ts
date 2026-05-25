/**
 * Flow E — Settings dialog + view_state round-trip.
 *
 * Acceptance criteria (debt #130):
 * - ``settings-dialog`` testid appears in the DOM when the dialog is
 *   open (wired via the ``testid`` prop on Modal).
 * - ``settings-section-litho`` / ``settings-section-sections`` /
 *   ``settings-section-appearance`` navigation tabs exist.
 * - ``settings-save-button`` is present inside the litho section.
 * - Litho segmenter prefs round-trip via
 *   PATCH /projects/{id}/view-state + GET /projects/{id}:
 *   the ``litho_segmenter.minimum_layer_thickness_m`` key survives.
 * - Rejection path: an out-of-range minimum_layer_thickness_m (50 m)
 *   is outside LITHO_SEGMENTER_BOUNDS.minimumLayerThicknessM.max (10.0),
 *   so the UI's Save button is disabled (``!allValid``).  We verify
 *   via the backend: the view-state PATCH succeeds for any JSON (it
 *   is a free JSONB merge), but the frontend validation gate is what
 *   prevents the out-of-range value from reaching the wire.  We verify
 *   the in-range value persists and the out-of-range one is rejected
 *   at the API-level validation for the ``suggest-litho`` endpoint
 *   (which enforces the 0.05–10.0 m backend range).
 *
 * Theme toggle:
 * - Changing the theme preference stores the value in localStorage (per
 *   ``useTheme``).  We read it back via ``page.evaluate`` to confirm
 *   the write.
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { getProjectViewState } from './helpers/db_helper'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

test.describe('flow_settings_dialog', () => {
  test.skip(!FIXTURE_PROJECT_ID, 'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first')

  test('settings-dialog testid and section-rail testids exist when dialog is rendered', async () => {
    const { app, page } = await launchApp({
      E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID,
    })

    try {
      await page.waitForLoadState('domcontentloaded')
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })

      // Before any dialog is open, the settings testid must be absent.
      const dialogBeforeOpen = await page.evaluate(
        () => document.querySelector('[data-testid="settings-dialog"]') !== null,
      )
      expect(dialogBeforeOpen).toBe(false)

      // Open Settings via the IPC signal the menu fires.
      await page.evaluate(() => {
        // The main process sends 'menu:open-settings' to the renderer
        // via win.webContents.send; the preload bridges it with
        // window.electron.onMenuOpenSettings.  In the Playwright harness
        // we simulate the signal by dispatching the Electron IPC event
        // the same way the renderer receives it.
        // Because the renderer is already running in the full Electron
        // context, we can trigger the signal directly via the preload
        // bridge exposed on window.electron.
        // The electron preload exposes a two-way IPC bridge: we use the
        // ipcRenderer.emit shim via the preload to fire the channel.
        // ``window.electron.send`` is not exposed; instead we trigger the
        // menu:open-settings signal via the existing ipcRenderer path
        // that the preload wires.  Since the welcome screen is shown
        // (no project), the SettingsDialog variant with ``hasProject=false``
        // will render (appearance-only sections are interactive).
        //
        // Trigger via the document keyboard shortcut listener wired in
        // App.tsx's useEffect.  Ctrl+, fires 'menu:open-settings' from the
        // main process.  We dispatch a native KeyboardEvent instead.
        const ctrl = new KeyboardEvent('keydown', {
          key: ',',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
        document.dispatchEvent(ctrl)
      })

      // Give the renderer a tick to process the event.
      await page.waitForTimeout(300)

      // If the keyboard shortcut opened the dialog, assert testids.
      // The shortcut goes through the Electron menu (main → renderer IPC),
      // which Playwright cannot trigger with a page.keyboard.press on
      // the renderer — it bypasses the OS menu layer.  We therefore use
      // app.evaluate to send the IPC message through the main process.
      await app.evaluate(({ ipcMain }) => {
        // Send the 'menu:open-settings' signal to the first BrowserWindow.
        const { BrowserWindow } = require('electron') as typeof import('electron')
        const win = BrowserWindow.getAllWindows()[0]
        if (win) win.webContents.send('menu:open-settings')
      })

      // Wait for the dialog to appear.
      await expect(page.getByTestId('settings-dialog')).toBeVisible({ timeout: 5_000 })

      // Section-rail tabs carry the testids specified in the task.
      await expect(page.getByTestId('settings-section-litho')).toBeVisible()
      await expect(page.getByTestId('settings-section-sections')).toBeVisible()
      await expect(page.getByTestId('settings-section-appearance')).toBeVisible()

      // Save button is present (disabled because ``hasProject=false`` on
      // the welcome-screen variant — no project is loaded).
      const saveBtn = page.getByTestId('settings-save-button')
      await expect(saveBtn).toBeVisible()
      await expect(saveBtn).toBeDisabled()
    } finally {
      await closeApp(app)
    }
  })

  test('litho segmenter prefs persist via PATCH /view-state + bundle round-trip', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      // 1. Patch an in-range minimum_layer_thickness_m (0.30 m) into
      //    the view_state (the exact key the frontend writes via
      //    buildLithoSegmenterPatch).
      const patchRes = await page.evaluate(
        async ([base, pid]) => {
          const r = await fetch(`${base}/projects/${pid}/view-state`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              litho_segmenter: {
                minimum_layer_thickness_m: 0.30,
                gunsat_kNm3: 16.0,
                dr_compression_factor: 0.675,
              },
            }),
          })
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )
      expect(patchRes.status).toBe(200)

      // 2. DB view_state carries the new value.
      const vs = await getProjectViewState(FIXTURE_PROJECT_ID)
      const segPrefs = (vs as Record<string, unknown>).litho_segmenter as Record<
        string,
        unknown
      > | undefined
      expect(segPrefs).toBeTruthy()
      expect(segPrefs!.minimum_layer_thickness_m).toBe(0.30)

      // 3. Bundle also embeds the view_state (the .gmproj file round-trip).
      const bundleRes = await page.evaluate(
        async ([base, pid]) => {
          const r = await fetch(`${base}/projects/${pid}/bundle`)
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )
      expect(bundleRes.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bundlePrefs = (bundleRes.json as any).project?.view_state?.litho_segmenter
      expect(bundlePrefs?.minimum_layer_thickness_m).toBe(0.30)

      // 4. Restore the default so subsequent runs see a clean fixture.
      await page.evaluate(
        async ([base, pid]) => {
          await fetch(`${base}/projects/${pid}/view-state`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              litho_segmenter: {
                minimum_layer_thickness_m: 0.15,
                gunsat_kNm3: 16.0,
                dr_compression_factor: 0.675,
              },
            }),
          })
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )
    } finally {
      await closeApp(app)
    }
  })

  test('out-of-range minimum_layer_thickness_m rejected by suggest-litho endpoint', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      // Resolve litho model id.
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
          const r = await fetch(`${base}/cpt/?project_id=${pid}`)
          return r.json()
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((cptsRes as any[]).length).toBeGreaterThan(0)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cptId: string = (cptsRes as any[])[0].id

      // The backend suggest-litho endpoint enforces
      // minimum_layer_thickness_m in [0.05, 10.0].
      // An out-of-range value (50 m) must return 422.
      const rejectRes = await page.evaluate(
        async ([base, pid, mid, cid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/contacts/suggest-litho`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                cpt_id: cid,
                minimum_layer_thickness_m: 50.0,  // well above max of 10.0
              }),
            },
          )
          return { status: r.status }
        },
        [API_BASE, FIXTURE_PROJECT_ID, lithoModelId, cptId],
      )
      expect(rejectRes.status).toBe(422)

      // An in-range value (0.30 m) must succeed with suggestions.
      const acceptRes = await page.evaluate(
        async ([base, pid, mid, cid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/contacts/suggest-litho`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                cpt_id: cid,
                minimum_layer_thickness_m: 0.30,
              }),
            },
          )
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, lithoModelId, cptId],
      )
      expect(acceptRes.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((acceptRes.json as any).layers.length).toBeGreaterThan(0)
    } finally {
      await closeApp(app)
    }
  })

  test('theme toggle stores value in localStorage', async () => {
    const { app, page } = await launchApp({
      E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID,
    })

    try {
      await page.waitForLoadState('domcontentloaded')
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })

      // Open the settings dialog via IPC.
      // app.evaluate runs in the main process; it has access to the
      // Electron API.  We send the same IPC signal the native menu fires.
      await app.evaluate(({ ipcMain }) => {
        const { BrowserWindow } = require('electron') as typeof import('electron')
        const win = BrowserWindow.getAllWindows()[0]
        if (win) win.webContents.send('menu:open-settings')
      })

      await expect(page.getByTestId('settings-dialog')).toBeVisible({ timeout: 5_000 })

      // Navigate to the Appearance tab.
      await page.getByTestId('settings-section-appearance').click()

      // Read the current theme from localStorage so we can restore it.
      // The storage key is ``groundmodel.theme`` (see useTheme.ts STORAGE_KEY).
      const initialTheme = await page.evaluate(
        () => localStorage.getItem('groundmodel.theme') ?? 'system',
      )

      // Change the theme to 'dark' via the select.
      await page.locator('#settings-theme').selectOption('dark')

      // The useTheme hook fires ``document.documentElement.classList.add('dark')``
      // immediately on change (no Save button for appearance).
      const htmlClass = await page.evaluate(
        () => document.documentElement.classList.contains('dark'),
      )
      expect(htmlClass).toBe(true)

      // localStorage carries the value.
      const storedTheme = await page.evaluate(
        () => localStorage.getItem('groundmodel.theme'),
      )
      expect(storedTheme).toBe('dark')

      // Restore the original value.
      if (initialTheme !== 'dark') {
        await page.locator('#settings-theme').selectOption(initialTheme)
      }
    } finally {
      await closeApp(app)
    }
  })
})
