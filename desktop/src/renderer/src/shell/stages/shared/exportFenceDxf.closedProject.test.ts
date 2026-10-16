// "Once a project is closed, nothing of it runs any more" (owner, PR #90; deep
// walker 2026-10-16 seed 631210857). The fence DXF export is bound to the
// project it was started on: once that project is closed (here: while the
// native save dialog is up) it fetches nothing, writes nothing and toasts
// nothing on the next project's screen.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const exportFenceDxfApi = vi.fn()
vi.mock('../../../api/client', () => ({
  api: { geology: { exportFenceDxf: (...args: unknown[]) => exportFenceDxfApi(...args) } },
}))

import type { GeologicalFormationResponse } from '../../../api/client'
import type { FencePanel } from '../../../utils/fencePanels'
import { reportOpenProject, resetOpenProjectGuard } from '../../../utils/openProjectGuard'
import { exportFenceDxf } from './exportFenceDxf'

const showExportSaveDialog = vi.fn()
const writeExportFile = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  resetOpenProjectGuard()
  writeExportFile.mockResolvedValue(undefined)
  exportFenceDxfApi.mockResolvedValue(new ArrayBuffer(64))
  ;(globalThis as { window?: unknown }).window = Object.assign(globalThis.window ?? {}, {
    electron: { showExportSaveDialog, writeExportFile },
  })
})

afterEach(() => {
  resetOpenProjectGuard()
})

const FORMATIONS = [
  {
    id: 'f1',
    name: 'Boom Clay',
    color: '#aabbcc',
    litho_main_soil_code: null,
    litho_admixtures: [],
    display_order: 0,
  } as unknown as GeologicalFormationResponse,
]

const PANEL: FencePanel = {
  formationId: 'f1',
  bodyId: 'b1',
  vertices: [
    [0, 0, 0],
    [10, 0, 0],
    [10, 0, 5],
  ],
  triangles: [[0, 1, 2]],
}

describe('exportFenceDxf: an export of a closed project stops', () => {
  it("a fence export started on A sends no request once B is open", async () => {
    reportOpenProject('p1')
    let answerDialog!: (path: string | null) => void
    showExportSaveDialog.mockImplementation(
      () =>
        new Promise<string | null>(resolve => {
          answerDialog = resolve
        }),
    )
    const toast = vi.fn()
    const running = exportFenceDxf({
      projectId: 'p1',
      modelId: 'm1',
      modelName: 'Litho model',
      panels: [PANEL],
      formations: FORMATIONS,
      toast,
    })
    await Promise.resolve()
    reportOpenProject('p2')
    answerDialog('C:/tmp/model_fence.dxf')
    await running

    expect(exportFenceDxfApi).not.toHaveBeenCalled()
    expect(writeExportFile).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })
})
