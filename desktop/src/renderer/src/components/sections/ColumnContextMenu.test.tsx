// Smoke tests for ColumnContextMenu.
//
// Two interactions matter for the v1 menu:
//   * Picking "Focus this test" fires onFocus then onClose.
//   * Pressing Escape fires onClose (so SectionPanel's effect can
//     dismiss the menu even when the user never clicks).

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import ColumnContextMenu from './ColumnContextMenu'
import { setLanguage } from '../../i18n/languageSelect'
import { DEFAULT_LANGUAGE } from '../../i18n/i18n_constants'

describe('ColumnContextMenu', () => {
  it('renders the column name as the menu subtitle', () => {
    render(
      <ColumnContextMenu
        x={20}
        y={40}
        name="CPT-42"
        onFocus={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('CPT-42')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /focus this test/i })).toBeInTheDocument()
  })

  it('fires onFocus then onClose when "Focus this test" is clicked', () => {
    const onFocus = vi.fn()
    const onClose = vi.fn()
    render(
      <ColumnContextMenu
        x={0}
        y={0}
        name="BH-1"
        onFocus={onFocus}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByRole('menuitem', { name: /focus this test/i }))
    expect(onFocus).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('fires onClose on Escape', () => {
    const onClose = vi.fn()
    render(
      <ColumnContextMenu
        x={0}
        y={0}
        name="BH-1"
        onFocus={vi.fn()}
        onClose={onClose}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('fires onClose on click outside (document click)', () => {
    const onClose = vi.fn()
    render(
      <ColumnContextMenu
        x={0}
        y={0}
        name="BH-1"
        onFocus={vi.fn()}
        onClose={onClose}
      />,
    )
    // Click on the document (outside the menu) — the menu's own
    // onClick=stopPropagation means clicks inside don't reach the
    // document handler.
    fireEvent.click(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('hides "Open detail" when onOpenDetail is omitted', () => {
    render(
      <ColumnContextMenu
        x={0}
        y={0}
        name="CPT-42"
        onFocus={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(
      screen.queryByRole('menuitem', { name: /open detail/i }),
    ).not.toBeInTheDocument()
  })

  it('fires onOpenDetail then onClose when "Open detail" is clicked', () => {
    const onOpenDetail = vi.fn()
    const onClose = vi.fn()
    render(
      <ColumnContextMenu
        x={0}
        y={0}
        name="CPT-42"
        onFocus={vi.fn()}
        onOpenDetail={onOpenDetail}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByRole('menuitem', { name: /open detail/i }))
    expect(onOpenDetail).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('hides "Remove from this section" when onRemoveFromSection is omitted', () => {
    render(
      <ColumnContextMenu
        x={0}
        y={0}
        name="CPT-42"
        onFocus={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(
      screen.queryByRole('menuitem', { name: /remove from this section/i }),
    ).not.toBeInTheDocument()
  })

  it('fires onRemoveFromSection then onClose when the item is clicked', () => {
    const onRemoveFromSection = vi.fn()
    const onClose = vi.fn()
    render(
      <ColumnContextMenu
        x={0}
        y={0}
        name="CPT-42"
        onFocus={vi.fn()}
        onRemoveFromSection={onRemoveFromSection}
        onClose={onClose}
      />,
    )
    fireEvent.click(
      screen.getByRole('menuitem', { name: /remove from this section/i }),
    )
    expect(onRemoveFromSection).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('Clear subdivision (owner ask 2026-08-18)', () => {
  it('offers the verb when wired and fires it', () => {
    const onClearSubdivision = vi.fn()
    render(
      <ColumnContextMenu
        x={10}
        y={10}
        name="GEO-1"
        onFocus={vi.fn()}
        onClearSubdivision={onClearSubdivision}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('Clear subdivision'))
    expect(onClearSubdivision).toHaveBeenCalled()
  })

  it('stays absent when not wired — litho axis and band-less columns', () => {
    render(<ColumnContextMenu x={10} y={10} name="GEO-1" onFocus={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByText('Clear subdivision')).toBeNull()
  })
})

// Owner dogfeed 2026-09-01: the per-column right-click menu stayed English in
// Dutch mode. Every item routes through the i18n catalogue, so a language flip
// renders the Dutch labels (the keys already exist — sections.menu.focusTest &c).
describe('ColumnContextMenu — Dutch mode', () => {
  afterEach(() => setLanguage(DEFAULT_LANGUAGE))

  it('CCM-NL — every item reads its Dutch catalogue label under nl', () => {
    setLanguage('nl')
    render(
      <ColumnContextMenu
        x={10}
        y={10}
        name="CPT-42"
        onFocus={vi.fn()}
        onOpenDetail={vi.fn()}
        onClearSubdivision={vi.fn()}
        onRemoveFromSection={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('Focus op deze proef')).toBeInTheDocument()
    expect(screen.getByText('Details openen')).toBeInTheDocument()
    expect(screen.getByText('Onderverdeling wissen')).toBeInTheDocument()
    expect(screen.getByText('Uit dit profiel weghalen')).toBeInTheDocument()
    // The English label must be gone — proof the flip took.
    expect(screen.queryByText('Focus this test')).toBeNull()
  })
})
