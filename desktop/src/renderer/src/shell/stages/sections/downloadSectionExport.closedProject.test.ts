// "Once a project is closed, nothing of it runs any more" (owner, PR #90; deep
// walker 2026-10-16 seed 631210857). A section export is bound to the project it
// was started on: after the native save dialog, or any other await, it stops if
// that project is no longer the open one. It never fetches the export bytes for
// a closed project and never writes a file or toasts on the next project's
// screen.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { downloadSectionExport } from './downloadSectionExport'
import { reportOpenProject, resetOpenProjectGuard } from '../../../utils/openProjectGuard'

const logInfo = vi.fn()
vi.mock('../../../utils/log', () => ({
  log: {
    debug: vi.fn(),
    info: (...args: unknown[]) => logInfo(...args),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const showExportSaveDialog = vi.fn()
const writeExportFile = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  resetOpenProjectGuard()
  writeExportFile.mockResolvedValue(undefined)
  ;(globalThis as { window?: unknown }).window = Object.assign(globalThis.window ?? {}, {
    electron: { showExportSaveDialog, writeExportFile },
  })
})

afterEach(() => {
  resetOpenProjectGuard()
})

function spec(fetchBytes: () => Promise<ArrayBuffer>, toast = vi.fn()) {
  return {
    projectId: 'A',
    sectionName: 'Cross-section 1',
    extension: 'dxf',
    filterLabel: 'AutoCAD DXF',
    successMessage: 'ok',
    failureMessage: 'failed',
    logLabel: 'exportDxf',
    toast,
    fetchBytes,
  }
}

describe('downloadSectionExport: an export of a closed project stops', () => {
  it("a DXF export started on A's section sends no request once B is open", async () => {
    reportOpenProject('A')
    let answerDialog!: (path: string | null) => void
    showExportSaveDialog.mockImplementation(
      () =>
        new Promise<string | null>(resolve => {
          answerDialog = resolve
        }),
    )
    const fetchBytes = vi.fn().mockResolvedValue(new ArrayBuffer(8))
    const toast = vi.fn()

    const running = downloadSectionExport(spec(fetchBytes, toast))
    // While the save dialog is up, A is closed and B opened.
    await Promise.resolve()
    reportOpenProject('B')
    answerDialog('C:/out/Cross-section 1.dxf')
    await running

    expect(fetchBytes).not.toHaveBeenCalled()
    expect(writeExportFile).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
    expect(logInfo).toHaveBeenCalledWith('section', 'exportDxf abandoned: project closed')
  })

  it('bytes that arrive after the switch are never written', async () => {
    reportOpenProject('A')
    showExportSaveDialog.mockResolvedValue('C:/out/x.dxf')
    let deliver!: (b: ArrayBuffer) => void
    const fetchBytes = vi.fn(
      () =>
        new Promise<ArrayBuffer>(resolve => {
          deliver = resolve
        }),
    )
    const toast = vi.fn()

    const running = downloadSectionExport(spec(fetchBytes, toast))
    await vi.waitFor(() => expect(fetchBytes).toHaveBeenCalled())
    reportOpenProject('B')
    deliver(new ArrayBuffer(8))
    await running

    expect(writeExportFile).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it('never opens the save dialog for a project that is already closed', async () => {
    reportOpenProject('B')
    const fetchBytes = vi.fn()
    await downloadSectionExport(spec(fetchBytes))
    expect(showExportSaveDialog).not.toHaveBeenCalled()
    expect(fetchBytes).not.toHaveBeenCalled()
  })

  it('an export of the open project still writes its file (guard)', async () => {
    reportOpenProject('A')
    showExportSaveDialog.mockResolvedValue('C:/out/x.dxf')
    const fetchBytes = vi.fn().mockResolvedValue(new ArrayBuffer(8))
    const toast = vi.fn()
    await downloadSectionExport(spec(fetchBytes, toast))
    expect(writeExportFile).toHaveBeenCalledWith('C:/out/x.dxf', expect.any(ArrayBuffer))
    expect(toast).toHaveBeenCalledWith('success', 'ok')
  })
})
