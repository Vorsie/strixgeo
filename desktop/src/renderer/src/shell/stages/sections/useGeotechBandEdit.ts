/**
 * Hand split / merge of packing sub-bands on the geotech axis — preview, then commit.
 *
 * Owns the two-step the owner's rulings force (docs/debt.md #227, 2026-08-01). Ruling 6
 * says the consequence must be stated before the edit lands; ruling 5 says the consequence
 * must never stop it. So a gesture never writes directly: it previews, the sheet says which
 * way the representative qc moves and what class results, and the commit only goes out if
 * the owner asks for it a second time — at which point nothing in here can refuse.
 *
 * Ruling 4 ("recalculation is local") is enforced server-side, by the column-scoped query
 * behind these endpoints. It shows up here only as a shape: one call, one band, no sweep.
 *
 * Ruling 2 is the one refusal that is correct rather than a defect. A depth outside the
 * band's own litho body comes back 422 and is surfaced VERBATIM — the server's message names
 * which wall was hit and which axis to fix it on, and paraphrasing would lose that.
 *
 * Separate from ``useGeotechPackingCorrelation`` on purpose: editing and correlating stay
 * separate on this axis exactly as they do on litho (ruling 4). This hook never creates or
 * deletes a correlation itself — the server drops the ties whose partner no longer matches
 * the re-derived class, and this hook only reports how many went.
 */
import { useCallback, useState } from 'react'

import { api } from '../../../api/client'
import type {
  GeologicalModelResponse,
  GeotechBandEditPlanResponse,
  GeotechBandEditResponse,
} from '../../../api/client'
import { markBoreholesStale } from '../../../utils/boreholesStaleStore'
import { log } from '../../../utils/log'

/** The edit being previewed, kept so the commit repeats it exactly. */
type PendingEdit =
  | { kind: 'split'; bandId: string; depthM: number }
  | { kind: 'merge'; upperBandId: string; lowerBandId: string }

/** Everything the handlers consume from the SectionsCanvas scope. */
export interface UseGeotechBandEditDeps {
  /** Active geotechnical model; null until "Subdivide all bodies" has run. */
  activeGeotechModel: GeologicalModelResponse | null
  /** Current project id. */
  projectId: string
  /** Ask the shell to refetch geotech layers — the edited column's new band stack. */
  requestGeotechLayersRefetch: () => void
  /** Refetch the geotech packing edge list, since a re-derived class can drop ties. */
  refetchGeotechPackingEdges: () => Promise<void>
  /** Mark the project dirty (two-stage save model). */
  markMutated: () => void
  /** Toast stack action. */
  toast: (type: 'success' | 'error' | 'warning', message: string) => void
}

/** The preview lifecycle plus the two request handlers. */
export interface UseGeotechBandEditResult {
  /** Preview splitting a band at a depth. Undefined when there is no geotech model. */
  onRequestSplitBand?: (bandId: string, depthM: number) => void
  /** Preview merging two adjacent bands. Undefined when there is no geotech model. */
  onRequestMergeBands?: (upperBandId: string, lowerBandId: string) => void
  /** What the pending edit would do; null when no sheet is open. */
  plan: GeotechBandEditPlanResponse | null
  /** True while a preview or a commit is in flight. */
  busy: boolean
  /** Commit the previewed edit. Never refuses on qc grounds — that is ruling 5. */
  confirm: () => Promise<void>
  /** Dismiss the sheet without writing. */
  cancel: () => void
}

/**
 * Wire the packing-band hand edits to their endpoints.
 *
 * Parameters
 * ----------
 * deps : UseGeotechBandEditDeps
 *     Shell state and actions the handlers close over.
 *
 * Returns
 * -------
 * UseGeotechBandEditResult
 *     The request handlers, the pending plan, and the confirm / cancel pair.
 */
