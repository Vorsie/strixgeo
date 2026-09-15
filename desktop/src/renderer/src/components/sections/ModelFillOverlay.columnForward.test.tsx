/**
 * Installer #40 — the built-model fill overlay must NOT eat a right-click over a
 * column. Owner, verbatim: *"litho axis edit composition is fine (when the model
 * overlay is there, it eats my click however and i only get unit statistics)"*.
 *
 * When ``forwardColumnContextMenu`` is set (the litho axis), a right-click on a
 * model-fill poly that lies over a COLUMN forwards the contextmenu to the
 * ContactsLayer column surface beneath (which opens the unified column menu) and
 * does NOT open the fill's own "Unit statistics…". A right-click BETWEEN columns
 * (no column surface beneath) still opens "Unit statistics…" as before.
 *
 * jsdom has no layout, so ``elementsFromPoint`` is stubbed with the hit stack.
 */

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ModelFillOverlay from './ModelFillOverlay'
import type { SectionPoly } from '../../utils/sectionFromSolids'

const alongMToScreenX = (m: number): number => m
const levelToScreen = (z: number): number => -z

const POLY: SectionPoly = {
  bodyId: 'body-9',
  formationId: 'f-9',
  color: '#c8a15a',
  points: [
    { alongM: 0, elev: 0 },
    { alongM: 10, elev: 0 },
    { alongM: 10, elev: -5 },
    { alongM: 0, elev: -5 },
  ],
}

/** Install a ``elementsFromPoint`` stub returning the given stack, top-first. */
function stubHitStack(stack: readonly Element[]): void {
  ;(document as unknown as { elementsFromPoint: (x: number, y: number) => Element[] }).elementsFromPoint =
    () => [...stack]
}

/** A column surface the forward should land on, with a contextmenu spy. */
function makeColumnSurface(): { el: HTMLElement; onContextMenu: ReturnType<typeof vi.fn> } {
  const el = document.createElement('div')
  el.setAttribute('data-testid', 'per-column-litho-band-cpt-1__2')
  const onContextMenu = vi.fn()
  el.addEventListener('contextmenu', onContextMenu)
  document.body.appendChild(el)
  return { el, onContextMenu }
}

afterEach(() => {
  cleanup()
  delete (document as unknown as { elementsFromPoint?: unknown }).elementsFromPoint
  document.body.replaceChildren()
})

describe('ModelFillOverlay — column contextmenu forwarding (installer #40)', () => {
  it('over a column: forwards to the column surface, does NOT open Unit statistics', () => {
    const onShowUnitStatistics = vi.fn()
    const { container } = render(
      <svg>
        <ModelFillOverlay
          polys={[POLY]}
          opacity={0.6}
          alongMToScreenX={alongMToScreenX}
          levelToScreen={levelToScreen}
          onShowUnitStatistics={onShowUnitStatistics}
          forwardColumnContextMenu
        />
      </svg>,
    )
    const poly = container.querySelector('[data-testid="model-fill-body-9"]')!
    const column = makeColumnSurface()
    // The fill poly is on top, the column surface beneath it.
    stubHitStack([poly, column.el])

    fireEvent.contextMenu(poly, { clientX: 50, clientY: 50 })

    // The column surface got the forwarded contextmenu; the fill's "Unit
    // statistics…" menu never opened.
    expect(column.onContextMenu).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-testid="model-fill-menu"]')).toBeNull()
  })

  it('between columns: no column surface beneath → opens Unit statistics as before', () => {
    const onShowUnitStatistics = vi.fn()
    const { container } = render(
      <svg>
        <ModelFillOverlay
          polys={[POLY]}
          opacity={0.6}
          alongMToScreenX={alongMToScreenX}
          levelToScreen={levelToScreen}
          onShowUnitStatistics={onShowUnitStatistics}
          forwardColumnContextMenu
        />
      </svg>,
    )
    const poly = container.querySelector('[data-testid="model-fill-body-9"]')!
    // Only the fill under the cursor — a gap between columns.
    stubHitStack([poly])

    fireEvent.contextMenu(poly, { clientX: 50, clientY: 50 })

    expect(document.querySelector('[data-testid="model-fill-menu"]')).not.toBeNull()
  })

  it('without the flag (geotech axis): the fill keeps its own menu over a column', () => {
    const onShowUnitStatistics = vi.fn()
    const { container } = render(
      <svg>
        <ModelFillOverlay
          polys={[POLY]}
          opacity={0.6}
          alongMToScreenX={alongMToScreenX}
          levelToScreen={levelToScreen}
          onShowUnitStatistics={onShowUnitStatistics}
        />
      </svg>,
    )
    const poly = container.querySelector('[data-testid="model-fill-body-9"]')!
    const column = makeColumnSurface()
    stubHitStack([poly, column.el])

    fireEvent.contextMenu(poly, { clientX: 50, clientY: 50 })

    // No forward — the fill answers with its own "Unit statistics…" menu.
    expect(column.onContextMenu).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="model-fill-menu"]')).not.toBeNull()
  })
})
