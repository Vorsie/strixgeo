// Group headers in the "⋯ More" menu.
//
// Owner, 2026-09-11: *"the more menu is too populated, any suggestions?"* —
// and he took all three. This file pins the mechanism half: a stage may hand
// the row a list of overflow GROUPS, and the folded rows are then laid out
// under a small non-interactive heading per group, in the order the stage
// declared. A stage that declares no groups keeps the flat menu it has today
// (the Geology toolbar shares this component and was not part of the ask).
//
// What is pinned here, in the owner's words where he gave them:
//   RTG1  the More menu rows sit under Model / Section / Export headers
//   RTG2  a header is not a verb — it cannot be clicked
//   RTG3  a toolbar that declares no groups keeps the flat menu it has today
//   RTG4  a row whose group nobody declared is still in the menu (nothing cut)
//
// jsdom cannot lay out text, so the width is injected via ``measureWidth`` —
// the same trick ResponsiveToolbarRow.test.tsx uses.

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ResponsiveToolbarRow, {
  type ToolbarItemSpec,
  type ToolbarOverflowGroup,
} from './ResponsiveToolbarRow'
import { ToolbarButton } from './ToolbarPrimitives'

const GROUPS: readonly ToolbarOverflowGroup[] = [
  { id: 'model', label: 'Model' },
  { id: 'section', label: 'Section' },
  { id: 'export', label: 'Export' },
]

/** One plain foldable verb, declared into ``group``. */
function verb(id: string, label: string, group?: string): ToolbarItemSpec {
  return {
    id,
    priority: 'low',
    kind: 'button',
    label,
    ...(group !== undefined ? { overflowGroup: group } : {}),
    overflowItems: [{ label, onClick: vi.fn(), testid: `${id}-row` }],
    render: () => <ToolbarButton icon={<span />} label={label} onClick={vi.fn()} testid={id} />,
  }
}

/** Declaration order deliberately disagrees with the GROUP order, so a test
 *  that passes can only pass because the rows were regrouped. */
function specs(): ToolbarItemSpec[] {
  return [
    verb('undo', 'Undo last model edit', 'section'),
    verb('subdivide', 'Subdivide CPTs', 'model'),
    verb('dxf', 'Section DXF', 'export'),
    verb('delete', 'Delete cross-section', 'section'),
    verb('correlate', 'Auto-correlate', 'model'),
  ]
}

/** The menu read top to bottom: every node, tagged header or row. */
function readMenu(): { kind: 'header' | 'row'; text: string }[] {
  const menu = screen.getByRole('menu')
  return [...menu.children].map(node => ({
    kind: node.getAttribute('role') === 'menuitem' ? ('row' as const) : ('header' as const),
    text: node.textContent?.trim() ?? '',
  }))
}

/** Narrow enough that every foldable verb folds. */
const cramped = (): number => 120

describe('the ⋯ More menu is grouped', () => {
  it('RTG1 — the More menu rows sit under Model / Section / Export headers', () => {
    render(
      <ResponsiveToolbarRow items={specs()} overflowGroups={GROUPS} measureWidth={cramped} />,
    )
    fireEvent.click(screen.getByTestId('toolbar-overflow-more'))

    const nodes = readMenu()
    const headers = nodes.filter(n => n.kind === 'header').map(n => n.text)
    expect(headers).toEqual(['Model', 'Section', 'Export'])

    // Each verb sits under its OWN header, not merely somewhere in the menu.
    const at = (text: string): number => nodes.findIndex(n => n.text === text)
    expect(at('Subdivide CPTs')).toBeGreaterThan(at('Model'))
    expect(at('Subdivide CPTs')).toBeLessThan(at('Section'))
    expect(at('Undo last model edit')).toBeGreaterThan(at('Section'))
    expect(at('Undo last model edit')).toBeLessThan(at('Export'))
    expect(at('Section DXF')).toBeGreaterThan(at('Export'))
  })

  it('RTG2 — a header is not a verb: it cannot be clicked', () => {
    render(
      <ResponsiveToolbarRow items={specs()} overflowGroups={GROUPS} measureWidth={cramped} />,
    )
    fireEvent.click(screen.getByTestId('toolbar-overflow-more'))

    const menu = screen.getByRole('menu')
    const header = [...menu.children].find(n => n.textContent?.trim() === 'Model')
    expect(header, 'the Model header is missing').toBeTruthy()
    expect(header?.tagName).not.toBe('BUTTON')
    expect(header?.getAttribute('role')).not.toBe('menuitem')
    // Only the verbs are menu items, so a keyboard walk never lands on a label.
    expect(menu.querySelectorAll('[role="menuitem"]').length).toBe(specs().length)
  })

  it('RTG3 — a toolbar that declares no groups keeps the flat menu it has today', () => {
    render(<ResponsiveToolbarRow items={specs()} measureWidth={cramped} />)
    fireEvent.click(screen.getByTestId('toolbar-overflow-more'))

    const nodes = readMenu()
    expect(nodes.filter(n => n.kind === 'header')).toEqual([])
    // Declaration order, exactly as before this change.
    expect(nodes.map(n => n.text)).toEqual([
      'Undo last model edit',
      'Subdivide CPTs',
      'Section DXF',
      'Delete cross-section',
      'Auto-correlate',
    ])
  })

  it('RTG4 — a row whose group nobody declared is still in the menu', () => {
    // A spec naming a group the stage forgot to list must not silently vanish:
    // the invariant is that every verb stays reachable at every width.
    const items = [...specs(), verb('orphan', 'Something important', 'nowhere')]
    render(<ResponsiveToolbarRow items={items} overflowGroups={GROUPS} measureWidth={cramped} />)
    fireEvent.click(screen.getByTestId('toolbar-overflow-more'))

    expect(readMenu().map(n => n.text)).toContain('Something important')
  })
})
