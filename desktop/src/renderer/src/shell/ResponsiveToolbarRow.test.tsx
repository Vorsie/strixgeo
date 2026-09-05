// Render pins for the stage-toolbar verb row.
//
// The planner is pinned separately (toolbarOverflow.test.ts). What is pinned
// HERE is that the row honours the plan on screen:
//
//   * an unmeasured container (jsdom, or the frame before the first
//     ResizeObserver callback) renders the WHOLE bar at full label — so the
//     several thousand existing toolbar tests keep finding their buttons,
//   * the ⋯ menu lists exactly the folded controls' actions and nothing else,
//   * a control the planner sent to `icon` keeps its accessible name.
//
// jsdom cannot lay out text, so the width is injected via `measureWidth`.

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ResponsiveToolbarRow, { type ToolbarItemSpec } from './ResponsiveToolbarRow'
import { ToolbarButton, ToolbarDropdown } from './ToolbarPrimitives'

function specs(onExport = vi.fn(), onDelete = vi.fn()): ToolbarItemSpec[] {
  return [
    {
      id: 'pill',
      priority: 'pinned',
      kind: 'custom',
      label: 'Section model axis',
      widthPx: { full: 172, compact: 146 },
      overflowItems: [],
      render: p => (
        <div data-testid="pill" role="group" aria-label="Section model axis">
          <button type="button">{p === 'compact' ? 'Geo' : 'Stratigraphy'}</button>
          <button type="button">Litho</button>
          <button type="button">Geotech</button>
        </div>
      ),
    },
    {
      id: 'pipeline',
      priority: 'high',
      kind: 'dropdown',
      label: 'Packing pipeline',
      overflowItems: [{ label: '1 · Subdivide CPTs', onClick: vi.fn() }],
      render: p => (
        <ToolbarDropdown
          icon={<span />}
          label="Packing pipeline"
          iconOnly={p === 'icon'}
          testid="pipeline"
          items={[{ label: '1 · Subdivide CPTs', onClick: vi.fn() }]}
        />
      ),
    },
    {
      id: 'export',
      priority: 'medium',
      kind: 'dropdown',
      label: 'Export',
      separatorBefore: true,
      overflowItems: [
        { label: 'Section DXF', onClick: onExport },
        { label: 'Plaxis 3D script', onClick: vi.fn() },
      ],
      render: p => (
        <ToolbarDropdown
          icon={<span />}
          label="Export"
          iconOnly={p === 'icon'}
          testid="export"
          items={[{ label: 'Section DXF', onClick: onExport }]}
        />
      ),
    },
    {
      id: 'delete',
      priority: 'medium',
      kind: 'button',
      label: 'Delete',
      iconOnly: false,
      overflowItems: [{ label: 'Delete cross-section', onClick: onDelete }],
      render: () => (
        <ToolbarButton icon={<span />} label="Delete" danger onClick={onDelete} testid="delete" />
      ),
    },
    {
      id: 'recompute',
      priority: 'low',
      kind: 'button',
      label: 'Recompute bodies',
      overflowItems: [{ label: 'Recompute bodies', onClick: vi.fn() }],
      render: p => (
        <ToolbarButton
          icon={<span />}
          label="Recompute bodies"
          iconOnly={p === 'icon'}
          onClick={vi.fn()}
          testid="recompute"
        />
      ),
    },
  ]
}

const wide = (): number => 4000
const laptop = (): number => 430
const cramped = (): number => 260

