/**
 * What the geotech "N pending here" chip needs in order to ANSWER its own count.
 *
 * Owner dogfeed 2026-08-25: *"now i get a one pending notification but i don't
 * see any pending ties? Why don't we make that clickable so it highlights the
 * tie?"*
 *
 * The count and the canvas disagree by construction. The count is per SECTION
 * — it comes from ``GET .../geotech/tie-status``'s ``pending_by_section``, which
 * keys on the edge's own ``section_id``. The canvas draws per RENDERED COLUMN —
 * ``CorrelationEdgesOverlay`` resolves both endpoints through the placed-column
 * map and returns ``null`` when either is missing. A tie whose endpoint column
 * is not being drawn therefore contributes to the count and renders nothing,
 * which is exactly the state the owner was staring at.
 *
 * So a press has to answer either way: centre and highlight the tie when both
 * ends are on screen, and NAME both ends plus the reason when they are not.
 * This module is the pure half — the tie list, the reason walk, and the
 * sentence. It holds no React and no screen coordinates on purpose: resolving a
 * screen position is the render surface's own job (see
 * ``PartitionFillOverlay.onJumpToConflictGap`` for why an index must never
 * cross that boundary).
 *
 * @module utils/pendingTieReveal
 */

import type {
  LithoContactCorrelationEdge,
  LithoLayerResponse,
} from '../api/clients/geology.types'
import { PENDING_TIE_DEPTH_DECIMALS, TIE_ENDPOINT_SEPARATOR } from './pendingTieReveal_constants'

/** One end of a pending tie, resolved from the band row it was drawn on. */
export interface PendingTieEndpoint {
  /** The geotech band (``LithoLayerResponse``) row id the edge points at. */
  layerId: string
  /** The investigation the band stands on — a CPT id or a borehole id. */
  investigationId: string
  /** Which of the two anchor columns ``investigationId`` names. */
  kind: 'cpt' | 'borehole'
  /** Band top, metres below the collar. */
  depthTopM: number
  /** Band base, metres below the collar. */
  depthBaseM: number
}

/** A proposed packing tie on one section, with both ends resolved. */
export interface PendingTie {
  /** The correlation-edge row id — what the highlight keys on. */
  edgeId: string
  /** Creation stamp; the visit order is oldest first. */
  createdAt: string
  /** The ``layer_a_id`` end. */
  a: PendingTieEndpoint
  /** The ``layer_b_id`` end. */
  b: PendingTieEndpoint
}

/**
 * Why a section is not drawing a column, in the order the gates actually fire.
 *
 * Each value names ONE gate in the real render path, so the sentence the
 * engineer reads points at the control that would undo it:
 *
 * ``unknown-investigation``
 *     Not in the project's investigation list at all.
 * ``not-in-project-file``
 *     The App-level manifest gate (``App.tsx`` → ``visibleBoreholes``): the row
 *     exists in the database but not in the opened project file, so it is
 *     treated as "unsaved from a previous session".
 * ``hidden-from-project``
 *     The project-local removed set — the Data stage's "X this row" hide.
 * ``excluded-from-model``
 *     The active axis model's ``excluded_borehole_ids`` ("Boreholes in model").
 * ``excluded-from-section``
 *     The cross-section row's ``excluded_borehole_ids`` / ``excluded_cpt_ids``.
 * ``outside-corridor``
 *     ``investigationsOnSection`` dropped it: it projects past an end of the
 *     line, or further than ``projection_buffer_m`` from it.
 * ``column-focus``
 *     Column focus is on, so the section draws the focused column only.
 * ``unknown``
 *     Every gate above is open and the column is still absent — reported
 *     honestly rather than guessed at.
 */
export type ColumnAbsenceCode =
  | 'unknown-investigation'
  | 'not-in-project-file'
  | 'hidden-from-project'
  | 'excluded-from-model'
  | 'excluded-from-section'
  | 'outside-corridor'
  | 'column-focus'
  | 'unknown'

