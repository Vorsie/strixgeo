// The built 3-D model drawn on the 2-D section, on the GEOTECH axis.
//
// Owner (2026-08-26): "rebuilding the 3d model now, the model is rebuild, can
// we show the actual 3D model on the 2d sections just like in litho stage".
//
// The litho axis already cuts its built body solids at the section plane and
// paints the loops. This file pins the same thing on the geotech axis, and pins
// that the geotech paint is coloured the way this axis colours everything else:
// by NAD packing class, with the neutral grey where a unit has no class.
//
// Claims pinned:
//   GMP1  Geotech axis, geotech solids in scope, switch on → the model's cut
//         loops paint, one per body.
//   GMP2  A band paints its NAD-class colour, not the lithology colour the
//         geotech unit inherited from the litho unit it subdivides.
//   GMP3  A unit with no NAD class paints the neutral grey.
//   GMP4  Switch off → nothing paints. The engineer can take the model away and
//         look at what is underneath it.
//   GMP5  Nothing built yet → nothing paints and nothing throws.
//   GMP6  Control — the litho axis paints its own solids in the lithology
//         colour, driven by its own switch. The geotech switch does not reach it.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type {
  CptListItem,
  CrossSectionResponse,
  GeologicalFormationResponse,
  LithoBodySolidResponse,
} from '../api/client'
import SectionPanel from './SectionPanel'
import { SectionScopeContext } from './sections/SectionScopeContext'
import { nadClassColor } from '../utils/nadClasses'
import { setGeotechModelFill } from '../utils/geotechModelFillStore'
import { setFormationFill } from '../utils/formationFillStore'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A horizontal 1 km section; the cutting plane runs along y = 0. */
const SECTION: CrossSectionResponse = {
  id: 'sec-1',
  app_project_id: 'P',
  name: 'Cross-section AA',
  description: null,
  start_x: 0,
  start_y: 0,
  end_x: 1000,
  end_y: 0,
  epsg: 31370,
  projection_buffer_m: 50,
  vertical_exaggeration: 2,
  excluded_borehole_ids: [],
  excluded_cpt_ids: [],
  seeded_formation_contact_ids: [],
  min_depth_m: null,
  max_depth_m: null,
  display_order: 0,
  view_state: {},
  created_at: '2026-08-26T00:00:00Z',
  updated_at: '2026-08-26T00:00:00Z',
}

/** One CPT column so the panel has an investigation to lay out. */
const CPT = {
  id: 'cpt-1',
  name: 'CPT-1',
  cpt_type: 'CPTU',
  project_id: 'P',
  test_id: 'T',
  location_x: 300,
  location_y: 0,
  elevation_m: 5,
  epsg: 31370,
  z_epsg: 5710,
  elevation_source: 'dov',
  start_date: '2024-01-01',
  max_depth_m: 20,
  n_rows: 100,
} as unknown as CptListItem

const DENSE_SAND_ID = 'geo-nad-8'
const UNCLASSIFIED_ID = 'geo-nad-null'
const LITHO_SAND_ID = 'litho-sand'
/** The lithology colour a geotech unit inherits from the litho unit it refines. */
const INHERITED_LITHO_COLOR = '#fbbf24'

/**
 * A closed box solid straddling the section plane.
 *
 * @param bodyId Body identifier (also the overlay's testid suffix).
 * @param formationId Formation the body belongs to.
 * @param x0 Along-section start of the box footprint (m).
 * @param x1 Along-section end of the box footprint (m).
 * @param top Top elevation (m).
 * @param base Base elevation (m).
 * @returns A solid response with a watertight 12-triangle box mesh.
 */
