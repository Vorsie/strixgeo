// The tie the pending chip just centred has to be findable on screen.
//
// Owner dogfeed 2026-08-25: *"Why don't we make that clickable so it HIGHLIGHTS
// the tie?"* — centring alone is not the ask. On a section with a dozen amber
// proposals, arriving at the right place still leaves the engineer hunting.
//
//   TF1  the flashed tie carries a pulse
//   TF2  no other tie does
//   TF3  the pulse traces the tie's OWN geometry, so it cannot drift from it
//   TF4  it never eats a gesture (pointer-events: none)
//   TF5  no flash id → no pulse anywhere (the ordinary render is unchanged)
//   TF6  a cross-lithology surface tie flashes too — it is a pending tie as
//        much as the ribbon-outline kind, and on the geotech axis the common one

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import CorrelationEdgesOverlay from './CorrelationEdgesOverlay'
import {
  makeColumn,
  makeContact,
  makeFormation,
  makeGeotechEdge,
  renderGeotechAxis,
} from './__fixtures__/correlationOverlayScene'

afterEach(() => cleanup())

describe('CorrelationEdgesOverlay — the pending-tie landing pulse', () => {
  it('TF1: the flashed tie carries a pulse', () => {
    const { container } = renderGeotechAxis([makeGeotechEdge('geo-pending', false)], {
      flashEdgeId: 'geo-pending',
    })
    expect(container.querySelector('[data-testid="tie-flash-geo-pending"]')).not.toBeNull()
  })

  it('TF2: a tie that was NOT asked for stays unmarked', () => {
    const { container } = renderGeotechAxis(
      [makeGeotechEdge('geo-pending', false), makeGeotechEdge('geo-other', false)],
      { flashEdgeId: 'geo-pending' },
    )
    expect(container.querySelector('[data-testid="tie-flash-geo-other"]')).toBeNull()
  })

  it('TF3: the pulse traces the tie’s own geometry', () => {
    // Not "some amber near the tie": the halo takes the tie's points string
    // verbatim, so a change to how the tie bends can never leave the highlight
    // pointing somewhere the tie is not.
    const { container } = renderGeotechAxis([makeGeotechEdge('geo-pending', false)], {
      flashEdgeId: 'geo-pending',
    })
    const flash = container.querySelector('[data-testid="tie-flash-geo-pending"]')!
    const tie =
      container.querySelector('[data-testid="ribbon-outline-geo-pending"]') ??
      container.querySelector('[data-testid="tie-line-geo-pending"]')!
    expect(flash.getAttribute('points')).toBe(tie.getAttribute('points'))
  })

  it('TF4: the pulse never eats the gesture that follows it', () => {
    const { container } = renderGeotechAxis([makeGeotechEdge('geo-pending', false)], {
      flashEdgeId: 'geo-pending',
    })
    const flash = container.querySelector('[data-testid="tie-flash-geo-pending"]')!
    expect(flash.getAttribute('pointer-events')).toBe('none')
  })

  it('TF5: with nothing flashed, the ordinary render is unchanged', () => {
    const { container } = renderGeotechAxis([makeGeotechEdge('geo-pending', false)])
    expect(container.querySelector('[data-testid^="tie-flash-"]')).toBeNull()
    // and the tie itself still draws, so TF1 is not passing on an empty scene.
    expect(container.querySelector('[data-testid="ribbon-outline-geo-pending"]')).not.toBeNull()
  })

  it('TF6: a CROSS-CLASS tie flashes too, tracing its own line', () => {
    // A proposal between two different NAD classes draws as a plain surface
    // tie, not as a ribbon — a different branch of the render with its own
    // geometry. On the geotech axis it is ordinary, so the highlight cannot
    // work on only one of the two shapes.
    const sand = makeFormation('f-nad-12', 'NAD 12')
    const clay = { ...makeFormation('f-nad-21', 'NAD 21'), litho_main_soil_code: 'KLEI' }
    const { container } = render(
      <svg>
        <CorrelationEdgesOverlay
          contacts={[
            makeContact('ca', 'f-nad-12', 'inv-A', 2.0),
            makeContact('cb', 'f-nad-21', 'inv-B', 2.0),
          ]}
          formations={[sand, clay]}
          placedColumns={[makeColumn('inv-A', 100, 5), makeColumn('inv-B', 200, 20)]}
          levelToScreen={(level: number) => 20 + (10 - level) * 10}
          plotTop={20}
          plotBottom={200}
          contactEdges={[makeGeotechEdge('geo-cross', false)]}
          flashEdgeId="geo-cross"
        />
      </svg>,
    )
    const flash = container.querySelector('[data-testid="tie-flash-geo-cross"]')
    expect(flash).not.toBeNull()
    const line = container.querySelector('[data-testid="tie-line-geo-cross"]')!
    expect(flash!.getAttribute('points')).toBe(line.getAttribute('points'))
  })
})