export function useGeotechBandEdit(deps: UseGeotechBandEditDeps): UseGeotechBandEditResult {
  const {
    activeGeotechModel,
    projectId,
    requestGeotechLayersRefetch,
    refetchGeotechPackingEdges,
    markMutated,
    toast,
  } = deps

  const [pending, setPending] = useState<PendingEdit | null>(null)
  const [plan, setPlan] = useState<GeotechBandEditPlanResponse | null>(null)
  const [busy, setBusy] = useState(false)

  const modelId = activeGeotechModel?.id ?? null

  /** Report a failed call using the server's own words when it gave any. */
  const reportFailure = useCallback(
    (err: unknown, fallback: string): void => {
      // ``post()`` throws ``new Error(detail.detail)`` for non-2xx, so on a 422 the message
      // IS the domain message — the one that names the wall and the axis to fix it on.
      const message = err instanceof Error ? err.message : fallback
      toast('error', message)
    },
    [toast],
  )

  const onRequestSplitBand = useCallback(
    (bandId: string, depthM: number): void => {
      if (modelId === null) return
      log.info('section', `band-split preview: band=${bandId} depth=${depthM.toFixed(3)} m`)
      setBusy(true)
      void api.geology
        .previewSplitGeotechBand(projectId, modelId, bandId, depthM)
        .then(result => {
          setPlan(result)
          setPending({ kind: 'split', bandId, depthM })
        })
        .catch((err: unknown) => {
          log.warn('section', 'band-split preview failed', err)
          reportFailure(err, 'Could not work out what that split would do — try again.')
        })
        .finally(() => setBusy(false))
    },
    [modelId, projectId, reportFailure],
  )

  const onRequestMergeBands = useCallback(
    (upperBandId: string, lowerBandId: string): void => {
      if (modelId === null) return
      log.info('section', `band-merge preview: upper=${upperBandId} lower=${lowerBandId}`)
      setBusy(true)
      void api.geology
        .previewMergeGeotechBands(projectId, modelId, upperBandId, lowerBandId)
        .then(result => {
          setPlan(result)
          setPending({ kind: 'merge', upperBandId, lowerBandId })
        })
        .catch((err: unknown) => {
          log.warn('section', 'band-merge preview failed', err)
          reportFailure(err, 'Could not work out what that merge would do — try again.')
        })
        .finally(() => setBusy(false))
    },
    [modelId, projectId, reportFailure],
  )

  const cancel = useCallback((): void => {
    setPlan(null)
    setPending(null)
  }, [])

  const confirm = useCallback(async (): Promise<void> => {
    if (modelId === null || pending === null) return
    setBusy(true)
    try {
      const result: GeotechBandEditResponse =
        pending.kind === 'split'
          ? await api.geology.splitGeotechBand(projectId, modelId, pending.bandId, pending.depthM)
          : await api.geology.mergeGeotechBands(
              projectId,
              modelId,
              pending.upperBandId,
              pending.lowerBandId,
            )
      setPlan(null)
      setPending(null)
      requestGeotechLayersRefetch()
      await refetchGeotechPackingEdges()
      markMutated()
      // The band stack changed on this column, so the TIN-divided borehole bands derived
      // from it are out of date — amber the "Divide boreholes" button, as every other
      // geotech write path does.
      markBoreholesStale()
      // Name the correlation loss. It is the one consequence the preview cannot state up
      // front, because which ties survive depends on the class that comes out of the commit.
      const dropped = result.deleted_edge_ids.length
      toast(
        'success',
        dropped === 0
          ? pending.kind === 'split'
            ? 'Band split; both halves re-classified.'
            : 'Bands merged; the merged band re-classified.'
          : `${pending.kind === 'split' ? 'Band split' : 'Bands merged'}; ${dropped} packing ` +
            `correlation${dropped === 1 ? '' : 's'} no longer matched and ${dropped === 1 ? 'was' : 'were'} removed.`,
      )
      log.success(
        'section',
        `band-${pending.kind} committed on column ${result.investigation_id}: ` +
          `+${result.created_layer_ids.length} rows, -${result.deleted_layer_ids.length} rows, ` +
          `-${dropped} edges`,
      )
    } catch (err) {
      log.warn('section', `band-${pending.kind} commit failed`, err)
      reportFailure(err, 'Could not apply the edit — try again.')
    } finally {
      setBusy(false)
    }
  }, [
    modelId,
    pending,
    projectId,
    requestGeotechLayersRefetch,
    refetchGeotechPackingEdges,
    markMutated,
    toast,
    reportFailure,
  ])

  return {
    onRequestSplitBand: modelId === null ? undefined : onRequestSplitBand,
    onRequestMergeBands: modelId === null ? undefined : onRequestMergeBands,
    plan,
    busy,
    confirm,
    cancel,
  }
}
