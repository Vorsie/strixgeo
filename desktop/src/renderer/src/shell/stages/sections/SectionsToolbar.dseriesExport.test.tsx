// The Export menu offers the two D-Series deliverables, and each one exports
// the section the engineer has open.
//
// The rule, in the rule's own words: what is exported is what the section
// draws. D-Stability and D-Sheet Piling are the closed-geometry family — their
// model IS the drawn partition — so the handler must post the OPEN section's
// partition and nothing else, and it must reach the file the same way every
// other section export does (save dialog → bytes → write).
//
// SCOPE: this file pins the MENU + HANDLER + DOWNLOAD wiring. The partition
// source itself (one section, its own endpoints, no second section's ground) is
// pinned by ``buildSectionExportPartition.test.ts`` against the real assembly;
// here it is mocked, so what this file can prove is that the handler posts what
// that module returned, for the axis model the section is showing.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type { SectionModelAxis } from '../../../hooks/useSections'
import SectionsToolbar from './SectionsToolbar'
import { makeGeotechModel, makeLithoModel, makeShellCtx } from './__fixtures__/sectionsShellContext'

const exportDstability = vi.fn()
const exportDsheetPiling = vi.fn()
const buildSectionExportPartition = vi.fn()

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
      section: {
        exportDstability: (...a: unknown[]) => exportDstability(...a),
        exportDsheetPiling: (...a: unknown[]) => exportDsheetPiling(...a),
      },
    },
  }
})

vi.mock('./buildSectionExportPartition', () => ({
  buildSectionExportPartition: (...a: unknown[]) => buildSectionExportPartition(...a),
}))