function boxSolid(
  bodyId: string,
  formationId: string,
  x0: number,
  x1: number,
  top: number,
  base: number,
): LithoBodySolidResponse {
  const vertices: [number, number, number][] = [
    [x0, -20, top],
    [x1, -20, top],
    [x1, 20, top],
    [x0, 20, top],
    [x0, -20, base],
    [x1, -20, base],
    [x1, 20, base],
    [x0, 20, base],
  ]
  const triangles: [number, number, number][] = [
    [0, 1, 2],
    [0, 2, 3],
    [4, 6, 5],
    [4, 7, 6],
    [0, 4, 5],
    [0, 5, 1],
    [1, 5, 6],
    [1, 6, 2],
    [2, 6, 7],
    [2, 7, 3],
    [3, 7, 4],
    [3, 4, 0],
  ]
  return {
    id: `solid-${bodyId}`,
    model_id: 'model-1',
    body_id: bodyId,
    formation_id: formationId,
    body_ordinal: 0,
    method: 'voxel',
    vertices,
    triangles,
    // null so the formation colour lookup — the axis-aware part — is exercised.
    display_color: null,
  }
}

/**
 * A formation row as the axis hands it to the panel.
 *
 * @param id Formation id.
 * @param nadClass NAD packing class, or null for an unclassified unit.
 * @param color The STORED colour (a geotech unit carries its source lithology's).
 * @returns A formation response with only the fields the panel reads.
 */
function formation(
  id: string,
  nadClass: number | null,
  color: string,
  colorOverride: string | null = null,
): GeologicalFormationResponse {
  return {
    id,
    app_project_id: 'P',
    name: id,
    color,
    color_override: colorOverride,
    code: null,
    display_order: 0,
    pinned_order: false,
    regional_ref: null,
    description: null,
    lithology: null,
    nad_class: nadClass,
    parent_formation_id: null,
    litho_main_soil_code: 'ZAND',
    litho_admixtures: [],
    instance_ordinal: null,
    instance_ordinal_locked: false,
    parent_formation_name: null,
  } as unknown as GeologicalFormationResponse
}

const GEOTECH_FORMATIONS = [
  formation(DENSE_SAND_ID, 8, INHERITED_LITHO_COLOR),
  formation(UNCLASSIFIED_ID, null, INHERITED_LITHO_COLOR),
]
const LITHO_FORMATIONS = [formation(LITHO_SAND_ID, null, INHERITED_LITHO_COLOR)]

/**
 * ResizeObserver stub reporting a fixed viewport so the panel lays out.
 *
 * @param width Canvas width in px.
 * @param height Canvas height in px.
 * @returns Restore function that puts the real observer back.
 */
