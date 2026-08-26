// "Show model fill" on the GEOTECH axis of the Sections stage.
//
// Owner (2026-08-26): "rebuilding the 3d model now, the model is rebuild, can
// we show the actual 3D model on the 2d sections just like in litho stage".
//
// The litho axis keeps its view switches in the "Bodies" menu and the geotech
// axis keeps its own in "Display", so the peer of the litho item lands in the
// geotech Display menu — same wording, same "names the state it will move to"
// label, same silent no-op when nothing has been built yet.
//
// Claims pinned:
//   GMT1  The geotech Display menu offers the model fill, and picking it flips
//         the geotech switch.
//   GMT2  Picking it does NOT move the litho switch — the two axes each show
//         their own model.
//   GMT3  The item names the state it will move to (the menu has no checkmark).
//   GMT4  The litho Bodies menu still offers its own model fill, and picking it
//         flips the LITHO switch only. Control: the litho axis is unchanged.
//   GMT5  The geotech menu offers exactly one model-fill item — the litho item
//         is not duplicated onto this axis.
//   GMT6  The model fill sits DIRECTLY BESIDE the fill he always had. Owner,
//         dogfeed 2026-08-26: "i want to keep the old show fill and wanted a
//         new model fill next to it" — the two are siblings in one menu, read
//         as a pair, and picking between them is the whole gesture.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type { SectionModelAxis } from '../../../hooks/useSections'
import SectionsToolbar from './SectionsToolbar'
import { makeShellCtx, makeGeotechModel, makeLithoModel } from './__fixtures__/sectionsShellContext'
import {
  getGeotechModelFillVisible,
  setGeotechModelFill,
} from '../../../utils/geotechModelFillStore'
import { getFormationFillVisible, setFormationFill } from '../../../utils/formationFillStore'

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

beforeEach(() => {
  // Both stores are module-global; start every case from the shipped default.
  // They differ on purpose: the litho model fill has always been on, the geotech
  // one arrives off so it cannot displace the packing fill on reload (GMF1).
  setGeotechModelFill(false)
  setFormationFill(true)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SectionsToolbar — the built model on the geotech axis', () => {
  it('GMT1: the geotech Display menu flips the geotech model fill', () => {
    renderToolbar(makeCtx('geotechnical', { activeGeotechModel: makeGeotechModel() }))
    openViewMenu('geotech')

    fireEvent.click(screen.getByTestId('geotech-toggle-model-fill'))
    expect(getGeotechModelFillVisible()).toBe(true)

    openViewMenu('geotech')
    fireEvent.click(screen.getByTestId('geotech-toggle-model-fill'))
    expect(getGeotechModelFillVisible()).toBe(false)
  })

  it('GMT2: flipping it leaves the litho axis’s own switch alone', () => {
    renderToolbar(makeCtx('geotechnical', { activeGeotechModel: makeGeotechModel() }))
    openViewMenu('geotech')

    fireEvent.click(screen.getByTestId('geotech-toggle-model-fill'))

    expect(getFormationFillVisible()).toBe(true)
  })

  it('GMT3: the item names the state it will move to', () => {
    renderToolbar(makeCtx('geotechnical', { activeGeotechModel: makeGeotechModel() }))
    openViewMenu('geotech')

    // Default is OFF, so the item offers to show.
    expect(screen.getByTestId('geotech-toggle-model-fill').textContent).toMatch(/show model fill/i)

    fireEvent.click(screen.getByTestId('geotech-toggle-model-fill'))
    openViewMenu('geotech')
    expect(screen.getByTestId('geotech-toggle-model-fill').textContent).toMatch(/hide model fill/i)
  })

  it('GMT4: the litho Bodies menu still flips the LITHO model fill only', () => {
    renderToolbar(makeCtx('lithostratigraphic', { activeLithoModel: makeLithoModel() }))
    openViewMenu('litho')

    fireEvent.click(screen.getByTestId('litho-toggle-model-fill'))

    expect(getFormationFillVisible()).toBe(false)
    expect(getGeotechModelFillVisible()).toBe(false)
  })

  it('GMT5: the geotech menu carries no second, litho-labelled model-fill item', () => {
    renderToolbar(makeCtx('geotechnical', { activeGeotechModel: makeGeotechModel() }))
    openViewMenu('geotech')

    expect(screen.queryByTestId('litho-toggle-model-fill')).toBeNull()
  })

  it('GMT6: the model fill sits directly beside the fill he always had', () => {
    renderToolbar(makeCtx('geotechnical', { activeGeotechModel: makeGeotechModel() }))
    openViewMenu('geotech')

    const order = Array.from(document.querySelectorAll('[data-testid^="geotech-toggle-"]')).map(el =>
      el.getAttribute('data-testid'),
    )

    // Both are on the menu at once — neither replaced the other.
    expect(order).toContain('geotech-toggle-fill')
    expect(order).toContain('geotech-toggle-model-fill')
    // And nothing sits between them: they read as one pair to pick from.
    expect(order.indexOf('geotech-toggle-model-fill')).toBe(order.indexOf('geotech-toggle-fill') + 1)
  })
})
