// One right-click on a test = ONE menu (owner dogfeed 2026-09-11, installer #30).
//
// His words: "Now when i right click on a test on the litho axis, i get two
// different menus if i right click once or right click twice, can't we just
// merge them in one dropdown menu on right click????"
//
// WHY TWO MENUS TODAY — the mechanism these tests pin shut:
//
//   1. The whole column card on the litho axis is covered by ContactsLayer's
//      accepted-unit bands (``per-column-litho-band-*``) and, where no band
//      remains, by the per-column add capture rect. Both stop propagation, so
//      the FIRST right-click always opens the litho unit menu.
//   2. That menu is portalled to ``document.body`` behind a full-viewport
//      backdrop. The backdrop's own right-click handler closes the menu but
//      does NOT stop propagation — and a React portal bubbles up the REACT
//      tree, not the DOM tree, so the same event reaches SectionPanel's
//      ``<svg onContextMenu>`` catch-all, whose column hit-test (nudgedX ±
//      half the card width) is still satisfied. The SECOND right-click
//      therefore opens the COLUMN menu instead.
//
// The rule (owner): one right-click on a test column opens ONE menu carrying
// the column verbs first, a separator, then the verbs for the accepted litho
// unit under the pointer. A second right-click just re-opens the same menu at
// the new position. No verb disappears; no duplicate verb.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  CptListItem,
  CrossSectionResponse,
  FormationContactResponse,
  GeologicalFormationResponse,
  LithoLayerResponse,
} from '../api/client'
import SectionPanel from './SectionPanel'
import { SectionScopeContext, type SectionScope } from './sections/SectionScopeContext'

afterEach(() => cleanup())

/**
 * ResizeObserver stub that reports a fixed viewport so the canvas SVG mounts.
 *
 * @param width Canvas width in px.
 * @param height Canvas height in px.
 * @returns Restore function putting the real observer back.
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
            { contentRect: { width, height } as DOMRectReadOnly, target } as unknown as ResizeObserverEntry,
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

/** A horizontal 1 km section — a CPT at (300, 0) projects to along = 300 m. */
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
  vertical_exaggeration: 1,
  excluded_borehole_ids: [],
  excluded_cpt_ids: [],
  seeded_formation_contact_ids: [],
  min_depth_m: null,
  max_depth_m: null,
  display_order: 0,
  view_state: null,
  created_at: '2026-09-11T00:00:00Z',
  updated_at: '2026-09-11T00:00:00Z',
}

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
 * One litho formation.
 *
 * @param id Formation id.
 * @param name Display name.
 * @returns A formation row shaped like the API response.
 */
function formation(id: string, name: string): GeologicalFormationResponse {
  return {
    id,
    app_project_id: 'P',
    name,
    color: '#ff8800',
    code: null,
    display_order: 0,
    pinned_order: false,
    regional_ref: null,
    description: null,
    lithology: null,
    nad_class: null,
    parent_formation_id: null,
    litho_main_soil_code: 'KL',
    litho_admixtures: null,
    instance_ordinal: null,
    instance_ordinal_locked: false,
    parent_formation_name: null,
    parent_extrapolated: false,
    source_litho_formation_id: null,
    source_geo_formation_id: null,
    created_at: '2026-09-11T00:00:00Z',
    updated_at: '2026-09-11T00:00:00Z',
  }
}

/**
 * One accepted litho contact on the CPT column.
 *
 * @param id Contact id (which IS the accepted layer's id).
 * @param formationId The formation the band below this top belongs to.
 * @param depthTopM Depth of the contact below the collar (m).
 * @returns A contact row shaped like the API response.
 */
function contact(
  id: string,
  formationId: string,
  depthTopM: number,
): FormationContactResponse {
  return {
    id,
    model_id: 'litho-1',
    formation_id: formationId,
    borehole_id: null,
    cpt_id: 'cpt-1',
    depth_top_m: depthTopM,
    source: 'manual_pick',
    confidence: 'medium',
    observation_id: null,
    observation_layer_id: null,
    notes: null,
    synthetic_x: null,
    synthetic_y: null,
    synthetic_elevation_m: null,
    created_at: '2026-09-11T00:00:00Z',
    updated_at: '2026-09-11T00:00:00Z',
  } as FormationContactResponse
}

