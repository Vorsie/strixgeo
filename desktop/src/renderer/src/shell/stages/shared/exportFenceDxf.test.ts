// Behavioural pins for the fence-diagram DXF export action.
//
// The rule these are written against: an export either produces the drawing
// the engineer is looking at, or it says why it did not. What it must NEVER do
// is write a file that looks like a successful export of an empty model —
// that is the one failure a CAD user cannot detect by opening the result.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const exportFenceDxfApi = vi.fn()
vi.mock('../../../api/client', () => ({
  api: { geology: { exportFenceDxf: (...args: unknown[]) => exportFenceDxfApi(...args) } },
}))

import type { GeologicalFormationResponse } from '../../../api/client'
import type { FencePanel } from '../../../utils/fencePanels'
import { exportFenceDxf } from './exportFenceDxf'

const showExportSaveDialog = vi.fn()
const writeExportFile = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  showExportSaveDialog.mockResolvedValue('C:/tmp/model_fence.dxf')
  writeExportFile.mockResolvedValue(undefined)
  exportFenceDxfApi.mockResolvedValue(new ArrayBuffer(64))
  ;(globalThis as { window?: unknown }).window = Object.assign(globalThis.window ?? {}, {
    electron: { showExportSaveDialog, writeExportFile },
  })
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

function options(over: Partial<Parameters<typeof exportFenceDxf>[0]> = {}) {
  return {
    projectId: 'p1',
    modelId: 'm1',
    modelName: 'Litho model',
    panels: [PANEL],
    formations: FORMATIONS,
    toast: vi.fn(),
    ...over,
  }
}

describe('exportFenceDxf', () => {
  it('EF1 — writes the DXF the viewer is painting', async () => {
    const opts = options()

    await exportFenceDxf(opts)

    expect(exportFenceDxfApi).toHaveBeenCalledTimes(1)
    const [projectId, modelId, request] = exportFenceDxfApi.mock.calls[0]
    expect(projectId).toBe('p1')
    expect(modelId).toBe('m1')
    expect(request.panels).toHaveLength(1)
    expect(request.panels[0].name).toBe('Boom Clay')
    expect(writeExportFile).toHaveBeenCalledWith('C:/tmp/model_fence.dxf', expect.anything())
    expect(opts.toast).toHaveBeenCalledWith('success', expect.stringContaining('1 panels'))
  })

  it('EF2 — refuses rather than writing an empty drawing', async () => {
    // No fence on screen (Solid view, or a model with no correlated walls).
    // A DXF with zero entities opens fine and reads as "the model is empty".
    const opts = options({ panels: [] })

    await exportFenceDxf(opts)

    expect(exportFenceDxfApi).not.toHaveBeenCalled()
    expect(writeExportFile).not.toHaveBeenCalled()
    expect(opts.toast).toHaveBeenCalledWith('warning', expect.stringContaining('Fence'))
  })

  it('EF3 — refuses when every panel is geometry-less', async () => {
    // Panels exist as rows but carry no faces — same user-visible outcome as
    // EF2, so it must take the same refusal path rather than exporting rows.
    const opts = options({ panels: [{ ...PANEL, triangles: [] }] })

    await exportFenceDxf(opts)

    expect(exportFenceDxfApi).not.toHaveBeenCalled()
    expect(opts.toast).toHaveBeenCalledWith('warning', expect.anything())
  })

  it('EF4 — cancelling the save dialog exports nothing and says nothing', async () => {
    showExportSaveDialog.mockResolvedValue(null)
    const opts = options()

    await exportFenceDxf(opts)

    expect(exportFenceDxfApi).not.toHaveBeenCalled()
    expect(writeExportFile).not.toHaveBeenCalled()
    // Cancelling is not an error and not a success — a toast either way would
    // be noise on a deliberate action.
    expect(opts.toast).not.toHaveBeenCalled()
  })

  it('EF5 — a server refusal is reported, not thrown at the click handler', async () => {
    exportFenceDxfApi.mockRejectedValue(new Error('panel 0: triangle 0 references vertex index 9'))
    const opts = options()

    await expect(exportFenceDxf(opts)).resolves.toBeUndefined()

    expect(writeExportFile).not.toHaveBeenCalled()
    expect(opts.toast).toHaveBeenCalledWith('error', expect.stringContaining('vertex index 9'))
  })

  it('EF6 — proposes a filename derived from the model name', async () => {
    // Characters a filesystem or the backend's own Content-Disposition stem
    // would reject become underscores — the same substitution
    // ``handleExportSectionDxf`` uses, so the proposed default matches the
    // name the download would have had anyway.
    await exportFenceDxf(options({ modelName: 'Model / v2: final?' }))

    expect(showExportSaveDialog).toHaveBeenCalledWith(
      'Model _ v2_ final__fence.dxf',
      expect.anything(),
    )
  })

  it('EF7 — an unnameable model still proposes something openable', async () => {
    await exportFenceDxf(options({ modelName: '///' }))

    // Three substituted slashes plus the "_fence" suffix — never an empty stem.
    expect(showExportSaveDialog).toHaveBeenCalledWith('____fence.dxf', expect.anything())
  })
})