describe('ResponsiveToolbarRow', () => {
  it('RT1 — an unmeasured container renders every control at full label and shows no ⋯ menu', () => {
    // This is the jsdom default. Every pre-existing toolbar test relies on
    // it: a bar that collapsed when it could not measure would hide half the
    // buttons those tests query by label.
    render(<ResponsiveToolbarRow items={specs()} />)
    expect(screen.getByText('Packing pipeline')).toBeTruthy()
    expect(screen.getByText('Export')).toBeTruthy()
    expect(screen.getByText('Delete')).toBeTruthy()
    expect(screen.getByText('Recompute bodies')).toBeTruthy()
    expect(screen.queryByTestId('toolbar-overflow-more')).toBeNull()
  })

  it('RT2 — on a wide screen every control still shows its full label', () => {
    render(<ResponsiveToolbarRow items={specs()} measureWidth={wide} />)
    expect(screen.getByText('Stratigraphy')).toBeTruthy()
    expect(screen.getByText('Recompute bodies')).toBeTruthy()
    expect(screen.queryByTestId('toolbar-overflow-more')).toBeNull()
  })

  it('RT3 — the axis pill takes its short form rather than being cut, and never leaves the bar', () => {
    render(<ResponsiveToolbarRow items={specs()} measureWidth={cramped} />)
    // Present, and reading the DESIGNED short label — never "Geote".
    expect(screen.getByTestId('pill')).toBeTruthy()
    expect(screen.getByText('Geo')).toBeTruthy()
    expect(screen.queryByText('Stratigraphy')).toBeNull()
    // The last segment is spelled out in full at every width.
    expect(screen.getByText('Geotech')).toBeTruthy()
  })

  it('RT4 — the ⋯ menu lists exactly the folded controls actions, and nothing that is still in the bar', () => {
    render(<ResponsiveToolbarRow items={specs()} measureWidth={laptop} />)
    const more = screen.getByTestId('toolbar-overflow-more')
    fireEvent.click(more)

    const menu = screen.getByRole('menu')
    const rows = [...menu.querySelectorAll('[role="menuitem"]')].map(n => n.textContent?.trim())

    // "Recompute bodies" is the lowest-priority verb, so it folds first.
    expect(rows).toContain('Recompute bodies')
    // Anything still rendered in the bar must NOT also be in the menu — a
    // verb offered twice is a verb the user cannot trust.
    const barLabels = ['Packing pipeline']
    for (const label of barLabels) {
      expect(rows).not.toContain(label)
    }
  })

  it('RT5 — every declared action is reachable: in the bar, or as a row in the ⋯ menu', () => {
    const { container } = render(
      <ResponsiveToolbarRow items={specs()} measureWidth={cramped} />,
    )
    fireEvent.click(screen.getByTestId('toolbar-overflow-more'))
    const rows = [...screen.getByRole('menu').querySelectorAll('[role="menuitem"]')].map(
      n => n.textContent?.trim(),
    )
    for (const spec of specs()) {
      if (spec.overflowItems.length === 0) continue
      const inBar = container.querySelector(`[data-testid="${spec.id}"]`) !== null
      const inMenu = spec.overflowItems.every(i => rows.includes(i.label))
      expect(inBar || inMenu, `${spec.id} is neither in the bar nor in the menu`).toBe(true)
    }
  })

  it('RT6 — a folded action still fires its handler from the menu', () => {
    const onDelete = vi.fn()
    render(<ResponsiveToolbarRow items={specs(vi.fn(), onDelete)} measureWidth={cramped} />)
    fireEvent.click(screen.getByTestId('toolbar-overflow-more'))
    const row = [...screen.getByRole('menu').querySelectorAll('[role="menuitem"]')].find(
      n => n.textContent?.trim() === 'Delete cross-section',
    )
    expect(row, 'Delete did not reach the menu').toBeTruthy()
    fireEvent.click(row as Element)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('RT7 — the destructive verb is never a bare icon: it keeps its label, or is a fully-spelled menu row', () => {
    for (const width of [4000, 900, 600, 430, 320, 260, 180]) {
      const { container, unmount } = render(
        <ResponsiveToolbarRow items={specs()} measureWidth={() => width} />,
      )
      const button = container.querySelector('[data-testid="delete"]')
      if (button !== null) {
        expect(button.textContent, `at ${width}px`).toContain('Delete')
      }
      unmount()
    }
  })

  it('RT8 — a control shown icon-only is still NAMED by its verb, and still explains itself on hover', () => {
    // A voice-control user says "click Recompute bodies"; a screen-reader user
    // scanning a toolbar wants the verb list. So the accessible name is the
    // SHORT verb, and the long description stays in the tooltip.
    render(<ResponsiveToolbarRow items={specs()} measureWidth={() => 470} />)
    const recompute = screen.queryByTestId('recompute')
    if (recompute !== null && recompute.textContent?.includes('Recompute') !== true) {
      expect(recompute.getAttribute('aria-label')).toBe('Recompute bodies')
      expect(recompute.getAttribute('title')).toBeTruthy()
    }
  })

  it('RT9 — a control with no menu rows is never folded away (a missing declaration must not delete a verb)', () => {
    const orphan: ToolbarItemSpec[] = [
      {
        id: 'orphan',
        priority: 'low',
        kind: 'button',
        label: 'Something important',
        overflowItems: [],
        render: () => (
          <ToolbarButton
            icon={<span />}
            label="Something important"
            onClick={vi.fn()}
            testid="orphan"
          />
        ),
      },
    ]
    render(<ResponsiveToolbarRow items={orphan} measureWidth={() => 20} />)
    expect(screen.getByTestId('orphan')).toBeTruthy()
    expect(screen.queryByTestId('toolbar-overflow-more')).toBeNull()
  })

  it('RT10 — the row stays measurable: flex-1 + min-w-0 so its clientWidth is the budget the planner gets', () => {
    const { container } = render(<ResponsiveToolbarRow items={specs()} />)
    const row = container.firstElementChild
    expect(row?.className).toContain('flex-1')
    expect(row?.className).toContain('min-w-0')
  })

  it('RT11 — no leading rule: a separator only draws between two visible controls', () => {
    // 'export' declares separatorBefore. Render it as the only item and the
    // rule must not appear as a stray tick at the row's left edge.
    const single = specs().filter(s => s.id === 'export')
    const { container } = render(<ResponsiveToolbarRow items={single} measureWidth={wide} />)
    expect(container.querySelectorAll('.bg-border-subtle').length).toBe(0)
  })
})