/**
 * The accepted litho layer twin of a contact (what the unit verbs act on).
 *
 * @param id Layer id — the same id as its contact.
 * @param formationId Owning formation.
 * @param top Depth of the layer top (m).
 * @param base Depth of the layer base (m).
 * @returns A litho layer row shaped like the API response.
 */
function layer(
  id: string,
  formationId: string,
  top: number,
  base: number,
): LithoLayerResponse {
  return {
    id,
    model_id: 'litho-1',
    formation_id: formationId,
    cpt_id: 'cpt-1',
    borehole_id: null,
    depth_top_m: top,
    depth_base_m: base,
    status: 'accepted',
    body_id: null,
    suggested_lithology: null,
    suggested_admixtures: null,
    created_at: '2026-09-11T00:00:00Z',
    updated_at: '2026-09-11T00:00:00Z',
  } as unknown as LithoLayerResponse
}

const FORMATIONS = [formation('f-clay', 'Boom Klei'), formation('f-sand', 'Zand')]
const CONTACTS = [contact('c-top', 'f-clay', 0), contact('c-deep', 'f-sand', 6)]
const LAYERS = [layer('c-top', 'f-clay', 0, 6), layer('c-deep', 'f-sand', 6, 20)]

/**
 * Mount SectionPanel on the litho axis with one CPT carrying two accepted
 * units, and with every handler the two menus need wired.
 *
 * @returns Nothing; the DOM is queried through testing-library.
 */
function renderLithoPanel(
  axisMode: SectionScope['axisMode'] = 'lithostratigraphic',
): void {
  const scope: SectionScope = {
    zEpsg: 5710,
    axisMode,
    contacts: CONTACTS,
    cpts: [CPT],
    boreholes: [],
    formations: FORMATIONS,
    activeLithoModelId: 'litho-1',
    geotechNotReconciled: false,
    lithoLayers: LAYERS,
  }
  render(
    <SectionScopeContext.Provider value={scope}>
      <SectionPanel
        section={SECTION}
        onSelectCpt={vi.fn()}
        onPatch={vi.fn().mockResolvedValue(undefined)}
        onDeleteContact={vi.fn().mockResolvedValue(undefined)}
        onEditLithoComposition={vi.fn()}
        onSplitLithoLayer={vi.fn()}
        onShowLithoUnitStatistics={vi.fn()}
      />
    </SectionScopeContext.Provider>,
  )
}

/** Wait for the ResizeObserver microtask that mounts the SVG. */
async function settle(): Promise<void> {
  await new Promise(r => setTimeout(r, 0))
}

/**
 * The accepted-unit band rect of the top unit on CPT-1, plus the screen x of
 * the column axis it sits on.
 *
 * @returns The band element and the column's centre x in SVG coordinates.
 */
function topBand(): { band: Element; columnX: number; bandY: number } {
  const band = screen.getByTestId('per-column-litho-band-cpt-1-c-top')
  const x = Number(band.getAttribute('x'))
  const width = Number(band.getAttribute('width'))
  const y = Number(band.getAttribute('y'))
  const height = Number(band.getAttribute('height'))
  return { band, columnX: x + width / 2, bandY: y + height / 2 }
}

/** Every menu row currently on screen, by accessible label text. */
function visibleMenuLabels(): string[] {
  return Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"], [data-testid="litho-band-context-menu"] button'))
    .map(el => (el.textContent ?? '').trim())
    .filter(Boolean)
}

