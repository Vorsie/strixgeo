// Smoke + behaviour tests for ColumnGlyph (debt #34).
//
// Component is SVG-heavy; instead of asserting on coordinates, the
// tests target stable, behaviourally-meaningful contracts:
//
//   * The shape vocabulary (CPT = circle, borehole = square) — same
//     identity the map markers use.
//   * The graceful-degrade path when the row has no elevation.
//   * Tie-back chrome appears only when displaced.
//   * Click handler fires through the invisible hit-rect.

import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ColumnGlyph from './ColumnGlyph'

// Pixel-identity transform — the column renders at the level it
// claims to be at, with no rescaling. Lets us assert pixel
// positions without re-deriving the panel's viewport math.
const identity = (level: number): number => level

function renderGlyph(overrides: Partial<React.ComponentProps<typeof ColumnGlyph>> = {}) {
  const defaults: React.ComponentProps<typeof ColumnGlyph> = {
    name: 'CPT-1',
    kind: 'cpt',
    screenX: 100,
    tieBackTrueX: null,
    offset: 0,
    elevation: 10,
    depth: 20,
    levelToScreen: identity,
    plotTop: -100,
    plotBottom: 100,
    onClick: undefined,
  }
  return render(
    <svg>
      <ColumnGlyph {...defaults} {...overrides} />
    </svg>,
  )
}

describe('ColumnGlyph — shape vocabulary', () => {
  it('renders a circle cap for a CPT', () => {
    const { container } = renderGlyph({ kind: 'cpt' })
    expect(container.querySelector('circle')).not.toBeNull()
    expect(container.querySelector('rect[width="7"][height="7"]')).toBeNull()
  })

  it('renders a square cap for a borehole', () => {
    const { container } = renderGlyph({ kind: 'borehole', name: 'BH-1' })
    expect(container.querySelector('rect[width="7"][height="7"]')).not.toBeNull()
    expect(container.querySelector('circle')).toBeNull()
  })
})

describe('ColumnGlyph — graceful degrade on missing data', () => {
  it('still renders a cap when elevation is null (faded "unknown" marker at level 0)', () => {
    // The component floats the column at level=0 with a faded tone
    // rather than dropping it; engineers should see the row exists
    // even when we can't position it on Y.
    const { container } = renderGlyph({ elevation: null })
    const circle = container.querySelector('circle')
    expect(circle).not.toBeNull()
    // Faded fill-opacity (0.5) signals the missing-elevation state.
    expect(circle?.getAttribute('fill-opacity')).toBe('0.5')
  })

  it('drops the body line when depth is null (cap-only render)', () => {
    const { container } = renderGlyph({ depth: null })
    // No vertical body line — only the cap remains.
    expect(container.querySelector('line[stroke-width="1.5"]')).toBeNull()
    expect(container.querySelector('circle')).not.toBeNull()
  })
})

describe('ColumnGlyph — tie-back diagonal', () => {
  it('renders no tie-back when tieBackTrueX is null', () => {
    const { container } = renderGlyph({ tieBackTrueX: null })
    // The tie-back tick is the only ``stroke="#6b7280"`` line.
    expect(container.querySelector('line[stroke="#6b7280"]')).toBeNull()
  })

  it('renders a tick + diagonal when displaced from its true X', () => {
    const { container } = renderGlyph({ tieBackTrueX: 50, screenX: 100 })
    const ticks = container.querySelectorAll('line[stroke="#6b7280"]')
    // One vertical tick + one diagonal back to the cap.
    expect(ticks.length).toBe(2)
  })
})

describe('ColumnGlyph — click handler', () => {
  it('fires onClick through the invisible hit-rect', () => {
    const onClick = vi.fn()
    const { container } = renderGlyph({ onClick })
    const hitBox = container.querySelector('rect[fill="transparent"]')
    expect(hitBox).not.toBeNull()
    fireEvent.click(hitBox!)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not render the hit-rect when onClick is absent', () => {
    const { container } = renderGlyph({ onClick: undefined })
    expect(container.querySelector('rect[fill="transparent"]')).toBeNull()
  })
})

describe('ColumnGlyph — stacked horizontal labels (DOV convention)', () => {
  it('renders the name label horizontally with no rotation transform', () => {
    // Previous diagonal -30° rotation produced a "forest of slanted
    // names" at wide zooms. DOV's lengteprofiel stacks horizontal
    // text above each column — easier to scan after a quick zoom-in.
    const { container } = renderGlyph({ name: 'CPT-1' })
    const text = container.querySelector('text')
    expect(text?.getAttribute('transform')).toBeNull()
    expect(text?.getAttribute('text-anchor')).toBe('middle')
  })

  it('renders the signed elevation label below the name when elevation is known', () => {
    const { container } = renderGlyph({ name: 'CPT-1', elevation: 10 })
    const texts = container.querySelectorAll('text')
    expect(texts.length).toBe(2)
    expect(texts[1].textContent).toBe('+10.00 m')
  })

  it('preserves the minus sign on negative elevations', () => {
    const { container } = renderGlyph({ elevation: -3.5 })
    const texts = container.querySelectorAll('text')
    expect(texts[1].textContent).toBe('-3.50 m')
  })

  it('omits the elevation label when elevation is null', () => {
    const { container } = renderGlyph({ elevation: null })
    const texts = container.querySelectorAll('text')
    expect(texts.length).toBe(1)
  })
})

describe('ColumnGlyph — hideStick (band-rendered columns)', () => {
  it('drops the cap + body line when hideStick is true', () => {
    const { container } = renderGlyph({ hideStick: true })
    expect(container.querySelector('circle')).toBeNull()
    expect(container.querySelector('line[stroke-width="1.5"]')).toBeNull()
  })

  it('keeps the name + elevation labels even when hideStick is true', () => {
    // The labels remain as the column's identifier above the band.
    const { container } = renderGlyph({ hideStick: true, elevation: 7.5 })
    const texts = container.querySelectorAll('text')
    expect(texts.length).toBe(2)
    expect(texts[0].textContent).toBe('CPT-1')
    expect(texts[1].textContent).toBe('+7.50 m')
  })

  it('also drops the tie-back diagonal when displaced + hideStick', () => {
    const { container } = renderGlyph({
      tieBackTrueX: 50,
      screenX: 100,
      hideStick: true,
    })
    expect(container.querySelector('line[stroke="#6b7280"]')).toBeNull()
  })
})

describe('ColumnGlyph — offset hint in label', () => {
  it('omits the offset hint when |offset| < 1 m', () => {
    const { container } = renderGlyph({ offset: 0.4 })
    const text = container.querySelector('text')
    expect(text?.textContent).toBe('CPT-1')
  })

  it('adds a signed-arrow hint when offset crosses 1 m', () => {
    const { container } = renderGlyph({ offset: 12 })
    const text = container.querySelector('text')
    // Positive offset → left-arrow per the docstring convention.
    expect(text?.textContent).toContain('←12 m')
  })
})
