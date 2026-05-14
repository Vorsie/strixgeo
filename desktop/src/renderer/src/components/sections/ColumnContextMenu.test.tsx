// Smoke tests for ColumnContextMenu.
//
// Two interactions matter for the v1 menu:
//   * Picking "Focus this test" fires onFocus then onClose.
//   * Pressing Escape fires onClose (so SectionPanel's effect can
//     dismiss the menu even when the user never clicks).

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ColumnContextMenu from './ColumnContextMenu'

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