vi.mock('../../../utils/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

const LITHO_MODEL_ID = 'litho-model-1'
const GEOTECH_MODEL_ID = 'geotech-model-1'

/** The partition the mocked builder hands back — identity is what we assert on. */
const PARTITION = {
  start_x: 0,
  start_y: 0,
  end_x: 100,
  end_y: 0,
  columns: [],
  regions: [],
}

const showExportSaveDialog = vi.fn()
const writeExportFile = vi.fn()

/** Shell context on ``axis`` with all three model levels active. */
function ctx(axis: SectionModelAxis): ShellContextValue {
  const base = makeShellCtx(axis)
  return {
    ...base,
    geoModel: {
      ...base.geoModel,
      activeGeologicalModel: {
        id: 'geo-model-1',
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
  } as ShellContextValue
}

function renderToolbar(value: ShellContextValue): void {
  render(
    <ShellContext.Provider value={value}>
      <SectionsToolbar />
    </ShellContext.Provider>,
  )
}

/** Open the Export ▾ dropdown; items only exist in the DOM while it is open. */
function openExportMenu(): void {
  fireEvent.click(screen.getByTestId('sections-toolbar-export-dropdown'))
}

beforeEach(() => {
  exportDstability.mockReset().mockResolvedValue(new ArrayBuffer(8))
  exportDsheetPiling.mockReset().mockResolvedValue(new ArrayBuffer(4))
  buildSectionExportPartition.mockReset().mockResolvedValue(PARTITION)
  showExportSaveDialog.mockReset().mockResolvedValue('C:/out/Section A-A.stix')
  writeExportFile.mockReset().mockResolvedValue(undefined)
  ;(window as unknown as { electron: unknown }).electron = {
    showExportSaveDialog: (...a: unknown[]) => showExportSaveDialog(...a),
    writeExportFile: (...a: unknown[]) => writeExportFile(...a),
  }
})

afterEach(cleanup)

describe('SectionsToolbar — DS1: the Export menu offers both D-Series artefacts', () => {
  it('offers them on the lithostratigraphic axis', () => {
    renderToolbar(ctx('lithostratigraphic'))
    openExportMenu()

    expect(screen.getByTestId('export-section-dstability')).toHaveTextContent('D-Stability (.stix)')
    expect(screen.getByTestId('export-section-dsheetpiling')).toHaveTextContent(
      'D-Sheet Piling (.shi)',
    )
  })

  it('offers them on the geotechnical axis', () => {
    renderToolbar(ctx('geotechnical'))
    openExportMenu()

    expect(screen.getByTestId('export-section-dstability')).toBeInTheDocument()
    expect(screen.getByTestId('export-section-dsheetpiling')).toBeInTheDocument()
  })
})

describe('SectionsToolbar — DS2: dead without a section or a model', () => {
  it('disables both when no section is selected', () => {
    // On the geology axis the Plaxis-3D row keeps the menu reachable, so the
    // two D-Series rows can be observed in their disabled state.
    const base = ctx('geological')
    renderToolbar({
      ...base,
      sections: { ...base.sections, sections: [], selectedSectionId: null },
    })
    openExportMenu()

    expect(screen.getByTestId('export-section-dstability')).toBeDisabled()
    expect(screen.getByTestId('export-section-dsheetpiling')).toBeDisabled()
  })

  it('leaves the whole Export menu unreachable when the open axis has no model', () => {
    // Stronger than a disabled row: with no model for the axis, every export in
    // the menu is dead, so the trigger itself is — the engineer cannot open a
    // menu in which nothing can be pressed.
    const base = ctx('lithostratigraphic')
    renderToolbar({
      ...base,
      geoModel: { ...base.geoModel, activeLithoModel: null },
    } as ShellContextValue)

    expect(screen.getByTestId('sections-toolbar-export-dropdown')).toBeDisabled()
  })

  it('leaves the whole Export menu unreachable on the litho axis with no section', () => {
    const base = ctx('lithostratigraphic')
    renderToolbar({
      ...base,
      sections: { ...base.sections, sections: [], selectedSectionId: null },
    })

    expect(screen.getByTestId('sections-toolbar-export-dropdown')).toBeDisabled()
  })
})

describe('SectionsToolbar — DS3: the handler posts the open section, on its axis', () => {
  it('sends the drawn partition with the LITHO model id on the litho axis', async () => {
    renderToolbar(ctx('lithostratigraphic'))
    openExportMenu()
    fireEvent.click(screen.getByTestId('export-section-dstability'))

    await waitFor(() => expect(exportDstability).toHaveBeenCalledTimes(1))
    expect(exportDstability.mock.calls[0][1]).toBe('sec-1')
    expect(exportDstability.mock.calls[0][2]).toBe(LITHO_MODEL_ID)
    expect(exportDstability.mock.calls[0][3]).toBe(PARTITION)
  })

  it('sends the GEOTECH model id on the geotechnical axis', async () => {
    renderToolbar(ctx('geotechnical'))
    openExportMenu()
    fireEvent.click(screen.getByTestId('export-section-dsheetpiling'))

    await waitFor(() => expect(exportDsheetPiling).toHaveBeenCalledTimes(1))
    expect(exportDsheetPiling.mock.calls[0][2]).toBe(GEOTECH_MODEL_ID)
    expect(exportDsheetPiling.mock.calls[0][3]).toBe(PARTITION)
  })

  it('builds the partition for the SELECTED section, not for every visible one', async () => {
    renderToolbar(ctx('lithostratigraphic'))
    openExportMenu()
    fireEvent.click(screen.getByTestId('export-section-dstability'))

    await waitFor(() => expect(buildSectionExportPartition).toHaveBeenCalledTimes(1))
    expect(buildSectionExportPartition.mock.calls[0][0].section.id).toBe('sec-1')
  })
})

describe('SectionsToolbar — DS4: the bytes reach a file the way DXF does', () => {
  it('writes the returned bytes to the path the save dialog chose', async () => {
    const bytes = new ArrayBuffer(16)
    exportDstability.mockResolvedValue(bytes)
    renderToolbar(ctx('lithostratigraphic'))
    openExportMenu()
    fireEvent.click(screen.getByTestId('export-section-dstability'))

    await waitFor(() => expect(writeExportFile).toHaveBeenCalledTimes(1))
    expect(writeExportFile.mock.calls[0][0]).toBe('C:/out/Section A-A.stix')
    expect(writeExportFile.mock.calls[0][1]).toBe(bytes)
  })

  it('proposes the section name with the artefact extension', async () => {
    renderToolbar(ctx('lithostratigraphic'))
    openExportMenu()
    fireEvent.click(screen.getByTestId('export-section-dsheetpiling'))

    await waitFor(() => expect(showExportSaveDialog).toHaveBeenCalledTimes(1))
    expect(showExportSaveDialog.mock.calls[0][0]).toBe('Section A-A.shi')
  })

  it('cancelling the save dialog writes nothing and posts nothing', async () => {
    showExportSaveDialog.mockResolvedValue(null)
    renderToolbar(ctx('lithostratigraphic'))
    openExportMenu()
    fireEvent.click(screen.getByTestId('export-section-dstability'))

    await waitFor(() => expect(showExportSaveDialog).toHaveBeenCalledTimes(1))
    expect(exportDstability).not.toHaveBeenCalled()
    expect(writeExportFile).not.toHaveBeenCalled()
  })
})

describe('SectionsToolbar — DS5: the in-flight press says so and cannot re-fire', () => {
  it('shows the busy label and disables both rows while the export runs', async () => {
    let release: (v: ArrayBuffer) => void = () => {}
    exportDstability.mockReturnValue(
      new Promise<ArrayBuffer>(resolve => {
        release = resolve
      }),
    )
    renderToolbar(ctx('lithostratigraphic'))
    openExportMenu()
    fireEvent.click(screen.getByTestId('export-section-dstability'))
    // Picking an item closes the menu (``ToolbarDropdownItem`` auto-closes), so
    // the busy state is what the engineer meets on reopening it.
    await waitFor(() => expect(showExportSaveDialog).toHaveBeenCalled())
    openExportMenu()

    expect(screen.getByTestId('export-section-dstability')).toHaveTextContent(
      'Exporting D-Stability…',
    )
    expect(screen.getByTestId('export-section-dstability')).toBeDisabled()
    // The sibling row is dead too — one export at a time.
    expect(screen.getByTestId('export-section-dsheetpiling')).toBeDisabled()

    release(new ArrayBuffer(2))
    await waitFor(() =>
      expect(screen.getByTestId('export-section-dstability')).toHaveTextContent(
        'D-Stability (.stix)',
      ),
    )
  })
})
