// Finding B (installer #40): the yellow "!" geotech staleness marker "doesn't
// point the user to how to solve it." Besides the marker's own tooltip, the
// Sections inspector gains a "Packing out of date" line on the geotech axis:
// it names what it means, what to do, the affected columns, and offers a
// Subdivide button (wired through the toolbar's gated press).

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import SectionsInspector from './SectionsInspector'
import { makeStubContext } from './__fixtures__/shellStub'
import { publishGeotechSubdivideAction } from '../../../utils/geotechSubdivideActionStore'

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: { validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }) },
      virtueleBoring: { getModels: vi.fn().mockResolvedValue([]) },
    },
  }
})
vi.mock('../../../utils/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}))
vi.mock('../../../components/sections/VirtueleBoringStrip', () => ({ default: () => null }))

/** A geotech-axis context with one column whose packing is out of date. */
function geotechStaleContext(): ShellContextValue {
  const ctx = makeStubContext()
  ctx.sections.sectionModelAxis = 'geotechnical'
  ctx.sections.selectedSectionId = ctx.sections.sections[0]?.id ?? 'sec-1'
  ctx.geoModel.staleLithoGeotechColumns = [
    { investigation_id: 'inv-s23', label: 'GEO-25/021-S23' },
  ]
  return ctx
}

beforeEach(() => {
  publishGeotechSubdivideAction({ available: false, press: () => {} })
})
afterEach(() => {
  cleanup()
  publishGeotechSubdivideAction({ available: false, press: () => {} })
})

describe('SectionsInspector — stale packing line (geotech axis)', () => {
  it('SGI1: names WHAT IT MEANS and WHAT TO DO, and the affected column', () => {
    render(
      <ShellContext.Provider value={geotechStaleContext()}>
        <SectionsInspector />
      </ShellContext.Provider>,
    )
    const note = screen.getByTestId('geotech-stale-packing-note')
    expect(note.textContent).toContain('older lithology')
    expect(note.textContent).toContain('Subdivide')
    // The column the engineer must act on is named.
    expect(screen.getByTestId('geotech-stale-packing').textContent).toContain('GEO-25/021-S23')
  })

  it('SGI2: no stale columns → the line is absent', () => {
    const ctx = makeStubContext()
    ctx.sections.sectionModelAxis = 'geotechnical'
    render(
      <ShellContext.Provider value={ctx}>
        <SectionsInspector />
      </ShellContext.Provider>,
    )
    expect(screen.queryByTestId('geotech-stale-packing')).toBeNull()
  })

  it('SGI3: the Subdivide button fires the published gated press for this section', () => {
    const press = vi.fn()
    publishGeotechSubdivideAction({ available: true, press })
    const ctx = geotechStaleContext()
    render(
      <ShellContext.Provider value={ctx}>
        <SectionsInspector />
      </ShellContext.Provider>,
    )
    fireEvent.click(screen.getByTestId('geotech-stale-packing-subdivide'))
    expect(press).toHaveBeenCalledWith(ctx.sections.selectedSectionId)
  })

  it('SGI4: no Subdivide button when no gated press is available', () => {
    // available:false (the default reset in beforeEach) — the line still
    // explains, but offers no button that would do nothing.
    render(
      <ShellContext.Provider value={geotechStaleContext()}>
        <SectionsInspector />
      </ShellContext.Provider>,
    )
    expect(screen.getByTestId('geotech-stale-packing-note')).toBeTruthy()
    expect(screen.queryByTestId('geotech-stale-packing-subdivide')).toBeNull()
  })
})
