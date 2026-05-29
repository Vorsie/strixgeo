// Tests for the generic <ContextMenu> (#164).
//
//   CM1  DOM: renders header + enabled items with role=menu/menuitem + testids.
//   CM2  DOM: clicking an enabled item runs its action then onClose exactly once
//        (the stopImmediatePropagation guard prevents a double onClose).
//   CM3  DOM: Esc closes; an outside document click closes.
//   CM4  DOM: a disabled item is not clickable and shows its reason sub-line.
//   CM5  DOM: falsy items are skipped (callers can inline `cond && {…}`).
//   CM6  SVG: renders inside a <foreignObject>; item click runs action + close.
//   CM7  SVG: the backdrop dismisses on click and on right-click.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ContextMenu, { type ContextMenuItem } from './ContextMenu'

afterEach(cleanup)

describe('ContextMenu (DOM variants)', () => {
  it('CM1 — renders header and items with roles + testids', () => {
    const items: ContextMenuItem[] = [
      { label: 'Focus this test', onClick: vi.fn(), testid: 'focus-item' },
      { label: 'Delete', onClick: vi.fn(), danger: true, topBorder: true },
    ]
    render(
      <ContextMenu portal="fixed" x={10} y={20} header="CPT-42" items={items} onClose={vi.fn()} testid="m" />,
    )
    expect(screen.getByTestId('m').getAttribute('role')).toBe('menu')
    expect(screen.getByText('CPT-42')).toBeTruthy()
    expect(screen.getByTestId('focus-item')).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /focus this test/i })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /delete/i })).toBeTruthy()
  })

  it('CM2 — clicking an enabled item runs the action then onClose exactly once', () => {
    const action = vi.fn()
    const onClose = vi.fn()
    render(
      <ContextMenu
        portal="fixed"
        x={0}
        y={0}
        items={[{ label: 'Go', onClick: action }]}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByRole('menuitem', { name: /go/i }))
    expect(action).toHaveBeenCalledTimes(1)
    // The document-level dismiss listener must NOT also fire (would be 2).
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('CM3 — Esc and outside click both close', () => {
    const onClose = vi.fn()
    render(
      <ContextMenu
        portal="absolute"
        x={0}
        y={0}
        items={[{ label: 'Go', onClick: vi.fn() }]}
        onClose={onClose}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(document.body)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('CM4 — a disabled item is inert and shows its reason', () => {
    const action = vi.fn()
    const onClose = vi.fn()
    render(
      <ContextMenu
        portal="fixed"
        x={0}
        y={0}
        items={[{ label: 'Pinch out', onClick: action, disabled: true, reason: 'No neighbour' }]}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByRole('menuitem', { name: /pinch out/i }))
    expect(action).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('No neighbour')).toBeTruthy()
  })

  it('CM5 — falsy items are skipped', () => {
    const show = false
    render(
      <ContextMenu
        portal="fixed"
        x={0}
        y={0}
        items={[{ label: 'Always', onClick: vi.fn() }, show && { label: 'Hidden', onClick: vi.fn() }]}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('menuitem', { name: /always/i })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /hidden/i })).toBeNull()
  })
})

describe('ContextMenu (SVG variant)', () => {
  function renderInSvg(ui: React.ReactElement): void {
    render(<svg>{ui}</svg>)
  }

  it('CM6 — renders in a foreignObject; item click runs action + close', () => {
    const action = vi.fn()
    const onClose = vi.fn()
    renderInSvg(
      <ContextMenu
        portal="svg"
        x={5}
        y={5}
        width={200}
        height={48}
        items={[{ label: 'Delete correlation', onClick: action }]}
        onClose={onClose}
        testid="edge-menu"
      />,
    )
    expect(screen.getByTestId('edge-menu')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: /delete correlation/i }))
    expect(action).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('CM7 — backdrop dismisses on click and on right-click', () => {
    const onClose = vi.fn()
    const { container } = render(
      <svg>
        <ContextMenu
          portal="svg"
          x={0}
          y={0}
          width={100}
          height={48}
          items={[{ label: 'X', onClick: vi.fn() }]}
          onClose={onClose}
        />
      </svg>,
    )
    // The backdrop is the last div inside the foreignObject.
    const backdrop = container.querySelector('foreignObject > div:last-of-type') as HTMLElement
    expect(backdrop).toBeTruthy()
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.contextMenu(backdrop)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('CM8 — svg variant closes on a document click elsewhere (backdrop may not cover)', () => {
    // dogfeed 2026-05-29: a fixed backdrop nested in an SVG foreignObject does
    // not reliably cover the viewport, so a click on the canvas elsewhere left
    // the menu open. The document click listener is the reliable fallback.
    const onClose = vi.fn()
    render(
      <svg>
        <ContextMenu
          portal="svg"
          x={0}
          y={0}
          width={100}
          height={48}
          items={[{ label: 'X', onClick: vi.fn() }]}
          onClose={onClose}
        />
      </svg>,
    )
    fireEvent.click(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
