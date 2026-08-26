/**
 * Behavioural net for ``GeotechLayersTree`` — the nested 3-D LAYERS legend.
 *
 * The rules these pins paraphrase (owner ruling 2026-08-26): the tree is
 * "closed by default at soil level with body counts", it has "expand carets",
 * and "an eye toggle per level hides that whole family/class/body in the
 * viewer".
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildGeotechLegendTree } from '../../../utils/geotechLegendTree'
import { nadClassColor } from '../../../utils/nadClasses'
import { GeotechLayersTree } from './GeotechLayersTree'

// ---------------------------------------------------------------------------
// Fixture — two SAND classes (one of them shared by two units) + a CLAY unit
// with no class yet.
// ---------------------------------------------------------------------------

function makeTree() {
  return buildGeotechLegendTree(
    [
      { id: 's1', name: 'ZAND (geotech)', color: '#000', nad_class: 6, litho_main_soil_code: 'ZAND' },
      { id: 's2', name: 'ZAND (geotech)', color: '#000', nad_class: 6, litho_main_soil_code: 'ZAND' },
      { id: 's3', name: 'ZAND (geotech)', color: '#000', nad_class: 8, litho_main_soil_code: 'ZAND' },
      { id: 'c1', name: 'KLEI (geotech)', color: '#000', nad_class: null, litho_main_soil_code: 'KLEI' },
    ],
    [
      { body_id: 'b1', formation_id: 's1', body_ordinal: 0, triangles: [[0, 1, 2]] },
      { body_id: 'b2', formation_id: 's3', body_ordinal: 0, triangles: [[0, 1, 2]] },
      // The unclassified CLAY unit is BUILT: since 2026-08-26 the builder lists
      // only what the scene paints, so a skeleton with no solid would not reach
      // this component at all and TR8 would be pinning an unreachable row.
      { body_id: 'b3', formation_id: 'c1', body_ordinal: 0, triangles: [[0, 1, 2]] },
    ],
  )
}

function renderTree(
  overrides: {
    hiddenFormationIds?: ReadonlySet<string>
    hiddenBodyIds?: ReadonlySet<string>
    onToggleFormations?: (ids: readonly string[], hide: boolean) => void
    onToggleBody?: (bodyId: string, hide: boolean) => void
  } = {},
) {
  const onToggleFormations = overrides.onToggleFormations ?? vi.fn()
  const onToggleBody = overrides.onToggleBody ?? vi.fn()
  render(
    <GeotechLayersTree
      tree={makeTree()}
      hiddenFormationIds={overrides.hiddenFormationIds ?? new Set()}
      hiddenBodyIds={overrides.hiddenBodyIds ?? new Set()}
      onToggleFormations={onToggleFormations}
      onToggleBody={onToggleBody}
    />,
  )
  return { onToggleFormations, onToggleBody }
}

afterEach(cleanup)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GeotechLayersTree', () => {
  it('TR1 — closed by default at soil level: only family rows, each with its body count', () => {
    renderTree()

    expect(screen.getByTestId('geotech-legend-family-ZAND')).toBeTruthy()
    expect(screen.getByTestId('geotech-legend-family-KLEI')).toBeTruthy()
    // The class rows beneath are not rendered until the caret opens the family.
    expect(screen.queryByTestId('geotech-legend-class-ZAND:6')).toBeNull()
    expect(screen.getByTestId('geotech-legend-family-ZAND').textContent).toContain('2')
  })

  it('TR2 — the caret opens the family and reveals its class rows, still closed', () => {
    renderTree()
    fireEvent.click(screen.getByTestId('geotech-legend-caret-ZAND'))

    expect(screen.getByTestId('geotech-legend-class-ZAND:6').textContent).toContain('medium dense')
    expect(screen.getByTestId('geotech-legend-class-ZAND:8').textContent).toContain('very dense')
    // The body rows stay closed until the class caret is clicked.
    expect(screen.queryByTestId('geotech-legend-body-b1')).toBeNull()

    fireEvent.click(screen.getByTestId('geotech-legend-caret-ZAND:8'))
    expect(screen.getByTestId('geotech-legend-body-b2')).toBeTruthy()
  })

  it('TR3 — the family eye hides EVERY formation beneath it in one call', () => {
    const { onToggleFormations } = renderTree()
    fireEvent.click(screen.getByTestId('geotech-legend-family-ZAND'))

    expect(onToggleFormations).toHaveBeenCalledTimes(1)
    expect(onToggleFormations).toHaveBeenCalledWith(['s1', 's2', 's3'], true)
  })

  it('TR4 — when everything beneath is already hidden, the family eye shows it again', () => {
    const { onToggleFormations } = renderTree({
      hiddenFormationIds: new Set(['s1', 's2', 's3']),
    })
    fireEvent.click(screen.getByTestId('geotech-legend-family-ZAND'))

    expect(onToggleFormations).toHaveBeenCalledWith(['s1', 's2', 's3'], false)
  })

  it('TR5 — the class eye toggles only that class, including the unit it shares the row with', () => {
    const { onToggleFormations } = renderTree()
    fireEvent.click(screen.getByTestId('geotech-legend-caret-ZAND'))
    fireEvent.click(screen.getByTestId('geotech-legend-class-ZAND:6'))

    expect(onToggleFormations).toHaveBeenCalledWith(['s1', 's2'], true)
  })

  it('TR6 — the body eye toggles that one body', () => {
    const { onToggleBody } = renderTree()
    fireEvent.click(screen.getByTestId('geotech-legend-caret-ZAND'))
    fireEvent.click(screen.getByTestId('geotech-legend-caret-ZAND:6'))
    fireEvent.click(screen.getByTestId('geotech-legend-body-b1'))

    expect(onToggleBody).toHaveBeenCalledWith('b1', true)
  })

  it('TR7 — a hidden family reads as hidden and offers to show it again', () => {
    renderTree({ hiddenFormationIds: new Set(['s1', 's2', 's3']) })
    const row = screen.getByTestId('geotech-legend-family-ZAND')

    expect(row.getAttribute('title')).toContain('Show')
    expect(row.querySelector('.line-through')).toBeTruthy()
  })

  it('TR8 — the unclassified unit keeps its row, in neutral grey', () => {
    renderTree()
    fireEvent.click(screen.getByTestId('geotech-legend-caret-KLEI'))
    const row = screen.getByTestId('geotech-legend-class-KLEI:none')

    expect(row.textContent).toContain('not yet classified')
    const swatch = row.querySelector('[data-testid="geotech-legend-swatch"]') as HTMLElement
    expect(swatch.style.backgroundColor).toBe('rgb(156, 163, 175)') // nadClassColor(null)
    expect(nadClassColor(null)).toBe('#9ca3af')
  })

  it('TR9 — a unit with nothing built has no row to reach', () => {
    // REPLACES 'a family with no bodies built yet still lists its classes'.
    // Owner, dogfeed 2026-08-26: "why are there suboptions like this ... not yet
    // classified?" A row the scene paints nothing for is noise; the builder now
    // drops it, so the component never sees it.
    render(
      <GeotechLayersTree
        tree={buildGeotechLegendTree(
          [
            { id: 's1', name: 'ZAND (geotech)', color: '#000', nad_class: 6, litho_main_soil_code: 'ZAND' },
            { id: 'c1', name: 'KLEI (geotech)', color: '#000', nad_class: null, litho_main_soil_code: 'KLEI' },
          ],
          [{ body_id: 'b1', formation_id: 's1', body_ordinal: 0, triangles: [[0, 1, 2]] }],
        )}
        hiddenFormationIds={new Set()}
        hiddenBodyIds={new Set()}
        onToggleFormations={vi.fn()}
        onToggleBody={vi.fn()}
      />,
    )

    expect(screen.getByTestId('geotech-legend-family-ZAND')).toBeTruthy()
    expect(screen.queryByTestId('geotech-legend-family-KLEI')).toBeNull()
  })

  it('TR10 — in fence mode a walled band is a row, with nothing to expand', () => {
    // Bands exist without solids, so the fence legend still has the family rows
    // it needs to drive hiding — and a class with no built body has no caret,
    // because there is no third level to open.
    render(
      <GeotechLayersTree
        tree={buildGeotechLegendTree(
          [
            { id: 'c1', name: 'KLEI (geotech)', color: '#000', nad_class: 22, litho_main_soil_code: 'KLEI' },
          ],
          [],
          [{ formationId: 'c1', triangles: [[0, 1, 2]] }],
        )}
        hiddenFormationIds={new Set()}
        hiddenBodyIds={new Set()}
        onToggleFormations={vi.fn()}
        onToggleBody={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByTestId('geotech-legend-caret-KLEI'))
    expect(screen.getByTestId('geotech-legend-class-KLEI:22')).toBeTruthy()
    expect(screen.queryByTestId('geotech-legend-caret-KLEI:22')).toBeNull()
  })
})
