/**
 * What the geotech "Build model" press has to ask about before it runs.
 *
 * Owner ruling 2026-08-26, serving *"I can't have gaps or fallbacks in the
 * model unless users make mistakes"*: a test imported AFTER the packing
 * subdivision was done carries accepted litho and no packing bands. It still
 * lands in the LITHO FRAME the geotech build is framed on
 * (``buildVoxelRequest`` → ``lithoFrame.payloadColumns``), so it splits a gap
 * the geotech fill has no data for — a hole the engineer never asked for and
 * cannot see coming. This module answers, mechanically, whether the model in
 * front of the press is in that state.
 *
 * It computes NOTHING of its own. Both halves of the question are answered by
 * running the SAME assembly the builder runs — ``assembleLithoSectionInputs``
 * for the projection + acceptance gates, ``assembleSectionsWithCanonical`` for
 * the "a section needs two columns to fill between" rule. That rule is
 * deliberately never restated here as a number: a copy of it is a copy that can
 * drift, and this check exists precisely to predict what the builder will do.
 *
 * Pure — no React, no fetch, no screen coordinates. The dialog turns the result
 * into sentences; the shell turns a click into a stage switch.
 *
 * @module utils/geotechBuildPreflight
 */

import {
  assembleLithoSectionInputs,
  type InvestigationLocation,
  type LithoLayerLike,
  type SectionLike,
} from './assembleLithoSectionInputs'
import { assembleSectionPartitionInput, assembleSectionsWithCanonical } from './sectionFenceData'

/** No correlation edges are needed to decide which COLUMNS a section assembles. */
const NO_EDGES: ReadonlyMap<string, never[]> = new Map<string, never[]>()

/** A visible cross-section, named so a finding can be read out loud. */
export interface PreflightSection extends SectionLike {
  /** The row's own id — required here, unlike the geometry-only base type. */
  id: string
  /** Display name, e.g. ``"Tie-section 4"``. */
  name: string
}

/** An investigation the pre-flight can project and name. */
export interface PreflightInvestigation extends InvestigationLocation {
  /** Display name, e.g. ``"B12"``. */
  name: string
}

/** A litho / geotech layer row, in the shape the build assembly reads. */
export type PreflightLayer = LithoLayerLike

/** Everything one press needs to know about the model in front of it. */
export interface GeotechBuildPreflightInputs {
  /** The cross-sections the build will project onto, in the order shown. */
  visibleSections: readonly PreflightSection[]
  /** Every CPT + borehole the project draws. */
  investigations: readonly PreflightInvestigation[]
  /** The LITHO model's layer rows — the frame the geotech build stands on. */
  lithoLayers: readonly PreflightLayer[]
  /** The GEOTECH model's packing-band rows. */
  geotechLayers: readonly PreflightLayer[]
}

/** A cross-section the geotech build will not produce anything for. */
export interface DroppedSection {
  /** The cross-section row id. */
  sectionId: string
  /** Its display name, for the sentence the engineer reads. */
  sectionName: string
}

/** A test that is in the model but carries no packing bands yet. */
export interface UnbandedTest {
  /** CPT id or borehole id. */
  investigationId: string
  /** Display name. */
  name: string
  /**
   * Sections where it is a litho-frame column, in ``visibleSections`` order.
   *
   * These are the sections the build would draw it on, so they are also the
   * sections on which subdividing it would have an effect.
   */
  sectionIds: readonly string[]
  /**
   * Where a one-click visit lands: the FIRST section in the engineer's own list
   * order that carries this test. Any of them would do — the divide verb is
   * section-scoped either way — so the tie-break is the one he can predict.
   */
  revealSectionId: string
  /**
   * Sections that leave the build entirely while this test has no bands: their
   * litho frame exists, but fewer than two of their columns are subdivided, so
   * there is no gap for the geotech fill to fill.
   */
  droppedSections: readonly DroppedSection[]
}

/** The pre-flight verdict. */
export interface GeotechBuildPreflight {
  /**
   * Tests in the model that have accepted litho and zero packing bands, in
   * ``investigations`` order. EMPTY means the press has nothing to ask — which
   * is the state a finished model is in, and the state the Build button must
   * stay silent in.
   */
  unbandedTests: readonly UnbandedTest[]
}

/**
 * Decide whether the geotech Build press has something to ask the engineer.
 *
 * Parameters
 * ----------
 * inputs : GeotechBuildPreflightInputs
 *     The visible sections, every investigation, and both models' layer rows —
 *     all of it already on the shell bus at press time.
 *
 * Returns
 * -------
 * GeotechBuildPreflight
 *     ``unbandedTests`` empty when the model is complete; otherwise one entry
 *     per test the build would frame a gap around without any bands to fill it.
 */
export function geotechBuildPreflight(
  inputs: GeotechBuildPreflightInputs,
): GeotechBuildPreflight {
  const { visibleSections, investigations, lithoLayers, geotechLayers } = inputs

  const lithoInputs = assembleLithoSectionInputs({
    visibleSections,
    investigations,
    lithoLayers,
    edgesBySectionId: NO_EDGES,
  })
  const geotechInputs = assembleLithoSectionInputs({
    visibleSections,
    investigations,
    lithoLayers: geotechLayers,
    edgesBySectionId: NO_EDGES,
  })

  // Sections the LITHO FRAME keeps — ``assembleSectionsWithCanonical`` applies
  // the builder's own "fewer than two columns is not a gap" rule, so a section
  // the build already ignores can never produce a finding here.
  const frameColumnIdsBySectionId = new Map<string, string[]>()
  for (const kept of assembleSectionsWithCanonical(lithoInputs).assembled) {
    const sectionId = kept.input.sectionId
    if (sectionId === undefined) continue
    frameColumnIdsBySectionId.set(
      sectionId,
      kept.orderedColumns.map(c => c.investigationId),
    )
  }

  // Sections the GEOTECH assembly keeps, by the same rule. A frame-kept section
  // missing here is dropped wholesale from the build.
  const geotechKeptSectionIds = new Set<string>()
  for (const kept of assembleSectionsWithCanonical(geotechInputs).assembled) {
    if (kept.input.sectionId !== undefined) geotechKeptSectionIds.add(kept.input.sectionId)
  }

  // "Has bands" is read off the SAME assembly, unfiltered by the two-column
  // rule: a band on a test that happens to sit alone on some section is still a
  // band, and calling it missing would send the engineer to subdivide twice.
  const bandedInvestigationIds = new Set<string>()
  for (const input of geotechInputs) {
    for (const col of assembleSectionPartitionInput(input.projectedColumns, input.layers)
      .orderedColumns) {
      bandedInvestigationIds.add(col.investigationId)
    }
  }

  const sectionNameById = new Map(visibleSections.map(s => [s.id, s.name]))
  const unbandedTests: UnbandedTest[] = []
  for (const investigation of investigations) {
    if (bandedInvestigationIds.has(investigation.id)) continue
    // ``visibleSections`` order, not map-insertion order: the engineer's list is
    // what a "first section carrying it" promise has to mean.
    const sectionIds = visibleSections
      .filter(s => frameColumnIdsBySectionId.get(s.id)?.includes(investigation.id) === true)
      .map(s => s.id)
    if (sectionIds.length === 0) continue
    unbandedTests.push({
      investigationId: investigation.id,
      name: investigation.name,
      sectionIds,
      revealSectionId: sectionIds[0],
      droppedSections: sectionIds
        .filter(id => !geotechKeptSectionIds.has(id))
        .map(id => ({ sectionId: id, sectionName: sectionNameById.get(id) ?? id })),
    })
  }

  return { unbandedTests }
}
