// Pins for the model-fill "Unit statistics…" jump — owner ruling S6,
// 2026-08-27, verbatim: "right click a fill region only works for normal
// fill, not model fill."
//
// The built-model fill must offer the SAME right-click jump as the computed
// fill; regions report their FORMATION id (the identity the overlay's
// colouring already keys on) — the axis's own scope kind is stamped by the
// caller's handler, exactly as on the computed fill.
//
// MF-US1 — Mode B: right-click a model-fill region offers "Unit statistics…"
//          and reports the FORMATION of the clicked region.
// MF-US2 — Mode A (per-test strips): the same jump works there.
// MF-US3 — without the handler nothing changes: every element keeps
//          pointer-events none and right-click opens no menu.
// MF-US4 — the jump closes the menu.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ModelFillOverlay from './ModelFillOverlay'
import type { ModelFillOverlayProps } from './ModelFillOverlay'
import type { SectionPoly, SolidColumn } from '../../utils/sectionFromSolids'

afterEach(() => cleanup())

const alongMToScreenX = (m: number): number => m
const levelToScreen = (z: number): number => -z

function renderOverlay(props: Partial<ModelFillOverlayProps> = {}): ReturnType<typeof render> {
  return render(
    <svg>
      <ModelFillOverlay
        opacity={0.6}
        alongMToScreenX={alongMToScreenX}
        levelToScreen={levelToScreen}
        {...props}
      />
    </svg>,
  )
}

const POLY: SectionPoly = {
  bodyId: 'b1',
  formationId: 'formation-sand',
  color: '#ff0000',
  points: [
    { alongM: 0, elev: 0 },
    { alongM: 100, elev: 0 },
    { alongM: 100, elev: -5 },
    { alongM: 0, elev: -5 },
  ],
}

const COLUMN: SolidColumn = {
  testId: 'T1',
  alongM: 50,
  segments: [
    { bodyId: 'b2', formationId: 'formation-clay', color: '#0000ff', topElev: 0, baseElev: -3 },
  ],
}

describe('ModelFillOverlay — "Unit statistics…" on the model fill (S6)', () => {
  it('MF-US1 — Mode B: right-click offers the jump and reports the clicked region FORMATION', () => {
    const onShowUnitStatistics = vi.fn()
    const { container } = renderOverlay({ polys: [POLY], onShowUnitStatistics })

    const region = container.querySelector('[data-testid="model-fill-b1"]')!
    fireEvent.contextMenu(region, { clientX: 40, clientY: 40 })
    fireEvent.click(screen.getByTestId('model-fill-menu-unit-statistics'))

    // The FORMATION id — never the body id — the same contract as every
    // other jump surface.
    expect(onShowUnitStatistics).toHaveBeenCalledWith('formation-sand')
  })

  it('MF-US2 — Mode A: the per-test strips offer the same jump', () => {
    const onShowUnitStatistics = vi.fn()
    const { container } = renderOverlay({ columns: [COLUMN], onShowUnitStatistics })

    const strip = container.querySelector('[data-testid="model-fill-b2"]')!
    fireEvent.contextMenu(strip, { clientX: 50, clientY: 2 })
    fireEvent.click(screen.getByTestId('model-fill-menu-unit-statistics'))

    expect(onShowUnitStatistics).toHaveBeenCalledWith('formation-clay')
  })

  it('MF-US3 — without the handler every element stays inert (pointer-events none)', () => {
    const { container } = renderOverlay({ polys: [POLY] })
    const region = container.querySelector('[data-testid="model-fill-b1"]')!
    expect(region.getAttribute('pointer-events')).toBe('none')
    fireEvent.contextMenu(region, { clientX: 40, clientY: 40 })
    expect(screen.queryByTestId('model-fill-menu')).toBeNull()
  })

  it('MF-US4 — the jump closes the menu', () => {
    const onShowUnitStatistics = vi.fn()
    const { container } = renderOverlay({ polys: [POLY], onShowUnitStatistics })
    fireEvent.contextMenu(container.querySelector('[data-testid="model-fill-b1"]')!, {
      clientX: 40,
      clientY: 40,
    })
    fireEvent.click(screen.getByTestId('model-fill-menu-unit-statistics'))
    expect(screen.queryByTestId('model-fill-menu')).toBeNull()
  })
})
