// The portalled toolbar menu can nest one level: a row that carries a
// `submenu` is a GROUP row (owner 2026-10-04: "one button for cpt's with
// suboptions, same for drillings"). The group row shows a chevron; hovering it
// or clicking it opens its rows in a panel next to it; ArrowRight opens it from
// the keyboard and ArrowLeft goes back; Escape closes the whole menu; a click
// on a sub-row runs it and closes everything.

import { useRef } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PortalMenu, usePortalMenu, type ToolbarDropdownItem } from './ToolbarPrimitives'

function Harness({ items }: { items: ToolbarDropdownItem[] }): JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  const { open, anchorRect, toggle, close } = usePortalMenu(ref)
  return (
    <>
      <button ref={ref} data-testid="trigger" onClick={toggle}>
        Import
      </button>
      <button data-testid="elsewhere">elsewhere</button>
      {open && anchorRect !== null && (
        <PortalMenu anchorRect={anchorRect} ariaLabel="Import actions" items={items} onClose={close} />
      )}
    </>
  )
}

function makeItems() {
  const gef = vi.fn()
  const pdf = vi.fn()
  const lab = vi.fn()
  const items: ToolbarDropdownItem[] = [
    {
      label: 'CPT',
      testid: 'group-cpt',
      onClick: () => undefined,
      submenu: [
        { label: '.gef files', testid: 'verb-gef', onClick: gef },
        { label: 'From a PDF report', testid: 'verb-pdf', onClick: pdf },
      ],
    },
    { label: 'Lab tests', testid: 'verb-lab', onClick: lab },
  ]
  return { items, gef, pdf, lab }
}

function openMenu(items: ToolbarDropdownItem[]): void {
  render(<Harness items={items} />)
  fireEvent.click(screen.getByTestId('trigger'))
}

describe('PortalMenu group rows (one level of submenu)', () => {
  it('a group row shows a chevron and its sub-rows stay hidden until it opens', () => {
    const { items } = makeItems()
    openMenu(items)
    const group = screen.getByTestId('group-cpt')
    expect(group).toHaveAttribute('aria-haspopup', 'menu')
    expect(group).toHaveAttribute('aria-expanded', 'false')
    expect(group.querySelector('[data-testid="portal-menu-submenu-chevron"]')).not.toBeNull()
    expect(screen.queryByTestId('verb-gef')).toBeNull()
  })

  it('hovering the group row opens its sub-rows in a second panel', () => {
    const { items } = makeItems()
    openMenu(items)
    fireEvent.mouseEnter(screen.getByTestId('group-cpt'))
    expect(screen.getByTestId('verb-gef')).toBeInTheDocument()
    expect(screen.getByTestId('verb-pdf')).toBeInTheDocument()
    expect(screen.getAllByRole('menu')).toHaveLength(2)
    expect(screen.getByTestId('group-cpt')).toHaveAttribute('aria-expanded', 'true')
  })

  it('hovering a plain row of the parent closes the open submenu', () => {
    const { items } = makeItems()
    openMenu(items)
    fireEvent.mouseEnter(screen.getByTestId('group-cpt'))
    fireEvent.mouseEnter(screen.getByTestId('verb-lab'))
    expect(screen.queryByTestId('verb-gef')).toBeNull()
  })

  it('clicking the group row opens the submenu and runs nothing, the menu stays open', () => {
    const { items } = makeItems()
    openMenu(items)
    fireEvent.click(screen.getByTestId('group-cpt'))
    expect(screen.getByTestId('verb-pdf')).toBeInTheDocument()
    expect(screen.getByTestId('verb-lab')).toBeInTheDocument()
  })

  it('a click on a sub-row runs it and closes the whole menu', () => {
    const { items, pdf } = makeItems()
    openMenu(items)
    fireEvent.click(screen.getByTestId('group-cpt'))
    fireEvent.click(screen.getByTestId('verb-pdf'))
    expect(pdf).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('a mousedown inside the submenu does not count as an outside click', () => {
    const { items } = makeItems()
    openMenu(items)
    fireEvent.click(screen.getByTestId('group-cpt'))
    fireEvent.mouseDown(screen.getByTestId('verb-gef'))
    expect(screen.getByTestId('verb-gef')).toBeInTheDocument()
    // A real outside click still dismisses everything.
    fireEvent.mouseDown(screen.getByTestId('elsewhere'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('ArrowRight on the group row opens the submenu and focuses its first row', () => {
    const { items } = makeItems()
    openMenu(items)
    const group = screen.getByTestId('group-cpt')
    act(() => group.focus())
    fireEvent.keyDown(group, { key: 'ArrowRight' })
    expect(screen.getByTestId('verb-gef')).toHaveFocus()
  })

  it('ArrowLeft in the submenu closes it and gives focus back to the group row', () => {
    const { items } = makeItems()
    openMenu(items)
    const group = screen.getByTestId('group-cpt')
    act(() => group.focus())
    fireEvent.keyDown(group, { key: 'ArrowRight' })
    fireEvent.keyDown(screen.getByTestId('verb-gef'), { key: 'ArrowLeft' })
    expect(screen.queryByTestId('verb-gef')).toBeNull()
    expect(screen.getByTestId('group-cpt')).toHaveFocus()
  })

  it('Escape closes the submenu and the menu together', () => {
    const { items } = makeItems()
    openMenu(items)
    fireEvent.click(screen.getByTestId('group-cpt'))
    fireEvent.keyDown(screen.getByTestId('verb-gef'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('a disabled group row never opens', () => {
    const { items } = makeItems()
    openMenu([{ ...items[0], disabled: true }, items[1]])
    fireEvent.mouseEnter(screen.getByTestId('group-cpt'))
    fireEvent.click(screen.getByTestId('group-cpt'))
    expect(screen.queryByTestId('verb-gef')).toBeNull()
  })
})
