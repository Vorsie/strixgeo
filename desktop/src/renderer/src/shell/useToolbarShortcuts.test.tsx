/**
 * Toolbar dropdown shortcuts (owner ask 2026-08-31: "can we add like keyboard
 * shortcuts to the dropdown in the top bar (like between parentheses at the
 * back)").
 *
 * The rule in the owner's words, split into its four halves:
 *  * pressing the bare key runs the verb — WITHOUT the menu being open;
 *  * a verb the menu shows disabled must not run from its key either;
 *  * typing a number into an input must never run a verb;
 *  * the menu row shows the key "between parentheses at the back".
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PortalMenu, type ToolbarDropdownItem } from './ToolbarPrimitives'
import { useToolbarShortcuts } from './useToolbarShortcuts'

afterEach(cleanup)

function Host({ items }: { items: readonly ToolbarDropdownItem[] }): JSX.Element {
  useToolbarShortcuts(items)
  return <input data-testid="a-text-field" />
}

const item = (over: Partial<ToolbarDropdownItem>): ToolbarDropdownItem => ({
  label: 'verb',
  onClick: () => {},
  ...over,
})

describe('useToolbarShortcuts — the dispatch half', () => {
  it('pressing the bare key runs the verb, menu closed', () => {
    const run = vi.fn()
    render(<Host items={[item({ label: '1 · Subdivide', shortcut: '1', onClick: run })]} />)
    fireEvent.keyDown(window, { key: '1' })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('a disabled verb does not run from its key', () => {
    const run = vi.fn()
    render(
      <Host items={[item({ shortcut: '4', disabled: true, onClick: run })]} />,
    )
    fireEvent.keyDown(window, { key: '4' })
    expect(run).not.toHaveBeenCalled()
  })

  it('typing the digit into an input never runs a verb', () => {
    const run = vi.fn()
    render(<Host items={[item({ shortcut: '1', onClick: run })]} />)
    fireEvent.keyDown(screen.getByTestId('a-text-field'), { key: '1' })
    expect(run).not.toHaveBeenCalled()
  })

  it('a chorded key belongs to someone else', () => {
    const run = vi.fn()
    render(<Host items={[item({ shortcut: '1', onClick: run })]} />)
    fireEvent.keyDown(window, { key: '1', ctrlKey: true })
    expect(run).not.toHaveBeenCalled()
  })

  it('a display-only hint (legacy-hook keys like L/F/P) never fires from here', () => {
    // Those keys are dispatched by their dedicated hooks; firing them from the
    // dispatcher too would toggle twice, and a fill toggled twice never moves.
    const run = vi.fn()
    render(<Host items={[item({ shortcutHint: 'l', onClick: run })]} />)
    fireEvent.keyDown(window, { key: 'l' })
    expect(run).not.toHaveBeenCalled()
  })

  it('keys with no declared item are ignored', () => {
    const run = vi.fn()
    render(<Host items={[item({ shortcut: '1', onClick: run })]} />)
    fireEvent.keyDown(window, { key: '2' })
    expect(run).not.toHaveBeenCalled()
  })
})

describe('PortalMenu — the display half', () => {
  it('the row shows the key between parentheses at the back of the label', () => {
    render(
      <PortalMenu
        anchorRect={new DOMRect(0, 0, 100, 20)}
        ariaLabel="test menu"
        items={[item({ label: 'Subdivide', shortcut: '1', testid: 'row' })]}
        onClose={() => {}}
      />,
    )
    expect(screen.getByTestId('row').textContent).toContain('Subdivide (1)')
  })

  it('a legacy-hook hint renders identically', () => {
    render(
      <PortalMenu
        anchorRect={new DOMRect(0, 0, 100, 20)}
        ariaLabel="test menu"
        items={[item({ label: 'Fill bands', shortcutHint: 'l', testid: 'row' })]}
        onClose={() => {}}
      />,
    )
    expect(screen.getByTestId('row').textContent).toContain('Fill bands (l)')
  })
})
