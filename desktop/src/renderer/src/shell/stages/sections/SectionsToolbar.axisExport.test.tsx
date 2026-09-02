// Section DXF must export the model the ACTIVE AXIS is showing (the PDF path
// moved to the client-rendered sheet — see the AX2 note at the end of the file).
//
// Audit 2026-08-02: on the Geotechnical axis both export verbs fell through to
// `activeGeologicalModel`, so an engineer looking at NAD sub-bands got a DXF /
// PDF full of Quartair-Boom-Diest formation surfaces and zero geotech units —
// a plausible, correctly-named, completely wrong deliverable, with nothing in
// the file, the toast or the tooltip naming the model level that was written.
//
// The rule, in the rule's own words: exporting a section exports the model
// level the section is currently showing.
//
// SCOPE: this file pins the ROUTING half only — the export handlers are
// mocked, so a geotech model_id reaching them is all it can prove. The other
// half (that the backend snapshot actually yields geotech content for that id,
// rather than an empty DXF) is pinned by
// ``tests/integration/api/test_cross_section_export_geotech.py``, which drives
// the real builder + exporter against a seeded geotech model. Neither test is
// sufficient alone: routing to the right model and that model producing
// content are independent failures with the same symptom for the engineer.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type { SectionModelAxis } from '../../../hooks/useSections'
import SectionsToolbar from './SectionsToolbar'
import {
  makeGeotechModel,
  makeLithoModel,
  makeShellCtx,
} from './__fixtures__/sectionsShellContext'

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
      },
      virtueleBoring: { getModels: vi.fn().mockResolvedValue([]) },
    },
  }
})

vi.mock('../../../utils/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

const GEO_MODEL_ID = 'geo-model-1'
const LITHO_MODEL_ID = 'litho-model-1'
const GEOTECH_MODEL_ID = 'geotech-model-1'

/** Shell context on ``axis`` with all three model levels active. */
function ctxWithAllThreeModels(
  axis: SectionModelAxis,
  exportDxf: ReturnType<typeof vi.fn>,
): ShellContextValue {
  const base = makeShellCtx(axis)
  return {
    ...base,
    geoModel: {
      ...base.geoModel,
      activeGeologicalModel: {
        id: GEO_MODEL_ID,
        app_project_id: 'proj-1',
        name: 'Geological model',
        description: null,
        kind: 'geological',
        parent_model_id: null,
        is_active: true,
        excluded_borehole_ids: [],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      activeLithoModel: makeLithoModel(LITHO_MODEL_ID),
      activeGeotechModel: makeGeotechModel(GEOTECH_MODEL_ID),
    },
    coordinator: {
      ...base.coordinator,
      handleExportSectionDxf:
        exportDxf as unknown as ShellContextValue['coordinator']['handleExportSectionDxf'],
    },
  }
}

function renderToolbar(ctx: ShellContextValue): void {
  render(
    <ShellContext.Provider value={ctx}>
      <SectionsToolbar />
    </ShellContext.Provider>,
  )
}

/** Open the Export ▾ dropdown and click one of its items. */
function clickExportItem(testid: string): void {
  fireEvent.click(screen.getByTestId('sections-toolbar-export-dropdown'))
  fireEvent.click(screen.getByTestId(testid))
}

afterEach(cleanup)

describe('SectionsToolbar — AX1: DXF follows the active axis', () => {
  it('exports the GEOTECH model when the section is on the geotechnical axis', () => {
    const exportDxf = vi.fn().mockResolvedValue(undefined)
    renderToolbar(ctxWithAllThreeModels('geotechnical', exportDxf))

    clickExportItem('export-section-dxf')

    expect(exportDxf).toHaveBeenCalledTimes(1)
    expect(exportDxf.mock.calls[0][3]).toBe(GEOTECH_MODEL_ID)
  })

  it('still exports the geological model on the geology axis', () => {
    const exportDxf = vi.fn().mockResolvedValue(undefined)
    renderToolbar(ctxWithAllThreeModels('geological', exportDxf))

    clickExportItem('export-section-dxf')

    expect(exportDxf.mock.calls[0][3]).toBe(GEO_MODEL_ID)
  })

  it('still exports the litho model on the litho axis', () => {
    const exportDxf = vi.fn().mockResolvedValue(undefined)
    renderToolbar(ctxWithAllThreeModels('lithostratigraphic', exportDxf))

    clickExportItem('export-section-dxf')

    expect(exportDxf.mock.calls[0][3]).toBe(LITHO_MODEL_ID)
  })
})

// AX2 (PDF report follows the active axis) retired with the matplotlib PDF path.
// The section PDF is now the client-rendered sheet: the export verb opens
// ``SheetPreviewDialog``, which picks the axis from the sheet's fill setting
// (seeded from the panel axis) inside ``useSheetPayload`` — no model_id crosses
// a mocked handler to assert on here. The verb-opens-the-dialog wiring is pinned
// by the ``flow_export_section_pdf`` e2e; the payload assembly by
// ``buildSheetPayload.test.ts``.
