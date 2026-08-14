// The two lab-sample view toggles in the section toolbar.
//
// Owner's words: 'Add a "Show samples" item to the Display dropdown (default
// ON)' and 'Toggle "PSD preview on hover" (default ON) in the Display dropdown
// AND on the bare P key'.
//
// The markers draw on the litho AND geotech axes, so both switches have to be
// reachable from BOTH axes' view menus — the geotech axis's "Display" menu and
// the litho axis's "Bodies" menu, which is where that axis keeps its view
// toggles today.
//
//   TSD1  the geotech Display menu carries "samples", and picking it flips the
//         switch
//   TSD2  the litho view menu carries it too, and picking it flips the same
//         switch
//   TSD3  the geotech Display menu carries the grain-size hover preview, and
//         picking it flips the switch
//   TSD4  the litho view menu carries it too
//   TSD5  the item names the state it will move to, since the menu has no
//         checkmark of its own

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type { SectionModelAxis } from '../../../hooks/useSections'
import SectionsToolbar from './SectionsToolbar'
import {
  makeShellCtx,
  makeGeotechModel,
  makeLithoModel,
} from './__fixtures__/sectionsShellContext'
import { getSampleMarkersOn } from '../../../utils/sampleMarkersOnStore'
import { getPsdPreviewOn } from '../../../utils/psdPreviewOnStore'

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

function makeCtx(
  axis: SectionModelAxis,
  geoModel: Partial<ShellContextValue['geoModel']> = {},
): ShellContextValue {
  const base = makeShellCtx(axis)
  return { ...base, geoModel: { ...base.geoModel, ...geoModel } }
}

function renderToolbar(ctx: ShellContextValue): void {
  render(
    <ShellContext.Provider value={ctx}>
      <SectionsToolbar />
    </ShellContext.Provider>,
  )
}

/** Open the view menu for the axis under test. */
function openViewMenu(axis: 'geotech' | 'litho'): void {
  fireEvent.click(
    screen.getByTestId(axis === 'geotech' ? 'geotech-display-menu' : 'litho-bodies-dropdown'),
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SectionsToolbar — lab-sample view toggles', () => {
  it('TSD1: the geotech Display menu flips the sample markers', () => {
    renderToolbar(makeCtx('geotechnical', { activeGeotechModel: makeGeotechModel() }))
    openViewMenu('geotech')

    const before = getSampleMarkersOn()
    fireEvent.click(screen.getByTestId('geotech-toggle-samples'))
    expect(getSampleMarkersOn()).toBe(!before)

    // Leave the switch as we found it — the store is module-global.
    openViewMenu('geotech')
    fireEvent.click(screen.getByTestId('geotech-toggle-samples'))
    expect(getSampleMarkersOn()).toBe(before)
  })

  it('TSD2: the litho view menu flips the same sample-marker switch', () => {
    renderToolbar(makeCtx('lithostratigraphic', { activeLithoModel: makeLithoModel() }))
    openViewMenu('litho')

    const before = getSampleMarkersOn()
    fireEvent.click(screen.getByTestId('litho-toggle-samples'))
    expect(getSampleMarkersOn()).toBe(!before)

    openViewMenu('litho')
    fireEvent.click(screen.getByTestId('litho-toggle-samples'))
    expect(getSampleMarkersOn()).toBe(before)
  })

  it('TSD3: the geotech Display menu flips the grain-size hover preview', () => {
    renderToolbar(makeCtx('geotechnical', { activeGeotechModel: makeGeotechModel() }))
    openViewMenu('geotech')

    const before = getPsdPreviewOn()
    fireEvent.click(screen.getByTestId('geotech-toggle-psd-preview'))
    expect(getPsdPreviewOn()).toBe(!before)

    openViewMenu('geotech')
    fireEvent.click(screen.getByTestId('geotech-toggle-psd-preview'))
    expect(getPsdPreviewOn()).toBe(before)
  })

  it('TSD4: the litho view menu flips the same hover-preview switch', () => {
    renderToolbar(makeCtx('lithostratigraphic', { activeLithoModel: makeLithoModel() }))
    openViewMenu('litho')

    const before = getPsdPreviewOn()
    fireEvent.click(screen.getByTestId('litho-toggle-psd-preview'))
    expect(getPsdPreviewOn()).toBe(!before)

    openViewMenu('litho')
    fireEvent.click(screen.getByTestId('litho-toggle-psd-preview'))
    expect(getPsdPreviewOn()).toBe(before)
  })

  it('TSD5: each item names the state it will move to', () => {
    renderToolbar(makeCtx('geotechnical', { activeGeotechModel: makeGeotechModel() }))
    openViewMenu('geotech')

    // Both default ON, so both items offer to hide.
    expect(screen.getByTestId('geotech-toggle-samples').textContent).toMatch(/hide samples/i)
    expect(screen.getByTestId('geotech-toggle-psd-preview').textContent).toMatch(
      /hide psd preview on hover/i,
    )
  })
})
