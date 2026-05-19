// Behavioral net for LithoSuggestionGhostColumns (Phase 1 litho accept flow).
//
// Claims pinned here:
//   G1  Normal pending layer renders with the lithology fill colour and no
//       amber stroke (spans_boundary = false).
//   G2  A straddle layer (spans_boundary = true) renders with an amber stroke
//       and a dashed strokeDasharray so the engineer sees a visual warning
//       before accepting.
//   G3  The tooltip for a straddle layer contains the straddle warning text.
//   G4  The tooltip shows the parent formation name when formations are
//       provided and parent_formation_id is set.
//   G5  The confidence appears in the tooltip for every layer.
//   G6  Renders null when surfaceElevationM is null (cannot place layers).
//   G7  Renders null when suggestions array is empty.

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { GeologicalFormationResponse, LithoLayerSuggestion } from '../../api/client'
import type { PlacedColumn } from './utils'
import LithoSuggestionGhostColumns from './LithoSuggestionGhostColumns'

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeSuggestion(overrides: Partial<LithoLayerSuggestion> = {}): LithoLayerSuggestion {
  return {
    depth_top_m: 0,
    depth_base_m: 2,
    suggested_lithology: 'ZAND',
    suggested_nad_class: null,
    mean_qc_mpa: null,
    dr_pct: null,
    confidence: 'high',
    source: 'robertson2015',
    suggested_admixtures: [],
    parent_formation_id: null,
    spans_boundary: false,
    ...overrides,
  }
}

/** A minimal PlacedColumn that puts the investigation at x=200. */
function makeColumn(id: string): PlacedColumn {
  return {
    nudgedX: 200,
    proj: {
      along: 200,
      distance: 0,
      item: { id, kind: 'cpt', name: 'CPT-1' } as PlacedColumn['proj']['item'],
    },
  } as unknown as PlacedColumn
}

function makeFormation(id: string, name: string): GeologicalFormationResponse {
  return {
    id,
    app_project_id: 'proj-1',
    name,
    color: '#aabbcc',
    code: null,
    display_order: 0,
    lithology: 'ZAND',
    nad_class: null,
    regional_ref: null,
    description: null,
    pinned_order: false,
    parent_formation_id: null,
    litho_main_soil_code: null,
    litho_admixtures: null,
    instance_ordinal: null,
    instance_ordinal_locked: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

/**
 * A simple linear levelToScreen: at elevation 0 → y=500, at elevation 5 → y=0.
 * So depth 0–2m with surface=5m → mTAW 5–3 → y=0–200 (well within plotTop=0/plotBottom=600).
 */
const levelToScreen = (level: number): number => 500 - level * 100

function renderGhost(
  suggestions: readonly LithoLayerSuggestion[],
  opts: {
    surfaceElevationM?: number | null
    formations?: readonly GeologicalFormationResponse[]
    investigationId?: string
    acceptedIndices?: ReadonlySet<number>
    rejectedIndices?: ReadonlySet<number>
  } = {},
) {
  const id = opts.investigationId ?? 'cpt-1'
  // Explicit check for undefined so null is passed through as-is (not coalesced to 5).
  const elevation = opts.surfaceElevationM !== undefined ? opts.surfaceElevationM : 5
  return render(
    <svg>
      <LithoSuggestionGhostColumns
        columns={[makeColumn(id)]}
        investigationId={id}
        suggestions={suggestions}
        levelToScreen={levelToScreen}
        surfaceElevationM={elevation}
        plotTop={0}
        plotBottom={600}
        bandHalfWidth={20}
        acceptedIndices={opts.acceptedIndices ?? new Set()}
        rejectedIndices={opts.rejectedIndices ?? new Set()}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        formations={opts.formations}
      />
    </svg>,
  )
}

afterEach(() => {
  cleanup()
})

describe('LithoSuggestionGhostColumns', () => {
  // G1: normal (non-straddle) layer — no amber stroke.
  it('G1 — normal pending layer has no amber stroke', () => {
    const { container } = renderGhost([makeSuggestion({ spans_boundary: false })])
    const rect = container.querySelector('rect')
    expect(rect).not.toBeNull()
    // Amber-600 is #d97706; a non-straddle layer must not have it.
    expect(rect!.getAttribute('stroke')).not.toBe('#d97706')
    // No dashed stroke on a normal layer.
    expect(rect!.getAttribute('strokeDasharray')).toBeNull()
  })

  // G2: straddle layer (spans_boundary=true) has amber stroke + dasharray.
  it('G2 — straddle layer has amber dashed stroke', () => {
    const { container } = renderGhost([makeSuggestion({ spans_boundary: true })])
    const rect = container.querySelector('rect')
    expect(rect).not.toBeNull()
    expect(rect!.getAttribute('stroke')).toBe('#d97706')
    expect(rect!.getAttribute('stroke-dasharray')).toBeTruthy()
  })

  // G3: straddle tooltip contains the warning text.
  it('G3 — straddle tooltip contains straddle warning', () => {
    const { container } = renderGhost([makeSuggestion({ spans_boundary: true })])
    const title = container.querySelector('title')
    expect(title).not.toBeNull()
    expect(title!.textContent).toMatch(/straddles formation boundary/i)
  })

  // G4: tooltip shows parent formation name when formations are provided.
  it('G4 — tooltip shows parent formation name', () => {
    const formations = [makeFormation('f-1', 'Boom Klei')]
    const suggestion = makeSuggestion({ parent_formation_id: 'f-1' })
    const { container } = renderGhost([suggestion], { formations })
    // The first <title> is on the <rect> element.
    const rects = container.querySelectorAll('rect')
    const titles = Array.from(rects).map(r => r.querySelector('title')?.textContent ?? '')
    expect(titles.some(t => t.includes('Boom Klei'))).toBe(true)
  })

  // G5: tooltip includes the confidence value.
  it('G5 — tooltip contains the confidence level', () => {
    const { container } = renderGhost([makeSuggestion({ confidence: 'medium' })])
    const title = container.querySelector('title')
    expect(title!.textContent).toContain('medium')
  })

  // G6: returns null when surfaceElevationM is null.
  it('G6 — renders nothing when surfaceElevationM is null', () => {
    const { container } = renderGhost([makeSuggestion()], { surfaceElevationM: null })
    expect(container.querySelector('[data-testid="litho-suggestion-ghosts"]')).toBeNull()
  })

  // G7: returns null when suggestions is empty.
  it('G7 — renders nothing when suggestions is empty', () => {
    const { container } = renderGhost([])
    expect(container.querySelector('[data-testid="litho-suggestion-ghosts"]')).toBeNull()
  })
})
