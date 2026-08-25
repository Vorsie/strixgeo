/**
 * Make the geotech "N pending here" chip answer its own count.
 *
 * Owner dogfeed 2026-08-25: *"now i get a one pending notification but i don't
 * see any pending ties? Why don't we make that clickable so it highlights the
 * tie?"*
 *
 * The count is per SECTION and the canvas draws per RENDERED COLUMN, so a tie
 * whose endpoint column is not drawn counts and renders nothing — the exact
 * state the owner was looking at. A press therefore has two jobs, and this hook
 * owns the split:
 *
 * * **Whether** the tie can be drawn is the section panel's call — it owns
 *   ``visibleColumns`` and the pan. The hook asks it through
 *   {@link SectionColumnRevealFn} and never resolves a position itself.
 * * **Why** it cannot is the shell's call — only the shell can see the
 *   project-level manifest and removed-set gates, which never reach the panel.
 *
 * Because the two answer different questions they cannot disagree, which is the
 * failure mode this split exists to prevent (see
 * ``components/sections/sectionColumnReveal.ts``).
 *
 * Lives outside ``SectionsCanvas`` / ``SectionsToolbar``, both of which are long
 * past the 500-line god-component threshold (debt #201).
 */
import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'

import type {
  LithoContactCorrelationEdge,
  LithoLayerResponse,
} from '../../../api/clients/geology.types'
import type { SectionColumnRevealFn } from '../../../components/sections/sectionColumnReveal'
import { nextVisitIndex } from '../../../components/sections/tieVisitNav'
import {
  columnAbsenceCode,
  describeUndrawableTie,
  sectionPendingTies,
  type ColumnAbsence,
  type PendingTie,
} from '../../../utils/pendingTieReveal'
import { investigationsOnSection } from '../../../utils/sectionProjection'
import { sectionsRevealPendingTieCallback } from './pendingTieRevealBridge'

/** The minimum an investigation must carry to be projected and named. */
export interface RevealInvestigation {
  id: string
  name: string
  location_x: number
  location_y: number
}

/** The section geometry the corridor check reads. */
export interface RevealSection {
  start_x: number
  start_y: number
  end_x: number
  end_y: number
  projection_buffer_m: number
  excluded_cpt_ids: readonly string[]
  excluded_borehole_ids: readonly string[]
}

/** What the press needs in order to walk, reveal and explain. */
export interface GeotechPendingTieRevealArgs {
  /** The open section; ``null`` disables the press. */
  sectionId: string | null
  /** The open section row, for the corridor and per-section exclusions. */
  section: RevealSection | null
  /** Geotech packing correlation edges for the active geotech model. */
  edges: readonly LithoContactCorrelationEdge[]
  /** Geotech band rows — how an edge endpoint resolves to an investigation. */
  geotechLayers: readonly LithoLayerResponse[]
  /** The active axis model's ``excluded_borehole_ids``. */
  excludedFromModelIds: readonly string[]
  /** Every CPT the project knows, filtered or not. */
  projectCpts: readonly RevealInvestigation[]
  /** Every borehole the project knows, filtered or not. */
  projectBoreholes: readonly RevealInvestigation[]
  /** CPT ids that survive the manifest + removed-set filter. */
  visibleCptIds: readonly string[]
  /** Borehole ids that survive the manifest + removed-set filter. */
  visibleBoreholeIds: readonly string[]
  /** Project-local hide set for CPTs. */
  removedCptIds: ReadonlySet<string>
  /** Project-local hide set for boreholes. */
  removedBoreholeIds: ReadonlySet<string>
  /** Column focus is active, so the section draws one column only. */
  columnFocusOn: boolean
  /**
   * The section panel's reveal implementation, published upward by
   * ``SectionPanel``. ``null`` while no panel is mounted.
   */
  revealRef: MutableRefObject<SectionColumnRevealFn | null>
}

/** What one press did. */
export type PendingTieRevealOutcome =
  /** Centred and flashed. */
  | { kind: 'revealed'; edgeId: string }
  /** Found, but at least one end is not on screen — ``message`` says which and why. */
  | { kind: 'undrawable'; edgeId: string; message: string }
  /** Nothing is pending on the open section. */
  | { kind: 'none' }
  /** No section panel is mounted, so nothing could be asked. */
  | { kind: 'unavailable' }