/** One reading of every gate, for one investigation, on the open section. */
export interface ColumnAbsenceInputs {
  /** It appears in the project's full investigation list. */
  knownToProject: boolean
  /** It sits in the project-local removed set. */
  hiddenFromProject: boolean
  /** It survives the manifest + removed-set filter the whole app renders from. */
  visibleInProject: boolean
  /** The active axis model excludes it. */
  excludedFromModel: boolean
  /** The open cross-section excludes it. */
  excludedFromSection: boolean
  /** It projects onto the open section inside the corridor. */
  projectsOntoSection: boolean
  /** Column focus is active, so only the focused column is drawn. */
  columnFocusOn: boolean
}

/** An absent endpoint, paired with the gate that dropped it. */
export interface ColumnAbsence {
  investigationId: string
  code: ColumnAbsenceCode
}

/** Everything {@link describeUndrawableTie} needs to write its sentence. */
export interface UndrawableTieDescription {
  /** The tie that cannot be drawn. */
  tie: PendingTie
  /** ``investigation id → display name``; a miss falls back to the id. */
  labels: Readonly<Record<string, string>>
  /** The absent endpoints — one entry, or two when neither end is drawn. */
  absences: readonly ColumnAbsence[]
}

/**
 * The proposed ties on one section, oldest first, with both ends resolved.
 *
 * Filters to ``user_approved === false`` because those are precisely what the
 * chip counts, and to the open section because that is the scope the count is
 * phrased in (owner ruling 2026-08-15 — every packing step follows the open
 * section).
 *
 * The order is by ``created_at`` then id, NOT by the response array: a second
 * press must land on a different tie than the first, and a refetch between the
 * two presses reorders the array freely.
 *
 * An edge whose band row is missing from ``layers`` is DROPPED rather than
 * half-described — a tie the press cannot name is a tie it cannot explain, and
 * showing "pending: ↔ (unknown)" would be worse than the silence it replaces.
 *
 * Parameters
 * ----------
 * edges : readonly LithoContactCorrelationEdge[]
 *     The geotech packing edges the canvas holds for the active model.
 * layers : readonly LithoLayerResponse[]
 *     The geotech band rows both endpoints are anchored on.
 * sectionId : string | null
 *     The open section; ``null`` yields an empty list.
 *
 * Returns
 * -------
 * PendingTie[]
 *     Pending ties on that section, in a stable visit order.
 */
export function sectionPendingTies(
  edges: readonly LithoContactCorrelationEdge[],
  layers: readonly LithoLayerResponse[],
  sectionId: string | null,
): PendingTie[] {
  if (sectionId === null) return []
  const byId = new Map(layers.map(l => [l.id, l]))
  const out: PendingTie[] = []
  for (const edge of edges) {
    if (edge.user_approved) continue
    if (edge.section_id !== sectionId) continue
    const a = endpointOf(byId.get(edge.layer_a_id))
    const b = endpointOf(byId.get(edge.layer_b_id))
    if (a === null || b === null) continue
    out.push({ edgeId: edge.id, createdAt: edge.created_at, a, b })
  }
  out.sort((l, r) => l.createdAt.localeCompare(r.createdAt) || l.edgeId.localeCompare(r.edgeId))
  return out
}

/** Resolve one band row into a tie endpoint, or ``null`` when it is unusable. */
function endpointOf(layer: LithoLayerResponse | undefined): PendingTieEndpoint | null {
  if (!layer) return null
  // Anchor XOR on ``LithoLayerResponse``: exactly one of the two is set.
  const investigationId = layer.cpt_id ?? layer.borehole_id
  if (investigationId === null || investigationId === undefined) return null
  return {
    layerId: layer.id,
    investigationId,
    kind: layer.cpt_id === null ? 'borehole' : 'cpt',
    depthTopM: layer.depth_top_m,
    depthBaseM: layer.depth_base_m,
  }
}

