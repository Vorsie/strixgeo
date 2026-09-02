/**
 * FREEDRAW OFF = OFF END TO END (owner ruling 2026-08-07).
 *
 * A stray two-node boundary shape persisted during the 2026-07-25 freedraw
 * dogfeed kept warping a fill band for two weeks: the feature flag suppressed
 * every handle (so the shape could not be seen or removed in-app) but the
 * RENDER still applied the stored points. The ruling: while freedraw editing
 * is disabled, stored boundary points must not shape the fill bands at all;
 * turning freedraw back on re-applies them.
 *
 * FG1 — flag OFF: a stored boundary shape handed to SectionPanel never
 *       reaches the fill overlay (it gets an empty boundaries map).
 * FG2 — flag ON: the same stored shape DOES reach the fill overlay
 *       ("we'll turn freedraw on and then the shapes should apply").
 *
 * SectionPanel mounts with the fill overlay mocked to a props-capturing stub
 * (the gate under test is SectionPanel's wiring, not the overlay's geometry),
 * and the flag module mocked per case so both branches are pinned regardless
 * of the flag's current value.
 */

import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BodyBoundaryResponse } from '../api/clients/geology.types'
import type { CrossSectionResponse } from '../api/client'

afterEach(() => {
  cleanup()
  vi.resetModules()
  vi.doUnmock('../utils/freedrawEditFlag')
  vi.doUnmock('./sections/PartitionFillOverlay')
})

/** The captured boundaries map of the latest overlay render, per test. */
let capturedBoundaries: ReadonlyMap<string, BodyBoundaryResponse> | undefined

function makeSection(): CrossSectionResponse {
  return {
    id: '01k-FIXTURE',
    app_project_id: '01k-PROJECT',
    name: 'Cross-section AA',
    description: null,
    start_x: 150000,
    start_y: 200000,
    end_x: 150500,
    end_y: 200300,
    epsg: 31370,
    projection_buffer_m: 50,
    vertical_exaggeration: 2,
    excluded_borehole_ids: [],
    excluded_cpt_ids: [],
    seeded_formation_contact_ids: [],
    min_depth_m: null,
    max_depth_m: null,
    display_order: 0,
    view_state: null,
    created_at: '2026-05-11T12:00:00Z',
    updated_at: '2026-05-11T12:00:00Z',
  } as CrossSectionResponse
}

/** One stored hand-drawn shape — the kind the 2026-07-25 dogfeed left behind. */
function storedBoundaries(): ReadonlyMap<string, BodyBoundaryResponse> {
  return new Map([
    [
      'body-silt',
      {
        body_id: 'body-silt',
        content_key: null,
        render_style: 'straight',
        primary_section_id: null,
        upper_nodes: [],
        lower_nodes: [
          { along_m: 203.2, elevation_m: 5.47 },
          { along_m: 240.9, elevation_m: 8.89 },
        ],
      },
    ],
  ])
}

// The panel renders a "Sizing canvas…" placeholder until ResizeObserver
// fires; make it fire synchronously with a fixed viewport so the SVG (and
// the fill overlay inside it) actually mounts.
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
  ;(globalThis as { ResizeObserver: unknown }).ResizeObserver =
    FixedRO as unknown as typeof ResizeObserver
  return () => {
    ;(globalThis as { ResizeObserver: unknown }).ResizeObserver = RealRO
  }
}

/**
 * Mount SectionPanel with the flag mocked to ``enabled`` and the fill overlay
 * mocked to capture its ``boundariesByBodyId`` prop; resolve the captured map.
 */
async function renderWithFlag(
  enabled: boolean,
): Promise<ReadonlyMap<string, BodyBoundaryResponse>> {
  capturedBoundaries = undefined
  vi.doMock('../utils/freedrawEditFlag', () => ({ FREEDRAW_EDIT_ENABLED: enabled }))
  vi.doMock('./sections/PartitionFillOverlay', () => ({
    default: (props: { boundariesByBodyId?: ReadonlyMap<string, BodyBoundaryResponse> }) => {
      capturedBoundaries = props.boundariesByBodyId
      return null
    },
  }))
  const { default: SectionPanel } = await import('./SectionPanel')
  // ``lenses`` / ``lensBoundaries`` are section-scoped data slices (debt #201
  // round 2): SectionsCanvas provides them via SectionScopeContext, so the
  // test provides them the same way — the overlay only mounts when ``lenses``
  // is defined.
  const { SectionScopeContext } = await import('./sections/SectionScopeContext')
  const restore = withFixedSize(800, 600)
  try {
    render(
      <SectionScopeContext.Provider
        value={{
          lenses: [],
          lensBoundaries: storedBoundaries(),
          zEpsg: 5710,
          axisMode: 'lithostratigraphic',
        }}
      >
        <SectionPanel section={makeSection()} />
      </SectionScopeContext.Provider>,
    )
    await waitFor(() => expect(capturedBoundaries).toBeDefined())
  } finally {
    restore()
  }
  return capturedBoundaries!
}

// Generous timeouts: the per-case ``vi.doMock`` + dynamic import re-transforms
// the SectionPanel module graph, which exceeds the 5 s default under the
// pre-commit hook's fully parallel suite run (passes in ~3 s standalone).
describe('SectionPanel — freedraw flag gates stored boundary points out of the fill', () => {
  it('FG1 — freedraw OFF: stored boundary points never shape the fill bands', {
    timeout: 60_000,
  }, async () => {
    const received = await renderWithFlag(false)
    expect(received.size).toBe(0)
  })

  it('FG2 — freedraw ON: the stored shape applies to the fill again', {
    timeout: 60_000,
  }, async () => {
    const received = await renderWithFlag(true)
    expect(received.get('body-silt')?.lower_nodes).toHaveLength(2)
  })
})
