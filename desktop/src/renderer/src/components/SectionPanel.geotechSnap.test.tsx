// The geotech axis offers the CPT's own packing boundaries as contact-drag snap targets.
//
// On finely interbedded ground the boundary the engineer wants to move IS a
// lithostratigraphic contact, and the cone resistance resolved it better than the
// driller's log did (the log sits on a 0.5 m grid, the CPT resolves 3-4x more
// contacts). So on this axis the drag snaps onto the packing bands' internal
// boundaries — the evidence pulls the interpretation onto itself.
//
// Pinned claims:
//   GS1  On the geotech axis with a geotech model, the CPT's INTERNAL packing
//        boundaries appear in the snap set handed to ContactsLayer.
//   GS2  The committed contacts on that column stay in the same snap set — the
//        packing boundaries JOIN the existing sources, they do not replace them.
//   GS3  The litho axis is untouched: the same geotech model contributes no
//        packing boundary there (the axis has no CPT-derived packing to snap to).
//
// SectionPanel is a god-component (debt #201); ContactsLayer is mocked so the
// assertion reads the snap map at the prop boundary rather than through a
// synthesised canvas drag.

import { render, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  CptListItem,
  CrossSectionResponse,
  FormationContactResponse,
  LithoLayerResponse,
} from '../api/client'
import SectionPanel from './SectionPanel'
import type { SnapCandidate } from './sections/ContactsLayer'
import type { GeotechAxisModel } from './sections/geotechAxisModel'
import { SectionScopeContext } from './sections/SectionScopeContext'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Updated on every ContactsLayer render — the snap set under test. */
let capturedSnapDepths: ReadonlyMap<string, readonly SnapCandidate[]> | undefined = undefined
/** The rest of the same prop bag, for the drag-clamp case. */
let capturedProps: Record<string, unknown> = {}

vi.mock('./sections/ContactsLayer', () => ({
  default: (props: {
    snapDepthsByAnchorId?: ReadonlyMap<string, readonly SnapCandidate[]>
    [key: string]: unknown
  }) => {
    capturedSnapDepths = props.snapDepthsByAnchorId
    capturedProps = props
    return null
  },
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * ResizeObserver stub that reports a fixed viewport.
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
          [{ contentRect: { width, height } as DOMRectReadOnly, target } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        ),
      )
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  ;(globalThis as { ResizeObserver: unknown }).ResizeObserver = FixedRO as unknown as typeof ResizeObserver
  return () => {
    ;(globalThis as { ResizeObserver: unknown }).ResizeObserver = RealRO
  }
}

/** A horizontal 1 km section with snap-to-stratigraphy switched ON. */
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
  // The snap sources all sit behind this one toggle (SectionPanel's own rule:
  // "one toggle covers all snap behaviour"), so it has to be on for any
  // candidate — packing boundary or contact — to reach ContactsLayer.
  view_state: { snap_to_stratigraphy: true },
  created_at: '2026-08-08T00:00:00Z',
  updated_at: '2026-08-08T00:00:00Z',
}

/** The single CPT column every case draws on — projects to along = 300 m. */
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

/**
 * One packing band on the CPT column.
 *
 * @param id Layer id.
 * @param top Depth of the band top, in metres below the collar.
 * @param base Depth of the band base, in metres below the collar.
 */
function band(id: string, top: number, base: number): LithoLayerResponse {
  return {
    id,
    model_id: 'geotech-model-1',
    formation_id: 'nad-8',
    borehole_id: null,
    cpt_id: 'cpt-1',
    depth_top_m: top,
    depth_base_m: base,
    status: 'accepted',
    source: 'manual',
    confidence: 'high',
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    body_id: 'body-1',
    notes: null,
    created_at: '2026-08-08T00:00:00Z',
    updated_at: '2026-08-08T00:00:00Z',
  } as LithoLayerResponse
}