describe('SectionPanel — right-clicking a test on the litho axis gives ONE menu', () => {
  it('LCM1 — one right-click on a test opens one menu carrying the column verbs AND the accepted unit verbs', async () => {
    const restore = withFixedSize(900, 500)
    renderLithoPanel()
    await settle()

    const { band, columnX } = topBand()
    fireEvent.contextMenu(band, { clientX: columnX, clientY: 120 })

    // Exactly one menu surface is open.
    const menus = document.querySelectorAll(
      '[data-testid="litho-band-context-menu"], [role="menu"]',
    )
    expect(menus.length, 'one right-click must leave exactly one menu on screen').toBe(1)

    // It carries BOTH groups: a column verb and the accepted unit's verbs.
    const labels = visibleMenuLabels()
    expect(labels).toContain('Focus this test')
    expect(labels).toContain('Edit composition…')
    expect(labels).toContain('Split here')
    restore()
  })

  it('LCM2 — right-clicking twice does not give a different menu', async () => {
    const restore = withFixedSize(900, 500)
    renderLithoPanel()
    await settle()

    const { band, columnX, bandY } = topBand()
    fireEvent.contextMenu(band, { clientX: columnX, clientY: bandY })
    const firstLabels = visibleMenuLabels()

    // The second right-click lands on the open menu's backdrop — the surface
    // that covers the canvas while a menu is up.
    const backdrop = screen.getByTestId('litho-band-context-menu').previousElementSibling
    expect(backdrop, 'the menu is rendered behind a dismiss backdrop').not.toBeNull()
    fireEvent.contextMenu(backdrop as Element, { clientX: columnX, clientY: bandY + 2 })

    const secondLabels = visibleMenuLabels()
    expect(secondLabels, 'the second right-click must re-open the SAME menu').toEqual(
      firstLabels,
    )
    restore()
  })

  it('LCM3 — no verb disappears and no verb is duplicated', async () => {
    const restore = withFixedSize(900, 500)
    renderLithoPanel()
    await settle()

    const { band, columnX } = topBand()
    fireEvent.contextMenu(band, { clientX: columnX, clientY: 120 })

    const labels = visibleMenuLabels()
    // Every verb the two menus offered on a litho test column today.
    for (const verb of [
      'Focus this test',
      'Open detail',
      'Remove from this section',
      'Edit composition…',
      'Split here',
      'Remove this litho unit',
      'Unit statistics…',
    ]) {
      expect(labels, `"${verb}" must still be reachable`).toContain(verb)
    }
    expect(new Set(labels).size, 'no verb appears twice').toBe(labels.length)
    restore()
  })

  it('LCM4 — over a part of the test with no accepted unit under the pointer, the one menu still has the column verbs', async () => {
    const restore = withFixedSize(900, 500)
    renderLithoPanel()
    await settle()

    const { columnX, bandY } = topBand()
    // The per-column capture rect is what answers a right-click on the card
    // where no accepted-unit band covers the pointer.
    fireEvent.contextMenu(screen.getByTestId('per-column-rclick-capture-cpt-1'), {
      clientX: columnX,
      clientY: bandY,
    })

    const labels = visibleMenuLabels()
    expect(labels).toContain('Focus this test')
    expect(labels).toContain('Add new suggestion here')
    // No accepted unit under the pointer → no unit verbs, per the rule.
    expect(labels).not.toContain('Edit composition…')
    restore()
  })

  it('LCM6 — the taller merged menu opens upward rather than running off the bottom of the window', async () => {
    const restore = withFixedSize(900, 500)
    renderLithoPanel()
    await settle()

    const { band, columnX } = topBand()
    // A right-click low on the canvas: the menu no longer fits below the
    // pointer now that the column verbs head it.
    fireEvent.contextMenu(band, { clientX: columnX, clientY: window.innerHeight - 20 })

    const menu = screen.getByTestId('litho-band-context-menu') as HTMLElement
    expect(menu.style.bottom, 'the menu anchors its BOTTOM at the pointer').not.toBe('')
    expect(menu.style.top, 'and does not also anchor its top').toBe('')
    restore()
  })

  it('LCM5 — the stratigraphic axis is untouched: its right-click still opens the column menu alone', async () => {
    const restore = withFixedSize(900, 500)
    renderLithoPanel('geological')
    await settle()

    // No litho bands on this axis, so the column glyph's own hit-box answers.
    fireEvent.contextMenu(screen.getByTestId('column-hit-CPT-1'), {
      clientX: 300,
      clientY: 200,
    })

    expect(screen.queryByTestId('litho-band-context-menu')).toBeNull()
    const labels = visibleMenuLabels()
    expect(labels).toContain('Focus this test')
    expect(labels).not.toContain('Edit composition…')
    restore()
  })
})
