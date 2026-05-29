// Shared builders for the litho-accept flow (#167).
//
// The four accept handlers in useGeologicalModel (single accept, accept-all,
// bulk-one, bulk-all) each hand-rolled the same accept body — including TWO
// calls to readLithoSegmenterPrefs per copy for the straddle + couple knobs —
// and the same "record created rows in the session-imports manifest" block
// (the #144 dirty-flag fix, replicated 4×). These helpers make the body shape
// and the tuning-pref read single-source so a fifth segmenter knob, or a
// change to the dirty-flag contract, is one edit instead of four.

import type {
  AcceptLithoSuggestionsRequest,
  AcceptLithoSuggestionsResponse,
  LithoLayerSuggestion,
} from '../api/client'
import { readLithoSegmenterPrefs } from './lithoSegmenterPrefs'

/** The two segmenter knobs every accept call forwards to the backend. */
export interface LithoAcceptTuningParams {
  straddle_min_piece_thickness_m: number
  couple_tolerance_m: number
}

/**
 * Read the straddle + couple tuning knobs from a project's view-state.
 *
 * One ``readLithoSegmenterPrefs`` call instead of the two each accept site
 * used to make. Spread into both the single-accept body and the batch body.
 *
 * @param viewState - ``project.view_state`` (or null/undefined).
 * @returns The two tuning params, keyed as the backend request expects.
 */
export function lithoAcceptTuningParams(
  viewState: Record<string, unknown> | null | undefined,
): LithoAcceptTuningParams {
  const prefs = readLithoSegmenterPrefs(viewState)
  return {
    straddle_min_piece_thickness_m: prefs.straddleMinPieceThicknessM,
    couple_tolerance_m: prefs.lithoSnapToleranceM,
  }
}

/**
 * Build the body for a single ``acceptLithoSuggestions`` call.
 *
 * @param args.anchorKind - ``'cpt'`` or ``'borehole'`` — selects the id key.
 * @param args.anchorId - The investigation id.
 * @param args.sectionId - Section to seed accepted contacts into (or null).
 * @param args.suggestions - The layers to accept.
 * @param args.viewState - ``project.view_state`` for the tuning knobs.
 * @returns A request body with the anchor id, section, suggestions, and tuning.
 */
export function buildLithoAcceptBody(args: {
  anchorKind: 'cpt' | 'borehole'
  anchorId: string
  sectionId: string | null | undefined
  suggestions: LithoLayerSuggestion[]
  viewState: Record<string, unknown> | null | undefined
}): AcceptLithoSuggestionsRequest {
  const { anchorKind, anchorId, sectionId, suggestions, viewState } = args
  return {
    ...(anchorKind === 'cpt' ? { cpt_id: anchorId } : { borehole_id: anchorId }),
    section_id: sectionId ?? null,
    suggestions,
    ...lithoAcceptTuningParams(viewState),
  }
}

/**
 * Record an accept result's created rows in the session-imports manifest.
 *
 * Debt #144: an accept writes to the DB immediately, but the dirty flag +
 * .gmproj-on-save only fire when the created ids land in the manifest. Each
 * kind is added only when non-empty so a found-only accept stays clean.
 *
 * @param addToSessionImports - The manifest callback from the model hook.
 * @param result - Anything carrying ``created_formation_ids`` +
 *   ``created_contact_ids`` (an accept response, or aggregated arrays from a
 *   bulk accept).
 */
export function recordCreatedRows(
  addToSessionImports: (kind: 'formation' | 'contact', ids: string[]) => void,
  result: Pick<AcceptLithoSuggestionsResponse, 'created_formation_ids' | 'created_contact_ids'>,
): void {
  if (result.created_formation_ids.length > 0) {
    addToSessionImports('formation', result.created_formation_ids)
  }
  if (result.created_contact_ids.length > 0) {
    addToSessionImports('contact', result.created_contact_ids)
  }
}
