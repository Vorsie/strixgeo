/**
 * Cross-section data hook — projects investigations onto the
 * section line, fetches DEM samples + CPT plot batch, exposes the
 * persisted CPT channel toggles.
 *
 * Pulled out of ``SectionPanel.tsx`` so the panel becomes a thin
 * orchestrator of viewport state + coordinate transforms. The
 * upcoming geological-model editor consumes the same hook output
 * (projected columns + CPT plot data) as props, which is the whole
 * reason for the split.
 *
 * What this hook owns:
 *
 *   * The DEM polyline samples (single ``/dem/sample`` round-trip
 *     per section identity).
 *   * The CPT plot batch (single ``/cpt/plot-batch`` round-trip per
 *     section identity, scoped to in-buffer ids).
 *   * The projected investigation lists (CPTs + boreholes,
 *     respecting per-section excluded ids).
 *   * The persisted CPT channel toggles read out of
 *     ``section.view_state``.
 *
 * What it does NOT own:
 *
 *   * Viewport state (pan / zoom / VEX). Those live in
 *     ``SectionPanel`` because the editor overlay needs them too,
 *     but reads coordinate transforms derived from them.
 *   * The collision-handled ``placedColumns`` list. That depends on
 *     viewport (``xToScreen``, ``scaleH``) so it's computed inside
 *     ``SectionPanel`` from the hook output + viewport state.
 */

import { useEffect, useMemo, useState } from 'react'

import {
  api,
  type BoreholeListItem,
  type CptListItem,
  type CptPlotResponse,
  type CrossSectionResponse,
  type DemSamplePoint,
} from '../../api/client'
import { log } from '../../utils/log'
import {
  investigationsOnSection,
  type ProjectedInvestigation,
} from '../../utils/sectionProjection'
import { readCptChannels, type CptChannels } from './cptChannels'

export interface SectionData {
  /** CPT data-channel toggles read out of the section's
   * ``view_state``. Persisting changes back is debt #40 — for now
   * this is read-only at the section level. */
  cptChannels: CptChannels
  /** DEM ground-surface samples along the section line. ``null``
   * while the request is in flight (or after an error — the
   * renderer simply skips the polyline). */
  demSamples: DemSamplePoint[] | null
  /** CPT id → plot response. ``null`` while the batch request is
   * in flight; ``Map`` once it resolves (possibly empty when no
   * CPTs project onto the section). */
  cptPlots: Map<string, CptPlotResponse> | null
  /** CPTs projected onto the section line, with per-CPT
   * along-distance + offset. Excludes anything in
   * ``section.excluded_cpt_ids``. */
  projectedCpts: ProjectedInvestigation<CptListItem>[]
  /** Boreholes projected onto the section line, with per-borehole
   * along-distance + offset. Excludes anything in
   * ``section.excluded_borehole_ids``. */
  projectedBoreholes: ProjectedInvestigation<BoreholeListItem>[]
}

/**
 * Drive the cross-section data layer from the current section row
 * + the project's CPT and borehole lists.
 *
 * Parameters
 * ----------
 * section : CrossSectionResponse
 *     The active section row (server-truth — coordinate endpoints,
 *     CRS, projection buffer, exclusion lists, view_state bag).
 * cpts : readonly CptListItem[]
 *     Every CPT in the project. The hook filters to those that
 *     project within the section's buffer + endpoints.
 * boreholes : readonly BoreholeListItem[]
 *     Same filter as ``cpts``.
 */