/** A committed contact on the CPT column — the pre-existing snap source. */
const COMMITTED_CONTACT = {
  id: 'contact-1',
  model_id: 'geotech-model-1',
  formation_id: 'nad-8',
  borehole_id: null,
  cpt_id: 'cpt-1',
  depth_top_m: 7.25,
  source: 'manual_pick',
  confidence: 'high',
  observation_id: null,
  observation_layer_id: null,
  notes: null,
  synthetic_x: null,
  synthetic_y: null,
  synthetic_elevation_m: null,
  created_at: '2026-08-08T00:00:00Z',
  updated_at: '2026-08-08T00:00:00Z',
} as FormationContactResponse

/**
 * Three stacked packing bands → two INTERNAL boundaries at 2 m and 5 m.
 * The column top (0 m) and base (8 m) are not boundaries: they are where the
 * cone started and stopped, not places the ground was observed to change.
 */
const GEOTECH_MODEL: GeotechAxisModel = {
  geotechLayers: [band('g-1', 0, 2), band('g-2', 2, 5), band('g-3', 5, 8)],
  nadMeta: new Map(),
  lithoSoilByFormationId: new Map(),
  lithoFormationColorById: new Map(),
  staleColumnIds: new Set<string>(),
}

/**
 * Mount the panel on one axis and return the snap depths ContactsLayer saw.
 *
 * @param axisMode Which section axis to render.
 * @returns The snap candidates for the CPT column, ascending by depth.
 */
async function snapDepthsForAxis(
  axisMode: 'lithostratigraphic' | 'geotechnical',
): Promise<number[]> {
  const restore = withFixedSize(800, 400)
  render(
    <SectionScopeContext.Provider
      value={{
        geotechModel: GEOTECH_MODEL,
        zEpsg: 5710,
        cpts: [CPT],
        contacts: [COMMITTED_CONTACT],
        axisMode,
      }}
    >
      <SectionPanel section={SECTION} />
    </SectionScopeContext.Provider>,
  )
  await new Promise(r => setTimeout(r, 0))
  restore()
  return [...(capturedSnapDepths?.get('cpt-1') ?? [])].map(c => c.depth).sort((a, b) => a - b)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SectionPanel — packing boundaries as contact-drag snap targets', () => {
  beforeEach(() => {
    capturedSnapDepths = undefined
  })

  afterEach(() => {
    cleanup()
  })

  it('GS1 — the geotech axis offers the CPT\'s internal packing boundaries', async () => {
    const depths = await snapDepthsForAxis('geotechnical')

    expect(depths).toContain(2)
    expect(depths).toContain(5)
    // Neither end of the sounding is a snap target.
    expect(depths).not.toContain(0)
    expect(depths).not.toContain(8)
  })

  it('GS2 — the committed contacts stay in the set alongside them', async () => {
    const depths = await snapDepthsForAxis('geotechnical')

    // The packing boundaries JOIN the existing sources rather than replacing
    // them: the column's own committed contact is still snappable.
    expect(depths).toEqual([2, 5, 7.25])
  })

  it('GS3 — the litho axis contributes no packing boundary', async () => {
    const depths = await snapDepthsForAxis('lithostratigraphic')

    // Same geotech model in scope; the litho axis must be unchanged.
    expect(depths).toEqual([7.25])
  })

  it('GS4 — the geotech axis holds a drag off no boundary it is meant to reach', async () => {
    await snapDepthsForAxis('geotechnical')

    // The min-thickness clamp keeps a dragged contact 10 cm clear of its neighbours, and
    // on this axis those "neighbours" are the packing boundaries themselves — the only
    // depths the drag is allowed to land on. Passing it here would stop every drag just
    // short of every legal destination, so the gesture would commit nothing. What keeps
    // the drag honest on this axis is the landing rule instead: it may only stop on a
    // boundary the cone resistance actually resolved.
    expect(capturedProps.contactDragClampMinThicknessM).toBeUndefined()
  })

  it('GS5 — the litho axis keeps its 10 cm floor', async () => {
    await snapDepthsForAxis('lithostratigraphic')

    // Debt #152's floor is untouched: there the drag lands wherever the engineer puts it,
    // so something has to stop it from slicing a slab thinner than the model allows.
    expect(capturedProps.contactDragClampMinThicknessM).toBe(0.1)
  })
})
