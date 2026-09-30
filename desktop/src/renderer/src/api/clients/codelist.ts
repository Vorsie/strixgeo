/**
 * Codelist and Virtuele Boring API client.
 *
 * Covers:
 *   - ``/codelists/*`` — static reference data (G3Dv3 stratigraphic catalog,
 *     DOV formal-stratigraphy catalog). Powered by the backend codelists
 *     shipped with each build.
 *   - ``/dov/virtuele-boring/*`` and ``/projects/{pid}/virtuele-boring/*``
 *     — DOV synthetic-borehole overlays (informative-only per-investigation
 *     predictions from DOV's 3D models).
 *
 * @module clients/codelist
 */
import { get } from './shared'

// ---------------------------------------------------------------------------
// G3Dv3 types
// ---------------------------------------------------------------------------

/**
 * One unit from the G3Dv3 Flanders stratigraphic catalog.
 *
 * Powers the FormationDialog autocomplete + color autofill so engineers
 * don't retype canonical names / RGB codes on every project.
 */
export interface G3Dv3UnitResponse {
  /** Numeric G3D code (e.g. ``"0206"`` for Diest). */
  code: string
  /** G3D abbreviation (e.g. ``"NE_Di"``, ``"Q_GtAb"``, ``"A"``). */
  abbreviation: string
  rank: 'formation' | 'member'
  /** For members, the parent formation's abbreviation. */
  parent_abbreviation: string | null
  /** Dutch name (the primary user-facing label). */
  name_nl: string
  /** 0 = youngest (Antropogeen), increasing with age. */
  age_rank: number
  /** Prescribed RGB ``"#rrggbb"``; ``null`` for the rare unit with no kleurcode row. */
  color_hex: string | null
}

/** Full G3Dv3 catalog response. */
export interface G3Dv3CatalogResponse {
  units: G3Dv3UnitResponse[]
}

// ---------------------------------------------------------------------------
// Formal-stratigraphy types
// ---------------------------------------------------------------------------

/**
 * One DOV formal-stratigraphy unit.
 *
 * Powers the informal→formal link in the formation dialog (picking one
 * stores its ``code`` on the formation).
 */
export interface FormalStratigraphyUnitResponse {
  /** DOV formal-stratigraphy code (e.g. "QH", "QP", "Bm", "KoAa"). */
  code: string
  /** Canonical Dutch name (e.g. "Quartair Holoceen", "Formatie van Boom"). */
  name_nl: string
  age_rank: number | null
  color_hex: string | null
}

/** Full formal-stratigraphy catalog response. */
export interface FormalStratigraphyCatalogResponse {
  units: FormalStratigraphyUnitResponse[]
}

// ---------------------------------------------------------------------------
// Virtuele Boring types
// ---------------------------------------------------------------------------

/**
 * One Virtuele Boring lagenmodel entry from the model picker catalogue.
 *
 * See CLAUDE.md "Known Architectural Debt" #10 for the design rationale.
 */
export interface VirtueleBoringLagenmodelEntry {
  code: string
  beschrijving: string
  resoluties: number[]
}

/** One predicted layer from a DOV 3D model at a specific investigation. */
export interface VirtueleBoringLayer {
  code: string
  name: string
  beschrijving: string
  top_m_taw: number
  base_m_taw: number
  thickness_m: number
  color_hex: string | null
  ncs_link: string | null
}

/** Per-investigation synthetic-borehole prediction. */
export interface VirtueleBoringInvestigationPrediction {
  investigation_kind: 'cpt' | 'borehole'
  investigation_id: string
  name: string
  elevation_m_taw: number | null
  /** Keyed by the model codes the caller requested. Missing keys mean
   * the per-call fetch failed for that (investigation, model) pair. */
  predictions_by_model: Record<string, VirtueleBoringLayer[]>
}

/** Response from ``GET /projects/{pid}/virtuele-boring/predictions``. */
export interface VirtueleBoringPredictionsResponse {
  models: string[]
  predictions: VirtueleBoringInvestigationPrediction[]
  skipped_count: number
  /** Every per-call fetch that failed, with its reason (additive
   * 2026-09-30; absent from older backends). A partial DOV outage answers
   * 200 with the data that came back and this list explaining the rest. */
  skipped?: VirtueleBoringSkippedFetch[]
}

/** One (investigation, model) fetch that returned nothing, and why. */
export interface VirtueleBoringSkippedFetch {
  investigation_kind: 'cpt' | 'borehole'
  investigation_id: string
  name: string
  model: string
  /** ``dov_unreachable`` = no HTTP answer; ``dov_http_error`` = DOV answered non-2xx. */
  reason: 'dov_unreachable' | 'dov_http_error'
  /** Transport-error class (``ReadTimeout``) or ``HTTP <status>``. */
  detail: string
}

// ---------------------------------------------------------------------------
// Codelist API surface — ``api.codelists``
// ---------------------------------------------------------------------------

/** Typed wrappers for static reference-data endpoints. */
export const codelistClient = {
  g3dv3: (): Promise<G3Dv3CatalogResponse> => get('/codelists/g3dv3'),
  formalStratigraphy: (): Promise<FormalStratigraphyCatalogResponse> =>
    get('/codelists/formal-stratigraphy'),
}

// ---------------------------------------------------------------------------
// Virtuele Boring API surface — ``api.virtueleBoring``
// ---------------------------------------------------------------------------

/** Typed wrappers for DOV Virtuele Boring overlay endpoints. */
export const virtueleboringClient = {
  lagenmodellen: (): Promise<VirtueleBoringLagenmodelEntry[]> =>
    get('/dov/virtuele-boring/lagenmodellen'),

  predictions: (
    projectId: string,
    models: string[],
  ): Promise<VirtueleBoringPredictionsResponse> => {
    const q = new URLSearchParams({ models: models.join(',') })
    return get(`/projects/${projectId}/virtuele-boring/predictions?${q.toString()}`)
  },
}
