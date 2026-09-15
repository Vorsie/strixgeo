/**
 * Pins for ``forwardColumnContextMenu`` — the installer #40 fix that makes a
 * right-click over a COLUMN open the unified column menu even when a fill overlay
 * (Fill bands / the built-model fill) is painted on top and "eats" the click.
 *
 * The owner (installer #40, verbatim): *"litho axis edit composition is fine
 * (when the model overlay is there, it eats my click however and i only get unit
 * statistics)"*. The rule: over a column the column menu always wins; the fill's
 * body menu is for the fill BETWEEN columns only.
 *
 * jsdom has no layout, so ``document.elementsFromPoint`` is stubbed with the hit
 * stack each case describes.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { forwardContextMenuToColumn, isColumnMenuSurface } from './forwardColumnContextMenu'

/** Build an element carrying a ``data-testid`` and a contextmenu spy. */
function makeEl(testid: string | null): { el: HTMLElement; onContextMenu: ReturnType<typeof vi.fn> } {
  const el = document.createElement('div')
  if (testid !== null) el.setAttribute('data-testid', testid)
  const onContextMenu = vi.fn()
  el.addEventListener('contextmenu', onContextMenu)
  document.body.appendChild(el)
  return { el, onContextMenu }
}

/**
 * jsdom does not implement ``elementsFromPoint``; install a stub returning the
 * given hit stack (top-first) for the duration of one case.
 */
function stubHitStack(stack: readonly Element[]): void {
  ;(document as unknown as { elementsFromPoint: (x: number, y: number) => Element[] }).elementsFromPoint =
    () => [...stack]
}

afterEach(() => {
  vi.restoreAllMocks()
  delete (document as unknown as { elementsFromPoint?: unknown }).elementsFromPoint
  document.body.replaceChildren()
})

describe('isColumnMenuSurface', () => {
  it('recognises the per-column litho band and the capture rect, nothing else', () => {
    expect(isColumnMenuSurface(makeEl('per-column-litho-band-cpt-1__2').el)).toBe(true)
    expect(isColumnMenuSurface(makeEl('per-column-rclick-capture-cpt-1').el)).toBe(true)
    // A fill overlay element (the model fill and the partition region) is NOT a
    // column surface, so it is skipped by the forward.
    expect(isColumnMenuSurface(makeEl('model-fill-body-9').el)).toBe(false)
    expect(isColumnMenuSurface(makeEl('partition-region-body-9').el)).toBe(false)
    expect(isColumnMenuSurface(makeEl(null).el)).toBe(false)
  })
})

describe('forwardContextMenuToColumn', () => {
  it('over a column: the click is re-aimed at the column band, never the fill', () => {
    // The hit stack top-first: the model fill caught the event, the partition
    // region is under it, the ContactsLayer band is under both.
    const fillTop = makeEl('model-fill-body-9')
    const fillMid = makeEl('partition-region-body-9')
    const band = makeEl('per-column-litho-band-cpt-1__2')
    stubHitStack([fillTop.el, fillMid.el, band.el])

    const forwarded = forwardContextMenuToColumn(100, 100)

    expect(forwarded).toBe(true)
    // The band — the column menu's own surface — got the contextmenu; NEITHER
    // fill overlay did (they are skipped so a second painted fill cannot steal it).
    expect(band.onContextMenu).toHaveBeenCalledTimes(1)
    expect(fillTop.onContextMenu).not.toHaveBeenCalled()
    expect(fillMid.onContextMenu).not.toHaveBeenCalled()
  })

  it('between columns: no column surface beneath, so it does not forward', () => {
    // The click landed on the fill in the gap between two columns — only fill
    // elements are beneath, no column surface — so the caller keeps its own menu.
    const fillTop = makeEl('model-fill-body-9')
    const fillMid = makeEl('partition-region-body-9')
    stubHitStack([fillTop.el, fillMid.el])

    const forwarded = forwardContextMenuToColumn(100, 100)

    expect(forwarded).toBe(false)
    expect(fillTop.onContextMenu).not.toHaveBeenCalled()
    expect(fillMid.onContextMenu).not.toHaveBeenCalled()
  })
})
