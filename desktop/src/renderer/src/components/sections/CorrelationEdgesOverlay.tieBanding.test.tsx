// "Accepted, not banded" — owner ruling 2026-10-04, "identity follows the drawing".
//
// Bands are one body ONLY where the section fill paints them as one mass; an
// accepted tie the fill does not paint as a band joins nothing (the CS4 lone top
// tie in the sub-TD zone). The engineer then sees one tie and two bodies in the
// Parameters tree, so the tie itself must say why when he hovers it: "Accepted,
// not banded: the bands stay separate bodies".
//
// The control (TB-O2) is the point: a title on every accepted tie would pass TB-O1
// just as well.

import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { makeGeotechEdge, renderGeotechAxis } from './__fixtures__/correlationOverlayScene'
import { t } from '../../i18n/translate'

afterEach(() => cleanup())

const noop = (): void => {}

describe('CorrelationEdgesOverlay — an accepted tie the fill does not band says so', () => {
  it('TB-O1 — two bodies under an accepted tie: the tie reads "accepted, not banded"', () => {
    const { container } = renderGeotechAxis([makeGeotechEdge('cs4-top-tie', true)], {
      onRequestDeleteEdge: noop,
      bodyIdByLayerId: new Map([
        ['ca', 'body-s20'],
        ['cb', 'body-s21'],
      ]),
    })

    const ribbon = container.querySelector('[data-testid="ribbon-cs4-top-tie"]')!
    expect(ribbon.getAttribute('data-banded')).toBe('false')
    const hit = container.querySelector('[data-testid="edge-hit-cs4-top-tie"]')!
    expect(hit.querySelector('title')?.textContent).toBe(t('sections.tie.acceptedNotBanded'))
  })

  it('TB-O2 — one body under the tie (the fill painted the band): no warning title', () => {
    const { container } = renderGeotechAxis([makeGeotechEdge('banded-tie', true)], {
      onRequestDeleteEdge: noop,
      bodyIdByLayerId: new Map([
        ['ca', 'body-1'],
        ['cb', 'body-1'],
      ]),
    })

    expect(
      container.querySelector('[data-testid="ribbon-banded-tie"]')!.getAttribute('data-banded'),
    ).toBe('true')
    expect(container.querySelector('[data-testid="edge-hit-banded-tie"] title')).toBeNull()
  })

  it('TB-O3 — a pending proposal states nothing about bodies', () => {
    const { container } = renderGeotechAxis([makeGeotechEdge('pending-tie', false)], {
      onRequestDeleteEdge: noop,
      bodyIdByLayerId: new Map([
        ['ca', 'body-s20'],
        ['cb', 'body-s21'],
      ]),
    })

    expect(
      container.querySelector('[data-testid="ribbon-pending-tie"]')!.hasAttribute('data-banded'),
    ).toBe(false)
  })

  it('TB-O4 — no body stamps passed: the overlay stays silent (additive prop)', () => {
    const { container } = renderGeotechAxis([makeGeotechEdge('legacy-tie', true)], {
      onRequestDeleteEdge: noop,
    })

    expect(
      container.querySelector('[data-testid="ribbon-legacy-tie"]')!.hasAttribute('data-banded'),
    ).toBe(false)
    expect(container.querySelector('[data-testid="edge-hit-legacy-tie"] title')).toBeNull()
  })
})