export function useSectionData(
  section: CrossSectionResponse,
  cpts: readonly CptListItem[],
  boreholes: readonly BoreholeListItem[],
): SectionData {
  // Channels the user has toggled on. Read from the section row's
  // ``view_state`` bag; defaults via ``readCptChannels`` when the
  // bag is null (sections from before the column landed) or when
  // a key is missing. The toggle UI lands in S7 polish v2 and wires
  // a debounced ``PATCH /sections/{id}`` to persist changes
  // (debt #40 tracks the frontend half).
  const [cptChannels] = useState<CptChannels>(() => readCptChannels(section.view_state))

  // ---- DEM ground-surface samples ---------------------------------------

  // Fetch elevations from the backend's /dem/sample endpoint when
  // the section's endpoints / CRS change. ``null`` = not loaded yet
  // (or the endpoint returned an error — see catch below); the
  // renderer simply skips the polyline in that case rather than
  // blocking the whole panel. 200 samples is enough for a smooth
  // profile at any realistic screen width.
  const [demSamples, setDemSamples] = useState<DemSamplePoint[] | null>(null)
  useEffect(() => {
    let cancelled = false
    setDemSamples(null)
    api.dem
      .sampleLine({
        startX: section.start_x,
        startY: section.start_y,
        endX: section.end_x,
        endY: section.end_y,
        epsg: section.epsg,
        nSamples: 200,
      })
      .then(res => {
        if (cancelled) return
        setDemSamples(res.samples)
        log.debug('dem', `loaded ${res.samples.length} samples from ${res.source}`)
      })
      .catch(err => {
        // Backend returns 400 when the section's CRS isn't mapped
        // to a DEM source (anything outside EPSG:31370 today). Stay
        // quiet — the section still renders cleanly, just without
        // the surface line.
        log.warn('dem', `sample failed for section ${section.id}`, err)
      })
    return () => {
      cancelled = true
    }
  }, [
    section.id,
    section.start_x,
    section.start_y,
    section.end_x,
    section.end_y,
    section.epsg,
  ])

  // ---- Projected investigations -----------------------------------------

  // Filter + project the CPTs and boreholes onto the section line.
  // ``excluded_*_ids`` on the section row let the user manually
  // hide specific items; we honour them here. Built once per
  // (section, data) change — pan / zoom / VEX never invalidate the
  // projection, they just re-map the projected world coords to
  // screen.
  const excludedCptIds = useMemo(
    () => new Set(section.excluded_cpt_ids),
    [section.excluded_cpt_ids],
  )
  const excludedBhIds = useMemo(
    () => new Set(section.excluded_borehole_ids),
    [section.excluded_borehole_ids],
  )
  const projectedCpts = useMemo(
    () => investigationsOnSection(section, cpts, excludedCptIds),
    [section, cpts, excludedCptIds],
  )
  const projectedBoreholes = useMemo(
    () => investigationsOnSection(section, boreholes, excludedBhIds),
    [section, boreholes, excludedBhIds],
  )

  // ---- CPT plot data batch ----------------------------------------------

  // Map of cpt id → CptPlotResponse, populated on section open via
  // a single ``plot-batch`` round-trip. ``null`` while loading,
  // ``Map`` once the response lands. The column renderer skips the
  // data tracks when an id isn't in the map (e.g. just-imported
  // CPT before refresh, or unknown id from a stale section row).
  const [cptPlots, setCptPlots] = useState<Map<string, CptPlotResponse> | null>(null)
  const inBufferCptIds = useMemo<string[]>(
    () => projectedCpts.map(p => p.item.id),
    [projectedCpts],
  )
  // Stable signature for the effect deps — when callers don't pass
  // ``cpts`` (test fixtures, callers that don't have the list yet),
  // the default empty array creates a NEW array literal on every
  // render. ``useMemo`` over that returns a NEW ``[]`` per render
  // too, so a raw ``[inBufferCptIds]`` effect dep fires on every
  // render → setCptPlots → re-render → infinite loop (and a hung
  // jsdom worker in tests).
  //
  // Joining to a string collapses reference churn into a value
  // comparison. We pay one ``.join`` per render in exchange for a
  // bounded effect.
  const inBufferCptIdsKey = inBufferCptIds.join(',')
  useEffect(() => {
    let cancelled = false
    setCptPlots(null)
    if (inBufferCptIds.length === 0) {
      setCptPlots(new Map())
      return
    }
    api.cpt
      .plotBatch(inBufferCptIds, section.app_project_id)
      .then(plots => {
        if (cancelled) return
        const m = new Map<string, CptPlotResponse>()
        for (const p of plots) m.set(p.cpt_id, p)
        setCptPlots(m)
        log.debug(
          'section',
          `loaded ${plots.length}/${inBufferCptIds.length} CPT plots`,
        )
      })
      .catch(err => {
        // Network failure is recoverable — the panel still renders
        // bare columns. Log it; don't block.
        log.warn('section', `cpt plot-batch failed for ${section.id}`, err)
        if (!cancelled) setCptPlots(new Map())
      })
    return () => {
      cancelled = true
    }
    // reason: inBufferCptIds is intentionally NOT in the deps —
    // its identity changes every render under the default-prop
    // literal. The string key above captures its content stably.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section.id, section.app_project_id, inBufferCptIdsKey])

  return {
    cptChannels,
    demSamples,
    cptPlots,
    projectedCpts,
    projectedBoreholes,
  }
}