/**
 * The first gate that dropped this column, in the order the render path fires.
 *
 * Order matters more than completeness here. A test hidden from the project is
 * also, trivially, "not projected onto the section" — every later check reads
 * off a list the earlier gate already removed it from. Reporting the last
 * failing gate would send the engineer to widen a corridor that is fine.
 *
 * Parameters
 * ----------
 * inputs : ColumnAbsenceInputs
 *     One reading of every gate for one investigation.
 *
 * Returns
 * -------
 * ColumnAbsenceCode
 *     The gate to report, or ``'unknown'`` when all of them are open.
 */
export function columnAbsenceCode(inputs: ColumnAbsenceInputs): ColumnAbsenceCode {
  if (!inputs.knownToProject) return 'unknown-investigation'
  if (inputs.hiddenFromProject) return 'hidden-from-project'
  if (!inputs.visibleInProject) return 'not-in-project-file'
  if (inputs.excludedFromModel) return 'excluded-from-model'
  if (inputs.excludedFromSection) return 'excluded-from-section'
  if (!inputs.projectsOntoSection) return 'outside-corridor'
  if (inputs.columnFocusOn) return 'column-focus'
  return 'unknown'
}

/**
 * The clause that says what to do about an absent column.
 *
 * Each one names the control that undoes the gate, so the sentence ends in an
 * action rather than a diagnosis.
 *
 * @param code Gate from {@link columnAbsenceCode}.
 * @returns A lowercase clause, ready to follow "…is not drawn here: ".
 */
export function columnAbsenceClause(code: ColumnAbsenceCode): string {
  switch (code) {
    case 'unknown-investigation':
      return 'this project no longer lists that investigation, so nothing can be drawn for it'
    case 'not-in-project-file':
      return 'it is not part of the project file you opened; it was imported in an earlier session that was never saved, so import it again or open the file that has it'
    case 'hidden-from-project':
      return 'it was removed from this project view; restore it in the Data stage (Restore items removed from this project)'
    case 'excluded-from-model':
      return 'the active model excludes it; tick it again under “Boreholes in model”'
    case 'excluded-from-section':
      return 'this cross-section excludes it'
    case 'outside-corridor':
      return 'it falls outside this section’s projection corridor; widen the buffer or move the section line'
    case 'column-focus':
      return 'column focus is on, so only the focused column is drawn; press Esc to leave focus'
    case 'unknown':
      return 'the section view is not drawing that column, and no display setting explains it'
  }
}

/** ``18.29–18.52 m`` — both depths at a fixed precision, so they line up. */
function depthSpan(endpoint: PendingTieEndpoint): string {
  const top = endpoint.depthTopM.toFixed(PENDING_TIE_DEPTH_DECIMALS)
  const base = endpoint.depthBaseM.toFixed(PENDING_TIE_DEPTH_DECIMALS)
  return `${top}–${base} m`
}

/**
 * The sentence a press shows when the pending tie cannot be drawn.
 *
 * It names BOTH ends with their depths first — that is the tie the count was
 * about, and the engineer needs to recognise it — then names the absent end
 * AGAIN beside its reason, because a pair of names alone does not say which of
 * the two is the problem.
 *
 * Parameters
 * ----------
 * description : UndrawableTieDescription
 *     The tie, the display names, and the gate that fired per absent endpoint.
 *
 * Returns
 * -------
 * string
 *     One sentence, English, safe to hand straight to ``toast``.
 */
export function describeUndrawableTie(description: UndrawableTieDescription): string {
  const { tie, labels, absences } = description
  const name = (id: string): string => labels[id] ?? id
  const head =
    `Pending tie: ${name(tie.a.investigationId)} ${depthSpan(tie.a)} ` +
    `${TIE_ENDPOINT_SEPARATOR} ${name(tie.b.investigationId)} ${depthSpan(tie.b)}`
  if (absences.length === 0) {
    return `${head}. It is not drawn on this view.`
  }
  const reasons = absences
    .map(a => `${name(a.investigationId)} is not drawn here: ${columnAbsenceClause(a.code)}`)
    .join('; ')
  return `${head}. ${reasons}.`
}
