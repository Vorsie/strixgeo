// The "Group" / "Ungroup" orchestration for the Parameters unit list (owner
// finding 2026-09-03). Holds the checkbox selection, derives the same-class
// guard, and fires the SAME body-union client the section-canvas Join uses —
// ``api.geology.createBodyUnion`` / ``deleteBodyUnion`` — plus the identical
// geotech refetch pair (``requestBodyRecompute('geotech')`` +
// ``requestGeotechLayersRefetch``) so the "(group N)" tag, the 2-D fill and the
// unit statistics all re-derive exactly as they do after a canvas Join/Un-join.
//
// A hook, not inline in ``UnitListPane``, so the pane stays under the 500-line
// cap (debt #201) and its own hook list stays flat above its early returns — this
// hook has no early return, so its internal hooks are unconditional.

import { useCallback, useMemo, useState } from 'react'

import { api } from '../../../api/client'
import type {
  BodyUnionListItem,
  GeologicalFormationResponse,
  LithoLayerResponse,
} from '../../../api/client'
import type { Translator } from '../../../i18n/translate'
import { log } from '../../../utils/log'
import { nadClassName } from '../../../utils/nadClasses'
import { joinErrorToastKey } from '../sections/joinErrorToastKey'
import {
  anchorLayersForBodies,
  bodyNadClassMap,
  groupGuardStatus,
  groupUnionPairs,
  selectedNadClasses,
  unionIdsAnchoringBody,
  type GroupGuardStatus,
} from './unitGrouping'

/** The toast signature (``useToasts``) — success/error, optional replace key. */
type ToastFn = (type: 'success' | 'error' | 'warning', message: string, replaceKey?: string) => void

/** Everything the grouping orchestration reads — all already held by the pane. */
export interface UseUnitGroupingArgs {
  /** Project scope, or ``null`` when nothing is open. */
  projectId: string | null
  /** The active geotech model (unions live on it), or ``null``. */
  geotechModelId: string | null
  /** Accepted-or-not geotech layers (for anchors + the class guard). */
  geotechLayers: readonly LithoLayerResponse[]
  /** Geotech formation rows (each band's ``nad_class``). */
  geotechFormations: readonly GeologicalFormationResponse[]
  /** The model's unions — read for the Ungroup delete set + grouped-membership. */
  bodyUnions: readonly BodyUnionListItem[]
  /** ``geotech body id → group number`` (the "(group N)" map the tree already builds). */
  groupByBodyId: ReadonlyMap<string, number>
  /** Bump the geotech recompute nonce — re-fetches unions + bodies (the tag). */
  requestBodyRecompute: (kind: 'litho' | 'geotech') => void
  /** Re-fetch the geotech bands with their new stamps (2-D fill + stats). */
  requestGeotechLayersRefetch: () => void
  /** Toast sink (``useShell().toasts.toast``). */
  toast: ToastFn
  /** Translator (``useT``). */
  t: Translator
}

/** The selection + actions the pane binds to the checkboxes and the bulk bar. */
export interface UseUnitGroupingResult {
  /** Is this geotech body currently checked? */
  isChecked: (bodyId: string) => boolean
  /** Toggle a geotech body's checkbox. */
  toggle: (bodyId: string) => void
  /** Clear the whole selection. */
  clear: () => void
  /** How many geotech bodies are checked. */
  count: number
  /** Whether/why the checked set can be grouped (drives the Group button). */
  guard: GroupGuardStatus
  /**
   * The distinct packing-class NAMES in the selection (English/Dutch per the
   * active language) — so the ``cross-class`` refusal hint names the offending
   * classes in words. Empty while the selection has no known class.
   */
  selectedClassNames: string[]
  /** True when at least one checked body is already in a group (drives Ungroup). */
  hasGroupedInSelection: boolean
  /** True while a group/ungroup round-trip is in flight (buttons disable). */
  busy: boolean
  /** Group the checked bodies into one group (no-op unless the guard is ``ok``). */
  group: () => void
  /** Remove every checked grouped body from its group. */
  ungroup: () => void
}

/**
 * Selection + Group/Ungroup orchestration for the Parameters unit list.
 *
 * Parameters
 * ----------
 * args
 *     {@link UseUnitGroupingArgs} — the pane's own state + action levers.
 *
 * Returns
 * -------
 * UseUnitGroupingResult
 *     The checkbox selection API and the two bulk actions.
 */