function withFixedSize(width: number, height: number): () => void {
  const RealRO = globalThis.ResizeObserver
  class FixedRO {
    private cb: ResizeObserverCallback
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb
    }
    observe(target: Element): void {
      Object.defineProperty(target, 'clientWidth', { configurable: true, value: width })
      Object.defineProperty(target, 'clientHeight', { configurable: true, value: height })
      queueMicrotask(() =>
        this.cb(
          [
            {
              contentRect: { width, height } as DOMRectReadOnly,
              target,
            } as unknown as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        ),
      )
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  ;(globalThis as { ResizeObserver: unknown }).ResizeObserver =
    FixedRO as unknown as typeof ResizeObserver
  return () => {
    ;(globalThis as { ResizeObserver: unknown }).ResizeObserver = RealRO
  }
}

/**
 * Mount the panel on one axis with the given built solids in scope.
 *
 * @param axisMode Which section axis to render.
 * @param solids The built body solids the axis supplies.
 * @param formations The axis's formation rows.
 * @returns The fill colour of every painted model-fill element, by body id.
 */
async function paintedFills(
  axisMode: 'lithostratigraphic' | 'geotechnical',
  solids: LithoBodySolidResponse[],
  formations: GeologicalFormationResponse[],
): Promise<Map<string, string>> {
  const restore = withFixedSize(900, 500)
  render(
    <SectionScopeContext.Provider
      value={{
        modelSolids: solids,
        zEpsg: 5710,
        cpts: [CPT],
        contacts: [],
        formations,
        axisMode,
      }}
    >
      <SectionPanel section={SECTION} />
    </SectionScopeContext.Provider>,
  )
  await new Promise(r => setTimeout(r, 0))
  restore()

  const out = new Map<string, string>()
  const overlay = screen.queryByTestId('model-fill-overlay')
  if (overlay === null) return out
  for (const el of Array.from(overlay.querySelectorAll('[data-testid^="model-fill-"]'))) {
    const bodyId = (el.getAttribute('data-testid') ?? '').replace(/^model-fill-/, '')
    out.set(bodyId, el.getAttribute('fill') ?? '')
  }
  return out
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  setGeotechModelFill(true)
  setFormationFill(true)
})

afterEach(() => {
  cleanup()
})

describe('SectionPanel — the built model on the geotech section', () => {
  it('GMP1: the geotech model’s cut loops paint, one per body', async () => {
    const fills = await paintedFills(
      'geotechnical',
      [
        boxSolid('body-dense', DENSE_SAND_ID, 100, 300, 4, -2),
        boxSolid('body-unclassified', UNCLASSIFIED_ID, 400, 600, 4, -2),
      ],
      GEOTECH_FORMATIONS,
    )

    expect([...fills.keys()].sort()).toEqual(['body-dense', 'body-unclassified'])
  })

  it('GMP2: a classified band paints its NAD colour, not the inherited lithology colour', async () => {
    const fills = await paintedFills(
      'geotechnical',
      [boxSolid('body-dense', DENSE_SAND_ID, 100, 300, 4, -2)],
      GEOTECH_FORMATIONS,
    )

    expect(fills.get('body-dense')).toBe(nadClassColor(8))
    expect(fills.get('body-dense')).not.toBe(INHERITED_LITHO_COLOR)
  })

  it('GMP2b: a colour the engineer picked beats the NAD colour on the section', async () => {
    // Owner ruling 2026-08-26: "Colours on the right hand pane need to be
    // choosable if user wants." He picks on the pane and looks at the section,
    // so the pick has to reach the fill or the two disagree in front of him.
    const fills = await paintedFills(
      'geotechnical',
      [boxSolid('body-dense', DENSE_SAND_ID, 100, 300, 4, -2)],
      [
        formation(DENSE_SAND_ID, 8, INHERITED_LITHO_COLOR, '#ff00ff'),
        formation(UNCLASSIFIED_ID, null, INHERITED_LITHO_COLOR),
      ],
    )

    expect(fills.get('body-dense')).toBe('#ff00ff')
  })

  it('GMP3: a unit with no NAD class paints the neutral grey', async () => {
    const fills = await paintedFills(
      'geotechnical',
      [boxSolid('body-unclassified', UNCLASSIFIED_ID, 400, 600, 4, -2)],
      GEOTECH_FORMATIONS,
    )

    expect(fills.get('body-unclassified')).toBe(nadClassColor(null))
  })

  it('GMP4: with the switch off nothing paints', async () => {
    setGeotechModelFill(false)

    const fills = await paintedFills(
      'geotechnical',
      [boxSolid('body-dense', DENSE_SAND_ID, 100, 300, 4, -2)],
      GEOTECH_FORMATIONS,
    )

    expect(fills.size).toBe(0)
  })

  it('GMP5: nothing built yet — nothing paints, nothing throws', async () => {
    const fills = await paintedFills('geotechnical', [], GEOTECH_FORMATIONS)

    expect(fills.size).toBe(0)
  })

  it('GMP6: the litho axis still paints its own solids in the lithology colour', async () => {
    // Control. The geotech switch is off; the litho axis must be unaffected by it.
    setGeotechModelFill(false)

    const fills = await paintedFills(
      'lithostratigraphic',
      [boxSolid('body-sand', LITHO_SAND_ID, 100, 300, 4, -2)],
      LITHO_FORMATIONS,
    )

    expect(fills.get('body-sand')).toBe(INHERITED_LITHO_COLOR)
  })
})
