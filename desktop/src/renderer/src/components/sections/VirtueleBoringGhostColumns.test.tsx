// Smoke tests for VirtueleBoringGhostColumns.
//
// Verifies the rendering contract:
//   * One rect per layer per (investigation, active model) pair.
//   * No render when both dropdowns are off OR no predictions exist.
//   * Layer rect uses dovlayercolor for fill; null colors fall back.
//   * Zero-thickness layers (in the current vertical zoom) are
//     skipped so the SVG stays clean.

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type {
  BoreholeListItem,
  CptListItem,
  VirtueleBoringInvestigationPrediction,
} from '../../api/client'
import VirtueleBoringGhostColumns from './VirtueleBoringGhostColumns'
import type { PlacedColumn } from './utils'

// Screen Y grows downward, mTAW grows upward — the real
// ``levelToScreen`` is a sign-flipping affine. We mirror that here so
// a layer with top > base produces a positive-height rect (otherwise
// the component's zero-thickness guard would silently skip every
// layer in the test).
const flipLevel = (level: number): number => -level

function makeCpt(id: string): CptListItem {
  return {
    id,
    name: id.toUpperCase(),
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
  } as unknown as CptListItem
}

function makeBorehole(id: string): BoreholeListItem {
  return {
    id,
    name: id.toUpperCase(),
    borehole_type: 'DOV',
    test_id: 'T',
    location_x: 0,
    location_y: 0,
    elevation_m: 7,
    epsg: 31370,
    z_epsg: 5710,
    total_depth_m: 25,
    drill_method: 'rotary',
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

function prediction(
  investigationId: string,
  kind: 'cpt' | 'borehole',
  layersByModel: Record<string, Array<{
    top: number
    base: number
    color: string | null
    name?: string
    beschrijving?: string
  }>>,
): VirtueleBoringInvestigationPrediction {
  return {
    investigation_kind: kind,
    investigation_id: investigationId,
    name: investigationId.toUpperCase(),
    elevation_m_taw: 5,
    predictions_by_model: Object.fromEntries(
      Object.entries(layersByModel).map(([model, layers]) => [
        model,
        layers.map((l, i) => ({
          code: `${model}_${i}`,
          name: l.name ?? `Layer ${i}`,
          beschrijving: l.beschrijving ?? `L${i}`,
          top_m_taw: l.top,
          base_m_taw: l.base,
          thickness_m: l.top - l.base,
          color_hex: l.color,
          ncs_link: null,
        })),
      ]),
    ),
  }
}

describe('VirtueleBoringGhostColumns', () => {
  it('renders nothing when no models are active', () => {
    const { container } = render(
      <svg>
        <VirtueleBoringGhostColumns
          columns={[cptColumn(makeCpt('cpt-a'), 100)]}
          activeModels={[]}
          predictionsByInvestigationId={new Map([
            ['cpt-a', prediction('cpt-a', 'cpt', { g3dv3_F: [{ top: 8, base: 0, color: '#ff0000' }] })],
          ])}
          levelToScreen={flipLevel}
          plotTop={-100}
          plotBottom={100}
          bandHalfWidth={10}
          maxDepthMBelowSurface={null}
        />
      </svg>,
    )
    expect(container.querySelectorAll('rect').length).toBe(0)
  })

  it('renders nothing when no predictions exist for any investigation', () => {
    const { container } = render(
      <svg>
        <VirtueleBoringGhostColumns
          columns={[cptColumn(makeCpt('cpt-a'), 100)]}
          activeModels={['g3dv3_F']}
          predictionsByInvestigationId={new Map()}
          levelToScreen={flipLevel}
          plotTop={-100}
          plotBottom={100}
          bandHalfWidth={10}
          maxDepthMBelowSurface={null}
        />
      </svg>,
    )
    expect(container.querySelectorAll('rect').length).toBe(0)
  })

  it('renders one rect per layer for each (investigation, model)', () => {
    const { container } = render(
      <svg>
        <VirtueleBoringGhostColumns
          columns={[
            cptColumn(makeCpt('cpt-a'), 100),
            bhColumn(makeBorehole('bh-b'), 200),
          ]}
          activeModels={['g3dv3_F', 'hcovv2_H']}
          predictionsByInvestigationId={new Map([
            [
              'cpt-a',
              prediction('cpt-a', 'cpt', {
                g3dv3_F: [
                  { top: 8, base: 0, color: '#aaaaaa' },
                  { top: 0, base: -10, color: '#bbbbbb' },
                ],
                hcovv2_H: [{ top: 8, base: -10, color: '#cccccc' }],
              }),
            ],
            [
              'bh-b',
              prediction('bh-b', 'borehole', {
                g3dv3_F: [{ top: 7, base: -5, color: '#dddddd' }],
                // hcovv2_H intentionally missing — simulates a per-call
                // failure for this (investigation, model) pair.
              }),
            ],
          ])}
          levelToScreen={flipLevel}
          plotTop={-100}
          plotBottom={100}
          bandHalfWidth={10}
          maxDepthMBelowSurface={null}
        />
      </svg>,
    )
    // cpt-a: 2 layers in F + 1 layer in H = 3
    // bh-b:  1 layer in F + 0 in H        = 1
    // Total: 4 rects.
    expect(container.querySelectorAll('rect').length).toBe(4)
    // Each ghost group should carry the data-testid for hover-test
    // diagnostics + e2e selection.
    expect(container.querySelectorAll('[data-testid^="vb-ghost-"]').length).toBe(3)
  })

  it('skips zero-thickness layers so the SVG stays clean', () => {
    const { container } = render(
      <svg>
        <VirtueleBoringGhostColumns
          columns={[cptColumn(makeCpt('cpt-a'), 100)]}
          activeModels={['g3dv3_F']}
          predictionsByInvestigationId={new Map([
            [
              'cpt-a',
              prediction('cpt-a', 'cpt', {
                g3dv3_F: [
                  { top: 5, base: 5, color: '#aaaaaa' }, // zero thickness — skipped
                  { top: 5, base: 0, color: '#bbbbbb' }, // 5m thick — rendered
                ],
              }),
            ],
          ])}
          levelToScreen={flipLevel}
          plotTop={-100}
          plotBottom={100}
          bandHalfWidth={10}
          maxDepthMBelowSurface={null}
        />
      </svg>,
    )
    expect(container.querySelectorAll('rect').length).toBe(1)
  })

  it('clips layers below the maxDepthMBelowSurface threshold', () => {
    // surface elevation in prediction() is 5 mTAW. With a 10m cap
    // the visible range is [5, -5]. Three layers:
    //   8 → 0     fully visible (top above surface — still rendered)
    //   0 → -8    crosses the -5 cap → clipped to 0 → -5
    //   -8 → -20  entirely below the cap → omitted
    const { container } = render(
      <svg>
        <VirtueleBoringGhostColumns
          columns={[cptColumn(makeCpt('cpt-a'), 100)]}
          activeModels={['g3dv3_F']}
          predictionsByInvestigationId={new Map([
            [
              'cpt-a',
              prediction('cpt-a', 'cpt', {
                g3dv3_F: [
                  { top: 8, base: 0, color: '#aaaaaa' },
                  { top: 0, base: -8, color: '#bbbbbb' },
                  { top: -8, base: -20, color: '#cccccc' },
                ],
              }),
            ],
          ])}
          levelToScreen={flipLevel}
          plotTop={-100}
          plotBottom={100}
          bandHalfWidth={10}
          maxDepthMBelowSurface={10}
        />
      </svg>,
    )
    expect(container.querySelectorAll('rect').length).toBe(2)
  })

  it('renders without clipping when maxDepthMBelowSurface is null', () => {
    const { container } = render(
      <svg>
        <VirtueleBoringGhostColumns
          columns={[cptColumn(makeCpt('cpt-a'), 100)]}
          activeModels={['g3dv3_F']}
          predictionsByInvestigationId={new Map([
            [
              'cpt-a',
              prediction('cpt-a', 'cpt', {
                g3dv3_F: [
                  { top: 8, base: -200, color: '#aaaaaa' },
                ],
              }),
            ],
          ])}
          levelToScreen={flipLevel}
          plotTop={-300}
          plotBottom={300}
          bandHalfWidth={10}
          maxDepthMBelowSurface={null}
        />
      </svg>,
    )
    expect(container.querySelectorAll('rect').length).toBe(1)
  })

  it('falls back to a default fill when color_hex is null', () => {
    const { container } = render(
      <svg>
        <VirtueleBoringGhostColumns
          columns={[cptColumn(makeCpt('cpt-a'), 100)]}
          activeModels={['g3dv3_F']}
          predictionsByInvestigationId={new Map([
            [
              'cpt-a',
              prediction('cpt-a', 'cpt', {
                g3dv3_F: [{ top: 5, base: 0, color: null }],
              }),
            ],
          ])}
          levelToScreen={flipLevel}
          plotTop={-100}
          plotBottom={100}
          bandHalfWidth={10}
          maxDepthMBelowSurface={null}
        />
      </svg>,
    )
    const rect = container.querySelector('rect')
    // Fallback grey — must NOT inherit current colour or render
    // black on dark theme.
    expect(rect?.getAttribute('fill')).toBe('#9ca3af')
  })
})