export function useUnitGrouping(args: UseUnitGroupingArgs): UseUnitGroupingResult {
  const {
    projectId,
    geotechModelId,
    geotechLayers,
    geotechFormations,
    bodyUnions,
    groupByBodyId,
    requestBodyRecompute,
    requestGeotechLayersRefetch,
    toast,
    t,
  } = args

  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const classByBody = useMemo(
    () => bodyNadClassMap(geotechLayers, geotechFormations),
    [geotechLayers, geotechFormations],
  )

  const checkedIds = useMemo(() => [...checked], [checked])
  const guard = useMemo(() => groupGuardStatus(checkedIds, classByBody), [checkedIds, classByBody])
  // The class NAMES in the selection, for the cross-class refusal hint —
  // translated at the presentation boundary (``nadClassName`` reads the active
  // language). Sorted ascending by class number (``selectedNadClasses``).
  const selectedClassNames = useMemo(
    () => selectedNadClasses(checkedIds, classByBody).map(nad => nadClassName(nad)),
    [checkedIds, classByBody],
  )
  const hasGroupedInSelection = useMemo(
    () => checkedIds.some(id => groupByBodyId.has(id)),
    [checkedIds, groupByBodyId],
  )

  const isChecked = useCallback((bodyId: string) => checked.has(bodyId), [checked])

  const toggle = useCallback((bodyId: string) => {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(bodyId)) next.delete(bodyId)
      else next.add(bodyId)
      return next
    })
  }, [])

  const clear = useCallback(() => setChecked(new Set()), [])

  // Group — reversible, so no confirm dialog (docs/ux.md); the success toast
  // names the undo path (Ungroup). Mirrors ``SectionsCanvas.handleJoinBodies``:
  // one union per pair, then the geotech refetch pair.
  const group = useCallback(() => {
    if (busy || projectId === null || geotechModelId === null) return
    if (groupGuardStatus(checkedIds, classByBody) !== 'ok') return
    const anchorByBody = anchorLayersForBodies(checkedIds, geotechLayers)
    const pairs = groupUnionPairs(checkedIds, anchorByBody)
    if (pairs.length === 0) return
    setBusy(true)
    void (async () => {
      try {
        for (const [layerA, layerB] of pairs) {
          await api.geology.createBodyUnion(projectId, geotechModelId, layerA, layerB)
        }
        requestBodyRecompute('geotech')
        requestGeotechLayersRefetch()
        toast('success', t('params.grouped'))
        setChecked(new Set())
      } catch (err) {
        // A 422 cross-class guard → the shared canvas copy (packing vs lithology);
        // anything else → the generic group-failed line.
        const key = joinErrorToastKey(err)
        toast('error', key === 'sections.join.failed' ? t('params.groupFailed') : t(key))
        log.warn('parameters', 'group: createBodyUnion failed', err)
      } finally {
        setBusy(false)
      }
    })()
  }, [
    busy,
    projectId,
    geotechModelId,
    checkedIds,
    classByBody,
    geotechLayers,
    requestBodyRecompute,
    requestGeotechLayersRefetch,
    toast,
    t,
  ])

  // Ungroup — lift every union anchoring each checked grouped body, then the same
  // geotech refetch pair (mirrors ``SectionsCanvas.handleUnjoinBody``).
  const ungroup = useCallback(() => {
    if (busy || projectId === null || geotechModelId === null) return
    const unionIds = new Set<string>()
    for (const bodyId of checkedIds) {
      for (const id of unionIdsAnchoringBody(bodyId, bodyUnions)) unionIds.add(id)
    }
    if (unionIds.size === 0) return
    setBusy(true)
    void (async () => {
      try {
        for (const unionId of unionIds) {
          await api.geology.deleteBodyUnion(projectId, geotechModelId, unionId)
        }
        requestBodyRecompute('geotech')
        requestGeotechLayersRefetch()
        toast('success', t('params.ungrouped'))
        setChecked(new Set())
      } catch (err) {
        toast('error', t('params.ungroupFailed'))
        log.warn('parameters', 'ungroup: deleteBodyUnion failed', err)
      } finally {
        setBusy(false)
      }
    })()
  }, [
    busy,
    projectId,
    geotechModelId,
    checkedIds,
    bodyUnions,
    requestBodyRecompute,
    requestGeotechLayersRefetch,
    toast,
    t,
  ])

  return {
    isChecked,
    toggle,
    clear,
    count: checked.size,
    guard,
    selectedClassNames,
    hasGroupedInSelection,
    busy,
    group,
    ungroup,
  }
}
