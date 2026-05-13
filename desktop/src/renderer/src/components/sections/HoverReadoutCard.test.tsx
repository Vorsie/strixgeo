// Smoke + geometry tests for the shared HoverReadoutCard.
//
// Both ContactPickBar (4 lines) and BoreholeColumn (2 lines) render
// through this — the auto-height logic and the Y-clamp are the two
// behaviours worth pinning so a future "I tweaked the padding"
// change doesn't silently push the card outside the plot area.

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import HoverReadoutCard from './HoverReadoutCard'

function rectOf(container: HTMLElement): SVGRectElement {
  const rect = container.querySelector('rect')
  if (!rect) throw new Error('HoverReadoutCard rendered no rect')
  return rect as unknown as SVGRectElement
}

describe('HoverReadoutCard', () => {
  it('renders one text element per line and the surrounding rect', () => {
    const { container } = render(
      <svg>
        <HoverReadoutCard
          x={10}
          y={50}
          plotTop={0}
          plotBottom={200}
          lines={[{ text: 'depth 1.23 m' }, { text: '+5.00 m TAW' }]}
        />
      </svg>,
    )
    expect(container.querySelectorAll('text').length).toBe(2)
    expect(container.querySelectorAll('rect').length).toBe(1)
  })

  it('renders each line text verbatim and applies the per-line colour', () => {
    const { container } = render(
      <svg>
        <HoverReadoutCard
          x={0}
          y={50}
          plotTop={0}
          plotBottom={200}
          lines={[
            { text: 'depth 1.23 m' },
            { text: 'qc 4.50 MPa', color: '#111827' },
          ]}
        />
      </svg>,
    )
    const texts = Array.from(container.querySelectorAll('text'))
    expect(texts[0].textContent).toBe('depth 1.23 m')
    expect(texts[0].getAttribute('fill')).toBe('#374151') // default slate-700
    expect(texts[1].textContent).toBe('qc 4.50 MPa')
    expect(texts[1].getAttribute('fill')).toBe('#111827')
  })

  it('grows the card height with line count', () => {
    const { container: c2 } = render(
      <svg>
        <HoverReadoutCard
          x={0}
          y={50}
          plotTop={0}
          plotBottom={200}
          lines={[{ text: 'a' }, { text: 'b' }]}
        />
      </svg>,
    )
    const { container: c4 } = render(
      <svg>
        <HoverReadoutCard
          x={0}
          y={50}
          plotTop={0}
          plotBottom={200}
          lines={[{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }]}
        />
      </svg>,
    )
    const h2 = Number(rectOf(c2).getAttribute('height'))
    const h4 = Number(rectOf(c4).getAttribute('height'))
    expect(h4).toBeGreaterThan(h2)
  })

  it('clamps the card Y to plotTop when the requested y sits above', () => {
    // y = -100 with plotTop = 0 puts the card's centre way above
    // the plot. Card should anchor at plotTop + halfH so its top
    // edge sits on plotTop.
    const { container } = render(
      <svg>
        <HoverReadoutCard
          x={0}
          y={-100}
          plotTop={0}
          plotBottom={200}
          lines={[{ text: 'a' }, { text: 'b' }]}
        />
      </svg>,
    )
    const top = Number(rectOf(container).getAttribute('y'))
    expect(top).toBeGreaterThanOrEqual(0)
  })

  it('clamps the card Y to plotBottom when the requested y sits below', () => {
    const { container } = render(
      <svg>
        <HoverReadoutCard
          x={0}
          y={1000}
          plotTop={0}
          plotBottom={200}
          lines={[{ text: 'a' }, { text: 'b' }]}
        />
      </svg>,
    )
    const top = Number(rectOf(container).getAttribute('y'))
    const height = Number(rectOf(container).getAttribute('height'))
    expect(top + height).toBeLessThanOrEqual(200)
  })

  it('honours a custom width prop', () => {
    const { container } = render(
      <svg>
        <HoverReadoutCard
          x={0}
          y={50}
          plotTop={0}
          plotBottom={200}
          width={140}
          lines={[{ text: 'a' }]}
        />
      </svg>,
    )
    expect(rectOf(container).getAttribute('width')).toBe('140')
  })
})
