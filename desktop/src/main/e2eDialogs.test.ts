// Owner 2026-09-10, during the walker gate: "i don't want to have to click away
// save windows." The walker clicks Export Plaxis and drags onto Save project;
// the main process then opens a REAL OS Save dialog, which no Playwright call
// can dismiss. Left alone it blocks the app until the test timeout (the
// 20-minute "hang" of walker run 14); attended, it lands on the owner's screen.
// Under STRIX_E2E the native dialogs answer themselves: Save/Open as
// "cancelled", message boxes with their cancel (else default) button, and
// every suppressed dialog is logged so a run can still tell it was asked for.
//
// Pure and Electron-free (vitest.config.ts includes src/main/**): the dialog
// object is a fake with the four methods the app uses.

import { describe, expect, it, vi } from 'vitest'

import { installE2eDialogStubs, type StubbableDialog } from './e2eDialogs'

function fakeDialog(): StubbableDialog {
  return {
    showSaveDialog: vi.fn(async (..._args: unknown[]) => ({ canceled: false, filePath: 'C:/real.strix' })),
    showOpenDialog: vi.fn(async (..._args: unknown[]) => ({ canceled: false, filePaths: ['C:/real.gef'] })),
    showMessageBox: vi.fn(async (..._args: unknown[]) => ({ response: 1, checkboxChecked: false })),
    showMessageBoxSync: vi.fn((..._args: unknown[]) => 1),
  }
}

describe('native dialogs under the e2e harness', () => {
  it('a Save dialog answers "cancelled" at once and is logged', async () => {
    const dialog = fakeDialog()
    const original = dialog.showSaveDialog
    const log = vi.fn()
    installE2eDialogStubs(dialog, { e2e: true, log })
    const result = await dialog.showSaveDialog({ title: 'Export Plaxis 2D', defaultPath: 'x.py' })
    expect(result).toEqual({ canceled: true, filePath: '' })
    expect(original).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/\[e2e\].*save.*Export Plaxis 2D/i))
  })

  it('an Open dialog answers "cancelled" with no paths', async () => {
    const dialog = fakeDialog()
    installE2eDialogStubs(dialog, { e2e: true, log: vi.fn() })
    const result = await dialog.showOpenDialog({ properties: ['openFile'] })
    expect(result).toEqual({ canceled: true, filePaths: [] })
  })

  it('a message box answers with its cancel button, else its default, else the first', async () => {
    const dialog = fakeDialog()
    installE2eDialogStubs(dialog, { e2e: true, log: vi.fn() })
    expect(dialog.showMessageBoxSync({ buttons: ['Keep open', 'Close anyway'], defaultId: 0, cancelId: 0 })).toBe(0)
    expect(dialog.showMessageBoxSync({ buttons: ['Get the current version', 'Quit'], defaultId: 0, cancelId: 1 })).toBe(1)
    expect(dialog.showMessageBoxSync({ buttons: ['A', 'B'], defaultId: 1 })).toBe(1)
    expect(dialog.showMessageBoxSync({ buttons: ['OK'] })).toBe(0)
    await expect(dialog.showMessageBox({ buttons: ['OK'] })).resolves.toEqual({ response: 0, checkboxChecked: false })
  })

  it('outside e2e the dialogs are left untouched', async () => {
    const dialog = fakeDialog()
    const original = dialog.showSaveDialog
    installE2eDialogStubs(dialog, { e2e: false, log: vi.fn() })
    expect(dialog.showSaveDialog).toBe(original)
    await expect(dialog.showSaveDialog({})).resolves.toEqual({ canceled: false, filePath: 'C:/real.strix' })
  })
})
