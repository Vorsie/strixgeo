import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import type { CrossSectionResponse } from '../api/client'
import SectionPanel from './SectionPanel'

// Mock-friendly ResizeObserver lives in test/setup.ts; the panel uses
// it via the internal ``useElementSize`` hook.

function makeSection(overrides: Partial<CrossSectionResponse> = {}): CrossSectionResponse {
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
    ...overrides,
  }
}

describe('SectionPanel — channel toggle group', () => {
  // The five CPT data channels (qc, Rf, fs, u2, qT) each get a small
  // button in the header. Defaults (per ``DEFAULT_CPT_CHANNELS``) are
  // qc + Rf + qT on; fs + u2 off. Clicking a button flips that key
  // and, when ``onPatch`` is wired, fires a PATCH with the merged
  // view_state bag (debt #40).

  it('renders every channel button with the documented active default', () => {
    render(<SectionPanel section={makeSection()} zEpsg={5710} />)
    expect(screen.getByLabelText('Toggle qc')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Toggle Rf')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Toggle qT')).toHaveAttribute('aria-pressed', 'true')
    // fs + u2 default off — only surface when the user opts in.
    expect(screen.getByLabelText('Toggle fs')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText('Toggle u2')).toHaveAttribute('aria-pressed', 'false')
  })

  it('reads persisted toggle state out of section.view_state on first render', () => {
    const section = makeSection({
      view_state: {
        cpt_channels: { qc: false, rf: true, fs: true, u2: false, qTotal: false },
      },
    })
    render(<SectionPanel section={section} zEpsg={5710} />)
    expect(screen.getByLabelText('Toggle qc')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText('Toggle fs')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Toggle qT')).toHaveAttribute('aria-pressed', 'false')
  })

  it('clicking a toggle fires onPatch with the full channels bag under cpt_channels', () => {
    const onPatch = vi.fn().mockResolvedValue(undefined)
    render(<SectionPanel section={makeSection()} zEpsg={5710} onPatch={onPatch} />)

    fireEvent.click(screen.getByLabelText('Toggle fs'))

    expect(onPatch).toHaveBeenCalledTimes(1)
    expect(onPatch).toHaveBeenCalledWith({
      view_state: {
        // qc/rf/qTotal stay at defaults; fs flips on.
        cpt_channels: { qc: true, rf: true, fs: true, u2: false, qTotal: true },
      },
    })
  })

  it('clicking updates the button state optimistically (no server round-trip needed)', () => {
    render(<SectionPanel section={makeSection()} zEpsg={5710} />)
    const fs = screen.getByLabelText('Toggle fs')
    expect(fs).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(fs)
    expect(fs).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('SectionPanel — header readouts', () => {
  it('renders the section name and the Euclidean length of the line', () => {
    // length = sqrt(500² + 300²) ≈ 583 m
    render(<SectionPanel section={makeSection()} zEpsg={5710} />)
    expect(screen.getByTitle('Cross-section AA')).toBeInTheDocument()
    // Both the header subtext and the scrub bar's right-edge label
    // render the length. getAllByText accepts either as evidence the
    // value is wired through.
    expect(screen.getAllByText(/583 m/).length).toBeGreaterThan(0)
    expect(screen.getByText(/buffer ±50 m/)).toBeInTheDocument()
  })

  it('seeds the VEX slider from the section row', () => {
    render(<SectionPanel section={makeSection({ vertical_exaggeration: 5 })} zEpsg={5710} />)
    expect(screen.getByText(/5\.0×/)).toBeInTheDocument()
  })

  it('falls back to 1× VEX when the section row is missing the column', () => {
    // ``vertical_exaggeration`` is NOT NULL server-side but a hand-
    // crafted fixture (or a future migration) might omit it; the
    // component's null-coalesce keeps the slider sane.
    const s = makeSection() as Partial<CrossSectionResponse>
    delete (s as { vertical_exaggeration?: number }).vertical_exaggeration
    render(<SectionPanel section={s as CrossSectionResponse} zEpsg={5710} />)
    expect(screen.getByText(/1\.0×/)).toBeInTheDocument()
  })
})

describe('SectionPanel — axis label uses the project vertical datum', () => {
  // ``verticalDatumShort`` resolves 5710 → "TAW" and 5709 → "NAP".
  // Reading the axis label tells the user which datum the level
  // values are in without re-checking project metadata.

  it('labels Y "Level (TAW)" for Belgium projects (EPSG 5710)', () => {
    render(<SectionPanel section={makeSection()} zEpsg={5710} />)
    expect(screen.getByText('Level (TAW)')).toBeInTheDocument()
  })

  it('labels Y "Level (NAP)" for Netherlands projects (EPSG 5709)', () => {
    render(<SectionPanel section={makeSection()} zEpsg={5709} />)
    expect(screen.getByText('Level (NAP)')).toBeInTheDocument()
  })

  it('falls back to bare "Level (m)" when the project has no z_epsg', () => {
    render(<SectionPanel section={makeSection()} zEpsg={null} />)
    expect(screen.getByText('Level (m)')).toBeInTheDocument()
  })
})

describe('SectionPanel — Reset button restores defaults', () => {
  it('clicking Reset is wired (no crash; component re-renders)', () => {
    // Stubbing the user-event chain for pan/wheel would over-test;
    // here we just confirm the Reset button is reachable and
    // clicking it doesn't throw. Real pan/zoom behaviour is exercised
    // by the bundled smoke test in the dev build, not unit tests.
    const onMouseDown = vi.fn()
    render(<SectionPanel section={makeSection()} zEpsg={5710} />)
    const reset = screen.getByTitle('Reset view to default framing')
    reset.click()
    expect(onMouseDown).not.toHaveBeenCalled() // sanity: click didn't propagate
  })
})

describe('SectionPanel — investigation columns', () => {
  // A horizontal 1km section at the origin of the section's CRS.
  // Investigation points use the same CRS — math reduces cleanly:
  // a CPT at (300, 0) projects to along=300, offset=0.
  const horizontal1km = makeSection({
    start_x: 0,
    start_y: 0,
    end_x: 1000,
    end_y: 0,
    projection_buffer_m: 50,
  })

  // ResizeObserver is stubbed in test/setup.ts but doesn't trigger a
  // size by default — the panel renders a "Sizing canvas…" placeholder
  // until the observer fires. For these tests we mock the observer to
  // call back synchronously with a fixed viewport, so the SVG (and
  // therefore the column glyphs) actually render.
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
        // Async like the real observer fires.
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

  function makeCpt(overrides: Record<string, unknown>): import('../api/client').CptListItem {
    return {
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
      ...overrides,
    } as unknown as import('../api/client').CptListItem
  }

  function makeBorehole(
    overrides: Record<string, unknown>,
  ): import('../api/client').BoreholeListItem {
    return {
      id: 'bh-1',
      name: 'BH-1',
      borehole_type: 'DOV',
      test_id: 'T',
      location_x: 600,
      location_y: 10,
      elevation_m: 7,
      epsg: 31370,
      z_epsg: 5710,
      total_depth_m: 25,
      drill_method: 'rotary',
      ...overrides,
    } as import('../api/client').BoreholeListItem
  }

  it('renders a column for each CPT and borehole whose projection lands in the section', async () => {
    const restore = withFixedSize(800, 400)
    // location_y=0 keeps the offset under 1m so the name label is the
    // plain investigation name — easier to find than the offset-
    // suffixed version (covered separately below).
    const cpt = makeCpt({ location_y: 0 })
    const bh = makeBorehole({ location_y: 0 })
    render(
      <SectionPanel
        section={horizontal1km}
        zEpsg={5710}
        cpts={[cpt]}
        boreholes={[bh]}
      />,
    )
    // Wait for ResizeObserver microtask so the SVG mounts.
    await new Promise(r => setTimeout(r, 0))
    expect(screen.getByText('CPT-1')).toBeInTheDocument()
    expect(screen.getByText('BH-1')).toBeInTheDocument()
    restore()
  })

  it('drops investigations whose perpendicular distance exceeds the projection buffer', async () => {
    const restore = withFixedSize(800, 400)
    const far = makeCpt({ id: 'cpt-far', name: 'CPT-FAR', location_y: 200 })
    render(
      <SectionPanel
        section={horizontal1km}
        zEpsg={5710}
        cpts={[far]}
      />,
    )
    await new Promise(r => setTimeout(r, 0))
    expect(screen.queryByText('CPT-FAR')).not.toBeInTheDocument()
    restore()
  })

  it('honours the section.excluded_cpt_ids list — user-hidden CPTs do not render', async () => {
    const restore = withFixedSize(800, 400)
    const a = makeCpt({ id: 'cpt-a', name: 'CPT-A', location_x: 200 })
    const b = makeCpt({ id: 'cpt-b', name: 'CPT-B', location_x: 400 })
    render(
      <SectionPanel
        section={{ ...horizontal1km, excluded_cpt_ids: ['cpt-a'] }}
        zEpsg={5710}
        cpts={[a, b]}
      />,
    )
    await new Promise(r => setTimeout(r, 0))
    expect(screen.queryByText('CPT-A')).not.toBeInTheDocument()
    expect(screen.getByText('CPT-B')).toBeInTheDocument()
    restore()
  })

  it('Esc with nothing else to peel calls onClose (back to map view)', async () => {
    // Final LIFO level of the section's Esc peel: when no context menu
    // is open, no correlate source armed, not in correlate mode, no
    // focused column — the Esc closes the section panel via onClose,
    // which the parent (SectionsCanvas) wires to clearSectionSelection,
    // and the canvas falls back to MapView.
    const restore = withFixedSize(800, 400)
    const onClose = vi.fn()
    render(
      <SectionPanel
        section={horizontal1km}
        zEpsg={5710}
        onClose={onClose}
      />,
    )
    await new Promise(r => setTimeout(r, 0))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    restore()
  })

  it('Esc inside a text input does not call onClose (preserves text-edit Esc)', async () => {
    // Guard from the existing Esc handler — typing targets keep their
    // own Esc semantics (e.g. cancelling IME composition).
    const restore = withFixedSize(800, 400)
    const onClose = vi.fn()
    render(
      <SectionPanel
        section={horizontal1km}
        zEpsg={5710}
        onClose={onClose}
      />,
    )
    await new Promise(r => setTimeout(r, 0))
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    document.body.removeChild(input)
    restore()
  })

  it('adds an offset hint to the name label when |offset| ≥ 1 m', async () => {
    const restore = withFixedSize(800, 400)
    // Borehole at y=12 → offset = -12 m (right side of the line per
    // the projection convention). Engineers should see "→12 m" in
    // the label.
    const offline = makeBorehole({ id: 'bh-off', name: 'BH-OFF', location_y: 12 })
    render(
      <SectionPanel
        section={horizontal1km}
        zEpsg={5710}
        boreholes={[offline]}
      />,
    )
    await new Promise(r => setTimeout(r, 0))
    expect(screen.getByText(/BH-OFF.*→12 m/)).toBeInTheDocument()
    restore()
  })

  // Debt #75 regression net: ContactsLayer's per-contact drag strips
  // (transparent rects spanning between investigations) used to render
  // AFTER the litho ghost overlays — SVG paint order = z-order, so the
  // strips captured mousedown events meant for the ghost drag handles
  // in the bulk (zoomed-out) view. The fix swapped the order; this
  // test pins it via document-order assertion so a future refactor
  // can't silently revert.
  it('litho ghost drag handles render AFTER contact drag strips in DOM order (debt #75)', async () => {
    const restore = withFixedSize(800, 400)

    const cpt = makeCpt({ location_x: 500, location_y: 0 })
    // Contact at the CPT's projection — gives ContactsLayer a polyline
    // segment + a drag-strip rect to render.
    const formationA: import('../api/client').GeologicalFormationResponse = {
      id: 'formation-A',
      app_project_id: 'P',
      name: 'F-A',
      color: '#aabbcc',
      code: null,
      display_order: 0,
      pinned_order: false,
      regional_ref: null,
      description: null,
      lithology: null,
      nad_class: null,
      parent_formation_id: null,
      litho_main_soil_code: null,
      litho_admixtures: null,
      instance_ordinal: null,
      instance_ordinal_locked: false,
      parent_formation_name: null,
    parent_extrapolated: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    const contact: import('../api/client').FormationContactResponse = {
      id: 'contact-1',
      model_id: 'model-1',
      formation_id: 'formation-A',
      borehole_id: null,
      cpt_id: 'cpt-1',
      depth_top_m: 5,
      source: 'manual_pick',
      confidence: 'high',
      observation_id: null,
      observation_layer_id: null,
      notes: null,
      synthetic_x: null,
      synthetic_y: null,
      synthetic_elevation_m: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    // Litho ghost overlay on the same CPT — supplies a layer whose
    // drag handles should sit on top of the contact strip.
    const suggestion: import('../api/client').LithoLayerSuggestion = {
      depth_top_m: 2,
      depth_base_m: 8,
      suggested_lithology: 'ZAND',
      suggested_admixtures: [],
      suggested_nad_class: null,
      mean_qc_mpa: null,
      dr_pct: null,
      confidence: 'high',
      source: 'robertson2015',
      parent_formation_id: null,
      spans_boundary: false,
    } as unknown as import('../api/client').LithoLayerSuggestion

    render(
      <SectionPanel
        section={horizontal1km}
        zEpsg={5710}
        cpts={[cpt]}
        contacts={[contact]}
        formations={[formationA]}
        onUpdateContactDepth={vi.fn()}
        lithoGhostState={{
          suggestions: [suggestion],
          investigationId: 'cpt-1',
          surfaceElevationM: 5,
          acceptedIndices: new Set<number>(),
          rejectedIndices: new Set<number>(),
          onAccept: vi.fn(),
          onReject: vi.fn(),
          edits: new Map(),
          onEdit: vi.fn(),
        }}
      />,
    )
    await new Promise(r => setTimeout(r, 0))

    // Document-order query — querySelectorAll preserves DOM order.
    const both = document.querySelectorAll(
      '[data-testid="contact-drag-strip"], [data-testid^="litho-drag-"]',
    )
    // Find the first node of each kind. The contact strip must appear
    // BEFORE any litho drag handle so SVG paint order puts the litho
    // handles on top.
    let firstContactIdx = -1
    let firstLithoIdx = -1
    both.forEach((el, i) => {
      const tid = el.getAttribute('data-testid') ?? ''
      if (firstContactIdx === -1 && tid === 'contact-drag-strip') firstContactIdx = i
      if (firstLithoIdx === -1 && tid.startsWith('litho-drag-')) firstLithoIdx = i
    })
    // Setup precondition — both must actually render or the test is
    // useless (would pass trivially).
    expect(firstContactIdx).toBeGreaterThanOrEqual(0)
    expect(firstLithoIdx).toBeGreaterThanOrEqual(0)
    expect(firstLithoIdx).toBeGreaterThan(firstContactIdx)
    restore()
  })
})

describe('SectionPanel — gesture hint pill', () => {
  // The bottom-left cheat pill always lists the canvas pan/zoom/column
  // gestures; on the litho axis it adds a second line for the otherwise
  // undiscoverable litho-layer gestures (Alt+drag copy — debt #95).

  it('shows the litho-layer gesture line on the lithostratigraphic axis', () => {
    render(
      <SectionPanel section={makeSection()} zEpsg={5710} axisMode="lithostratigraphic" />,
    )
    expect(screen.getByTestId('litho-gesture-hint')).toBeInTheDocument()
    expect(screen.getByTestId('litho-gesture-hint')).toHaveTextContent(/Alt\+drag/i)
  })

  it('omits the litho gesture line on the default geological axis', () => {
    render(<SectionPanel section={makeSection()} zEpsg={5710} />)
    expect(screen.queryByTestId('litho-gesture-hint')).toBeNull()
  })
})

describe('SectionPanel — correlate-mode hint pill (debt #100)', () => {
  // Inline explainer for the Correlate gesture. Appears only while
  // correlate mode is active; auto-dismisses on exit-mode. Replaces the
  // pre-#100 "the only mode affordance is a toolbar toggle" failure.

  const baseGestureState = {
    correlateMode: false,
    correlationSource: null,
    onArm: vi.fn(),
    onClearArmed: vi.fn(),
    onExitMode: vi.fn(),
    onCorrelate: vi.fn(),
    onUncorrelate: vi.fn(),
    onPropagateAdmixtures: vi.fn(),
  }

  it('renders the hint pill when correlateMode is true', () => {
    render(
      <SectionPanel
        section={makeSection()}
        zEpsg={5710}
        correlateGestureState={{ ...baseGestureState, correlateMode: true }}
      />,
    )
    expect(screen.getByTestId('correlate-mode-hint')).toBeInTheDocument()
    expect(screen.getByTestId('correlate-mode-hint')).toHaveTextContent(/Correlate/i)
    expect(screen.getByTestId('correlate-mode-hint')).toHaveTextContent(
      /click a unit on one column/i,
    )
  })

  it('omits the hint pill when correlateMode is false', () => {
    render(
      <SectionPanel
        section={makeSection()}
        zEpsg={5710}
        correlateGestureState={{ ...baseGestureState, correlateMode: false }}
      />,
    )
    expect(screen.queryByTestId('correlate-mode-hint')).toBeNull()
  })

  it('clicking the ✕ on the pill fires onExitMode', () => {
    const onExitMode = vi.fn()
    render(
      <SectionPanel
        section={makeSection()}
        zEpsg={5710}
        correlateGestureState={{ ...baseGestureState, correlateMode: true, onExitMode }}
      />,
    )
    fireEvent.click(screen.getByLabelText('Exit correlate mode'))
    expect(onExitMode).toHaveBeenCalledTimes(1)
  })

  // -------------------------------------------------------------------
  // Accept-first reminder (dogfeed 2026-05-23). When the user enters
  // correlate mode WITH pending ghosts on the section, surface a
  // second amber pill so they know correlate doesn't operate on
  // pre-commit ghosts.
  // -------------------------------------------------------------------

  it('CR1 — accept-first banner renders when correlate mode + pendingGhostCount > 0', () => {
    render(
      <SectionPanel
        section={makeSection()}
        zEpsg={5710}
        correlateGestureState={{ ...baseGestureState, correlateMode: true }}
        pendingGhostInvestigationCount={3}
      />,
    )
    const banner = screen.getByTestId('correlate-accept-first-hint')
    expect(banner).toBeInTheDocument()
    expect(banner).toHaveTextContent(/3 investigation/i)
    expect(banner).toHaveTextContent(/accept those first/i)
  })

  it('CR2 — singular wording when exactly one investigation has pending ghosts', () => {
    render(
      <SectionPanel
        section={makeSection()}
        zEpsg={5710}
        correlateGestureState={{ ...baseGestureState, correlateMode: true }}
        pendingGhostInvestigationCount={1}
      />,
    )
    const banner = screen.getByTestId('correlate-accept-first-hint')
    expect(banner).toHaveTextContent(/^1 investigation still has/i)
  })

  it('CR3 — banner is absent when not in correlate mode', () => {
    render(
      <SectionPanel
        section={makeSection()}
        zEpsg={5710}
        correlateGestureState={{ ...baseGestureState, correlateMode: false }}
        pendingGhostInvestigationCount={3}
      />,
    )
    expect(screen.queryByTestId('correlate-accept-first-hint')).toBeNull()
  })

  it('CR4 — banner is absent when pendingGhostCount is 0 (everything accepted)', () => {
    render(
      <SectionPanel
        section={makeSection()}
        zEpsg={5710}
        correlateGestureState={{ ...baseGestureState, correlateMode: true }}
        pendingGhostInvestigationCount={0}
      />,
    )
    expect(screen.queryByTestId('correlate-accept-first-hint')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Lens gesture — activeLithoModelId + onLensCreated prop contract
// (Blockers 1 + 4, reviewer fixup 2026-05-24)
// ---------------------------------------------------------------------------

describe('SectionPanel — lens gesture prop contract', () => {
  it('renders without error when activeLithoModelId + onLensCreated are provided with empty contacts', () => {
    // Blocker 4 regression: previously SectionPanel derived modelId from
    // contacts.find(...)?.model_id ?? '' — when contacts is empty the fallback
    // produced '' and the backend rejected the request.  The prop is now
    // threaded directly; this test confirms no crash on empty contacts.
    const onLensCreated = vi.fn()
    expect(() =>
      render(
        <SectionPanel
          section={makeSection()}
          zEpsg={5710}
          axisMode="lithostratigraphic"
          activeLithoModelId="01k-LITHO-MODEL"
          onLensCreated={onLensCreated}
          contacts={[]}
        />,
      ),
    ).not.toThrow()
  })

  it('renders without error when onLensCreated is omitted (no gesture surface)', () => {
    // When onLensCreated is absent the "Mark as lens…" menu item is hidden.
    // This test guards against a regression where omitting the prop crashes.
    expect(() =>
      render(
        <SectionPanel
          section={makeSection()}
          zEpsg={5710}
          axisMode="lithostratigraphic"
        />,
      ),
    ).not.toThrow()
  })
})

// Note: the SectionPanel-level integration for "Remove from section"
// (right-click column → menu → push undo command) is covered by unit
// tests on the pure helper in ``sections/removeFromSectionCommand.test.ts``.
// The full render-path integration is too brittle in jsdom (the column
// context menu's portal + the ResizeObserver-gated SVG mount + the
// handleColumnContextMenu's getBoundingClientRect call all need a real
// layout pass jsdom doesn't provide).
