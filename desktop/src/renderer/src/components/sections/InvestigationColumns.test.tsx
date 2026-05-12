// Smoke tests for InvestigationColumns (debt #34).
//
// The component is a thin dispatcher over per-column ColumnGlyph,
// so the tests only need to verify that:
//
//   * One glyph renders per placed column (no swallowed entries).
//   * The right kind / id pair is forwarded so the per-kind click
//     handler fires the correct callback.
//   * Empty input renders cleanly (no children).

import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type {
  BoreholeListItem,
  CptListItem,
} from '../../api/client'
import InvestigationColumns from './InvestigationColumns'
import type { PlacedColumn } from './utils'

const identity = (level: number): number => level

function makeCpt(overrides: Partial<CptListItem> = {}): CptListItem {
  return {
    id: 'cpt-1',
    name: 'CPT-1',
    cpt_type: 'CPTU',
    project_id: 'P',
    test_id: 'T',
    location_x: 0,
    location_y: 0,
    elevation_m: 5,
    epsg: 31370,
    z_epsg: 5710,
    max_depth_m: 20,
    n_rows: 100,
    ...overrides,
  } as CptListItem
}

function makeBorehole(overrides: Partial<BoreholeListItem> = {}): BoreholeListItem {
  return {
    id: 'bh-1',
    name: 'BH-1',
    borehole_type: 'DOV',
    test_id: 'T',
    location_x: 0,
    location_y: 0,
    elevation_m: 7,
    epsg: 31370,
    z_epsg: 5710,
    total_depth_m: 25,
    drill_method: 'rotary',
    ...overrides,
  } as BoreholeListItem
}

function cptColumn(item: CptListItem, screenX: number): PlacedColumn {
  return {
    kind: 'cpt',
    proj: { item, along: 0, offset: 0 },
    trueX: screenX,
    nudgedX: screenX,
    width: 20,
    displaced: false,
  }
}

function bhColumn(item: BoreholeListItem, screenX: number): PlacedColumn {
  return {
    kind: 'borehole',
    proj: { item, along: 0, offset: 0 },
    trueX: screenX,
    nudgedX: screenX,
    width: 20,
    displaced: false,
  }
}

describe('InvestigationColumns', () => {
  it('renders a glyph per placed column (CPTs + boreholes mixed)', () => {
    const cols: PlacedColumn[] = [
      cptColumn(makeCpt({ id: 'a', name: 'CPT-A' }), 100),
      cptColumn(makeCpt({ id: 'b', name: 'CPT-B' }), 200),
      bhColumn(makeBorehole({ id: 'c', name: 'BH-C' }), 300),
    ]
    const { container } = render(
      <svg>
        <InvestigationColumns
          columns={cols}
          levelToScreen={identity}
          plotTop={-100}
          plotBottom={100}
          onSelectCpt={undefined}
          onSelectBorehole={undefined}
        />
      </svg>,
    )
    // Two CPT circles + one borehole square.
    expect(container.querySelectorAll('circle').length).toBe(2)
    expect(container.querySelectorAll('rect[width="7"][height="7"]').length).toBe(1)
  })

  it('renders nothing for an empty column list', () => {
    const { container } = render(
      <svg>
        <InvestigationColumns
          columns={[]}
          levelToScreen={identity}
          plotTop={-100}
          plotBottom={100}
          onSelectCpt={undefined}
          onSelectBorehole={undefined}
        />
      </svg>,
    )
    expect(container.querySelectorAll('circle').length).toBe(0)
    expect(container.querySelectorAll('rect[fill="transparent"]').length).toBe(0)
  })

  it('routes CPT clicks to onSelectCpt with the cpt id', () => {
    const onSelectCpt = vi.fn()
    const onSelectBorehole = vi.fn()
    const { container } = render(
      <svg>
        <InvestigationColumns
          columns={[cptColumn(makeCpt({ id: 'cpt-x' }), 100)]}
          levelToScreen={identity}
          plotTop={-100}
          plotBottom={100}
          onSelectCpt={onSelectCpt}
          onSelectBorehole={onSelectBorehole}
        />
      </svg>,
    )
    fireEvent.click(container.querySelector('rect[fill="transparent"]')!)
    expect(onSelectCpt).toHaveBeenCalledWith('cpt-x')
    expect(onSelectBorehole).not.toHaveBeenCalled()
  })

  it('routes borehole clicks to onSelectBorehole with the borehole id', () => {
    const onSelectCpt = vi.fn()
    const onSelectBorehole = vi.fn()
    const { container } = render(
      <svg>
        <InvestigationColumns
          columns={[bhColumn(makeBorehole({ id: 'bh-x' }), 100)]}
          levelToScreen={identity}
          plotTop={-100}
          plotBottom={100}
          onSelectCpt={onSelectCpt}
          onSelectBorehole={onSelectBorehole}
        />
      </svg>,
    )
    fireEvent.click(container.querySelector('rect[fill="transparent"]')!)
    expect(onSelectBorehole).toHaveBeenCalledWith('bh-x')
    expect(onSelectCpt).not.toHaveBeenCalled()
  })
})
