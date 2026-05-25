import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Field } from './Field'
import { LegendChip } from './LegendChip'
import { LegendSection } from './LegendSection'
import { TrackHeader } from './TrackHeader'
import { WrappedText } from './WrappedText'

describe('Field', () => {
  it('renders label + value', () => {
    const { getByText } = render(<Field label="Boring" value="BH-1" />)
    expect(getByText('Boring')).toBeDefined()
    expect(getByText('BH-1')).toBeDefined()
  })

  it('applies amber warn styling when warn=true', () => {
    const { getByText } = render(
      <Field label="Z (mTAW)" value="— missing —" warn />,
    )
    const span = getByText('— missing —')
    expect(span.className).toMatch(/text-amber-600/)
    expect(span.className).toMatch(/italic/)
  })

  it('bolds when bold=true', () => {
    const { getByText } = render(<Field label="Boring" value="BH-1" bold />)
    expect(getByText('BH-1').className).toMatch(/font-semibold/)
  })
})

describe('TrackHeader', () => {
  it('renders title and subtitle inside an <svg>', () => {
    const { container, getByText } = render(
      <svg>
        <TrackHeader x={0} y={0} width={100} title="Coded lithology" subtitle="DOV / 2024" />
      </svg>,
    )
    expect(getByText('Coded lithology')).toBeDefined()
    expect(getByText('DOV / 2024')).toBeDefined()
    expect(container.querySelector('rect')).not.toBeNull()
  })

  it('omits subtitle when null', () => {
    const { queryAllByText } = render(
      <svg>
        <TrackHeader x={0} y={0} width={100} title="A" subtitle={null} />
      </svg>,
    )
    // Only one <text> element — the title.
    expect(queryAllByText('A').length).toBe(1)
  })

  it('truncates very long titles', () => {
    const { container } = render(
      <svg>
        <TrackHeader
          x={0}
          y={0}
          width={100}
          title="a-very-long-track-title-that-needs-trimming"
          subtitle={null}
        />
      </svg>,
    )
    const txt = container.querySelector('text')!.textContent ?? ''
    expect(txt.endsWith('…')).toBe(true)
  })

  it('calls onHide when the header is clicked', () => {
    const onHide = vi.fn()
    const { container } = render(
      <svg>
        <TrackHeader x={0} y={0} width={100} title="Coded lithology" subtitle={null} onHide={onHide} />
      </svg>,
    )
    // The outer <g> is the click target.
    const g = container.querySelector('g')!
    fireEvent.click(g)
    expect(onHide).toHaveBeenCalledOnce()
  })

  it('sets cursor:pointer on the header group when onHide is provided', () => {
    const { container } = render(
      <svg>
        <TrackHeader x={0} y={0} width={100} title="Coded lithology" subtitle={null} onHide={() => {}} />
      </svg>,
    )
    const g = container.querySelector('g') as SVGGElement
    expect(g.style.cursor).toBe('pointer')
  })

  it('does not set cursor:pointer when onHide is absent', () => {
    const { container } = render(
      <svg>
        <TrackHeader x={0} y={0} width={100} title="Coded lithology" subtitle={null} />
      </svg>,
    )
    const g = container.querySelector('g') as SVGGElement
    // No inline cursor when onHide is not provided.
    expect(g.style.cursor).toBe('')
  })

  it('does not call onHide when none supplied (no crash on click)', () => {
    // Clicking a header without onHide should be a no-op, not a crash.
    const { container } = render(
      <svg>
        <TrackHeader x={0} y={0} width={100} title="Coded lithology" subtitle={null} />
      </svg>,
    )
    const g = container.querySelector('g')!
    // Should not throw.
    expect(() => fireEvent.click(g)).not.toThrow()
  })

  // Regression anchor for debt #115 sub-item 3 — raw-token tooltip.
  it('RT1 — rawToken prop renders as SVG <title> on the rect (debt #115)', () => {
    const { container } = render(
      <svg>
        <TrackHeader
          x={0}
          y={0}
          width={100}
          title="Coded lithology"
          subtitle={null}
          rawToken="coded_lithology"
        />
      </svg>,
    )
    // SVG <title> is the accessible tooltip mechanism; its text is the raw token.
    const title = container.querySelector('rect > title')
    expect(title).not.toBeNull()
    expect(title!.textContent).toBe('coded_lithology')
  })

  it('RT2 — rawToken is overridden by "Hide column" when onHide is set (debt #115)', () => {
    // When both rawToken and onHide are provided, the action tooltip
    // ("Hide column") takes priority over the informational token.
    const { container } = render(
      <svg>
        <TrackHeader
          x={0}
          y={0}
          width={100}
          title="Coded lithology"
          subtitle={null}
          rawToken="coded_lithology"
          onHide={() => {}}
        />
      </svg>,
    )
    const title = container.querySelector('rect > title')
    expect(title).not.toBeNull()
    expect(title!.textContent).toBe('Hide column')
  })

  it('RT3 — no <title> element when neither rawToken nor onHide is supplied', () => {
    const { container } = render(
      <svg>
        <TrackHeader x={0} y={0} width={100} title="Drill method" subtitle={null} />
      </svg>,
    )
    expect(container.querySelector('rect > title')).toBeNull()
  })
})

describe('LegendSection + LegendChip', () => {
  it('renders title + children', () => {
    const { getByText } = render(
      <LegendSection title="Soil patterns">
        <LegendChip code="FZf" label="Fine sand" />
        <LegendChip code="KL" label="Clay" />
      </LegendSection>,
    )
    expect(getByText('Soil patterns')).toBeDefined()
    expect(getByText('FZf')).toBeDefined()
    expect(getByText('Fine sand')).toBeDefined()
    expect(getByText('KL')).toBeDefined()
  })

  it('LegendChip renders an optional preview node', () => {
    const { container } = render(
      <LegendChip
        code="aux"
        label="Auxiliary"
        preview={<svg data-testid="preview" />}
      />,
    )
    expect(container.querySelector('[data-testid="preview"]')).not.toBeNull()
  })
})

describe('WrappedText', () => {
  it('emits at least one <tspan> for a short input', () => {
    const { container } = render(
      <svg>
        <WrappedText
          text="Hello"
          centerX={50}
          centerY={20}
          maxWidth={200}
          maxHeight={40}
          fontSize={11}
          fill="#000"
        />
      </svg>,
    )
    const tspans = container.querySelectorAll('tspan')
    expect(tspans.length).toBeGreaterThanOrEqual(1)
    expect(tspans[0].textContent).toBe('Hello')
  })

  it('wraps long text across multiple lines + ellipsises when overflowing', () => {
    const { container } = render(
      <svg>
        <WrappedText
          text="Paleogeen Formatie van Kortrijk Lid van Roubaix extra extra extra"
          centerX={50}
          centerY={20}
          maxWidth={60}
          maxHeight={36}
          fontSize={11}
          fill="#000"
        />
      </svg>,
    )
    const tspans = container.querySelectorAll('tspan')
    expect(tspans.length).toBeGreaterThan(1)
    const last = tspans[tspans.length - 1].textContent ?? ''
    expect(last.endsWith('…')).toBe(true)
  })
})
