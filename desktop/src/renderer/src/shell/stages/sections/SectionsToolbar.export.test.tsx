// "The section toolbar has one export verb that opens the hub with my section
// preselected" (owner ruling, installer #35). Every export moved to the Export
// stage; the toolbar now carries a single "Export…" verb that jumps there with
// the open section + axis preselected — no dropdown, no per-format items.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type { SectionModelAxis } from '../../../hooks/useSections'
import SectionsToolbar from './SectionsToolbar'
import { makeShellCtx, makeLithoModel } from './__fixtures__/sectionsShellContext'

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
        listContactCorrelations: vi.fn().mockResolvedValue([]),
      },
      virtueleBoring: { getModels: vi.fn().mockResolvedValue([]) },
    },
  }
})

vi.mock('../../../utils/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

function ctxOn(axis: SectionModelAxis, setExportDeepLinkTarget: ReturnType<typeof vi.fn>) {
  const ctx = makeShellCtx(axis)
  // The litho axis needs a litho model active for the axis to render normally.
  ctx.geoModel.activeLithoModel = makeLithoModel()
  ctx.coordinator.setExportDeepLinkTarget =
    setExportDeepLinkTarget as unknown as ShellContextValue['coordinator']['setExportDeepLinkTarget']
  return ctx
}

function renderToolbar(ctx: ShellContextValue) {
  return render(
    <ShellContext.Provider value={ctx}>
      <SectionsToolbar />
    </ShellContext.Provider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('the section toolbar has one export verb that opens the hub', () => {
  it('shows a single "Export…" verb and no per-format export dropdown', () => {
    renderToolbar(ctxOn('geotechnical', vi.fn()))
    expect(screen.getByTestId('sections-toolbar-export')).toBeTruthy()
    // The old scattered verbs are gone from the toolbar.
    expect(screen.queryByTestId('sections-toolbar-export-dropdown')).toBeNull()
    expect(screen.queryByTestId('export-section-dxf')).toBeNull()
    expect(screen.queryByTestId('export-section-dstability')).toBeNull()
    expect(screen.queryByTestId('export-section-pdf')).toBeNull()
  })

  it('opening it preselects the open section on the GEOTECH axis', () => {
    const setTarget = vi.fn()
    const ctx = ctxOn('geotechnical', setTarget)
    const sectionId = ctx.sections.sections[0].id
    renderToolbar(ctx)
    fireEvent.click(screen.getByTestId('sections-toolbar-export'))
    expect(setTarget).toHaveBeenCalledWith({ sectionId, axis: 'geotechnical' })
  })

  it('opening it preselects the open section on the LITHO axis', () => {
    const setTarget = vi.fn()
    const ctx = ctxOn('lithostratigraphic', setTarget)
    const sectionId = ctx.sections.sections[0].id
    renderToolbar(ctx)
    fireEvent.click(screen.getByTestId('sections-toolbar-export'))
    expect(setTarget).toHaveBeenCalledWith({ sectionId, axis: 'lithostratigraphic' })
  })
})
