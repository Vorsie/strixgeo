// A section whose endpoints cannot be map coordinates must SAY SO.
//
// Root cause of the 2026-08-02 DEM flood, proven on the dev DB 2026-08-03: two
// `cross_section` rows named 'good' and 'test' carry (0,0)→(1,0) while
// declaring EPSG:31370. The engineer saw no ground-surface line and no reason
// for it — every /dem/sample went out, 404'd upstream, and the renderer
// swallowed the answer at debug level.
//
// The rule: opening such a section names the defect once, so the row can be
// fixed or deleted instead of silently producing nothing.

import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import { makeShellCtx } from './__fixtures__/sectionsShellContext'
import SectionsCanvas from './SectionsCanvas'

vi.mock('../../../components/SectionPanel', () => ({ default: () => <div /> }))
vi.mock('../../../components/MapView', () => ({ default: () => <div /> }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SectionsCanvas — implausible section coordinates', () => {
  it('warns once, naming the section, when the endpoints are not map coordinates', () => {
    // The shared fixture section is exactly the offending shape:
    // (0,0)→(100,0) in EPSG:31370.
    const ctx = makeShellCtx('lithostratigraphic')

    const { rerender } = render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    // The tuple is widened to the toast signature's own parameter list — it
    // grew an optional replace key (2026-08-15) and this filter reads only the
    // first two.
    const crsWarnings = (): Parameters<typeof ctx.toasts.toast>[] =>
      vi
        .mocked(ctx.toasts.toast)
        .mock.calls.filter(([, message]) => message.includes('outside that CRS'))

    const warnings = crsWarnings()
    expect(warnings).toHaveLength(1)
    expect(warnings[0][0]).toBe('warning')
    // The engineer has to be able to find the row.
    expect(warnings[0][1]).toContain(ctx.sections.sections[0].name)
    expect(warnings[0][1]).toContain('Lambert 72')

    // Re-rendering the same section does not nag.
    rerender(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )
    expect(crsWarnings()).toHaveLength(1)
  })
})