/**
 * Wire the pending-tie chip's press, and publish it to the toolbar.
 *
 * The visit index is a REF, not state: the pan and the flash happen inside the
 * panel, so advancing must not re-render the canvas.
 *
 * Parameters
 * ----------
 * args : GeotechPendingTieRevealArgs
 *     Section scope, the tie inputs, every column-visibility gate, and the
 *     panel's reveal implementation.
 *
 * Returns
 * -------
 * () => PendingTieRevealOutcome
 *     The press. Also registered on the module bridge for the toolbar, which
 *     is a sibling zone component with no shared parent below the shell.
 */
export function useGeotechPendingTieReveal(
  args: GeotechPendingTieRevealArgs,
): () => PendingTieRevealOutcome {
  const visitRef = useRef<number | null>(null)
  // Read through a ref so the press identity does not change on every pan,
  // pointer move or refetch — the bridge registration below would otherwise
  // re-run constantly, and a stale registration is worse than a stable one.
  const inputsRef = useRef(args)
  inputsRef.current = args

  const press = useCallback((): PendingTieRevealOutcome => {
    const current = inputsRef.current
    const ties = sectionPendingTies(
      current.edges,
      current.geotechLayers,
      current.sectionId,
    )
    const index = nextVisitIndex(visitRef.current, ties.length)
    if (index === null) {
      visitRef.current = null
      return { kind: 'none' }
    }
    visitRef.current = index
    const tie = ties[index]
    const reveal = current.revealRef.current
    if (reveal === null) return { kind: 'unavailable' }
    const result = reveal({
      investigationIds: [tie.a.investigationId, tie.b.investigationId],
      flashEdgeId: tie.edgeId,
    })
    if (result.revealed) return { kind: 'revealed', edgeId: tie.edgeId }
    return {
      kind: 'undrawable',
      edgeId: tie.edgeId,
      message: describeUndrawableTie({
        tie,
        labels: labelsFor(tie, current),
        absences: result.missingInvestigationIds.map(id => absenceFor(id, current)),
      }),
    }
    // reason: every input is read through ``inputsRef`` (assigned on each
    // render, above) so the press stays identity-stable across pans and
    // refetches; listing them here would defeat that on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    sectionsRevealPendingTieCallback.current = press
    return () => {
      sectionsRevealPendingTieCallback.current = null
    }
  }, [press])

  // Leaving a section restarts the walk at its first tie — carrying an index
  // from the previous section would skip ties here for no reason the engineer
  // can see.
  useEffect(() => {
    visitRef.current = null
  }, [args.sectionId])

  return press
}

/** ``investigation id → display name`` for both ends of one tie. */
function labelsFor(
  tie: PendingTie,
  args: GeotechPendingTieRevealArgs,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const end of [tie.a, tie.b]) {
    const pool = end.kind === 'cpt' ? args.projectCpts : args.projectBoreholes
    const hit = pool.find(i => i.id === end.investigationId)
    if (hit) out[end.investigationId] = hit.name
  }
  return out
}

/**
 * Read every visibility gate for one absent investigation.
 *
 * The corridor test runs through ``investigationsOnSection`` — the same
 * predicate the section view itself projects with — so the answer can never
 * drift from what the canvas actually did.
 */
function absenceFor(
  investigationId: string,
  args: GeotechPendingTieRevealArgs,
): ColumnAbsence {
  const asCpt = args.projectCpts.find(i => i.id === investigationId) ?? null
  const item = asCpt ?? args.projectBoreholes.find(i => i.id === investigationId) ?? null
  const isCpt = asCpt !== null
  const removed = isCpt ? args.removedCptIds : args.removedBoreholeIds
  const visibleIds = isCpt ? args.visibleCptIds : args.visibleBoreholeIds
  const sectionExcluded = args.section
    ? isCpt
      ? args.section.excluded_cpt_ids
      : args.section.excluded_borehole_ids
    : []
  const projects =
    item !== null &&
    args.section !== null &&
    investigationsOnSection(
      { ...args.section, projection_buffer_m: args.section.projection_buffer_m },
      [{ id: item.id, location_x: item.location_x, location_y: item.location_y }],
    ).length > 0
  return {
    investigationId,
    code: columnAbsenceCode({
      knownToProject: item !== null,
      hiddenFromProject: removed.has(investigationId),
      visibleInProject: visibleIds.includes(investigationId),
      // Boreholes only: the model's exclusion list has no CPT half.
      excludedFromModel: !isCpt && args.excludedFromModelIds.includes(investigationId),
      excludedFromSection: sectionExcluded.includes(investigationId),
      projectsOntoSection: projects,
      columnFocusOn: args.columnFocusOn,
    }),
  }
}
