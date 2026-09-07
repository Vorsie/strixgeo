// The geotech pipeline step-1 (subdivide CPTs) verbs + its re-subdivide dialog.
//
// Extracted verbatim from ``SectionsToolbar`` (debt #201). Owns the subdivide
// busy flag, the re-subdivide confirmation open state and the parked scope, plus
// the four functions behind "1 · Subdivide CPTs": the actual run, the press that
// confirms first when it would destroy work, and the two dialog resolvers.
// Bodies are byte-identical to the inline originals; the hook call sits after
// ``useGeotechTieStatus`` in the toolbar because ``runSubdivideAllBodies``
// refreshes the tie status.

import { useState } from 'react'

import type {
  GeologicalFormationResponse,
  GeologicalModelResponse,
  LithoLayerResponse,
} from '../../../api/client'
import type { UseGeologicalModelResult } from '../../../hooks/useGeologicalModel'
import type { GeotechStatistic } from '../../../utils/geotechStatistic'
import {
  useAdmixtureChoiceGate,
  type AdmixtureSelections,
} from '../../../hooks/useAdmixtureChoiceGate'
import type { AdmixtureUnit } from '../../../utils/admixtureNadChoice'
import type { NadAdmixtureChoice } from '../../../api/clients/geology.types'

/** What the subdivide verbs need from the shell bus + sibling derivations. */
export interface UseGeotechSubdivideVerbsDeps {
  activeLithoModel: GeologicalModelResponse | null
  geotechBandsStale: boolean
  pendingStatistic: GeotechStatistic | null
  columnsNeedingRederive: UseGeologicalModelResult['columnsNeedingRederive']
  handleSubdivideAllBodies: UseGeologicalModelResult['handleSubdivideAllBodies']
  refreshTieStatus: () => void
  subdivideScope: {
    bandCount: number
    handEditCount: number
    modelBandCount: number
    modelHandEditCount: number
  }
  // Admixture NAD-family gate (walk22b): the Subdivide press asks the same
  // question the Geotech-stage Build does, for a sand unit with a qualifying
  // admixture and no stored answer.
  formations: readonly GeologicalFormationResponse[] | undefined
  lithoLayers: readonly LithoLayerResponse[] | undefined
  handleSetNadAdmixtureChoices: UseGeologicalModelResult['handleSetNadAdmixtureChoices']
}

/** The subdivide busy flag, dialog open state + the verbs + the admixture gate. */
export interface UseGeotechSubdivideVerbsResult {
  subdividingBodies: boolean
  reSubdivideConfirmOpen: boolean
  pressSubdivide: (sectionId: string | null) => void
  handleReSubdivideCancel: () => void
  handleReSubdivideConfirm: () => void
  // ---- Admixture NAD-family prompt (walk22b) ----
  hasAmbiguousAdmixtureUnits: boolean
  askingAdmixtures: readonly AdmixtureUnit[] | null
  admixtureSelections: AdmixtureSelections
  admixtureBusy: boolean
  selectAdmixture: (formationId: string, choice: NadAdmixtureChoice) => void
  confirmAdmixtures: () => Promise<void>
  cancelAdmixtures: () => void
  openAdmixtureChoices: () => void
}

/**
 * Own the geotech subdivide (pipeline step 1) verbs + re-subdivide dialog.
 *
 * Parameters
 * ----------
 * deps : UseGeotechSubdivideVerbsDeps
 *     The active litho model, the two REBUILD-tag signals, the subdivide handler,
 *     the tie-status refresh and the scope the confirmation gates on.
 *
 * Returns
 * -------
 * UseGeotechSubdivideVerbsResult
 *     The busy flag, dialog open state and the press / cancel / confirm verbs.
 */
export function useGeotechSubdivideVerbs({
  activeLithoModel,
  geotechBandsStale,
  pendingStatistic,
  columnsNeedingRederive,
  handleSubdivideAllBodies,
  refreshTieStatus,
  subdivideScope,
  formations,
  lithoLayers,
  handleSetNadAdmixtureChoices,
}: UseGeotechSubdivideVerbsDeps): UseGeotechSubdivideVerbsResult {
  // The admixture NAD-family gate — the SAME one the Geotech-stage Build runs
  // (walk22b), so the two subdivide entry points cannot ask differently.
  const admixtureGate = useAdmixtureChoiceGate({
    formations,
    lithoLayers,
    handleSetNadAdmixtureChoices,
  })
  const [subdividingBodies, setSubdividingBodies] = useState(false)
  const [reSubdivideConfirmOpen, setReSubdivideConfirmOpen] = useState(false)
  // Which scope the pending re-subdivide will run with once the confirmation
  // dialog answers — the two menu items differ ONLY in this value, and the
  // dialog sits between the press and the run.
  const [pendingSubdivideSectionId, setPendingSubdivideSectionId] = useState<string | null>(null)

  // C1 (connecting-geotech-units §7) — run the actual subdivide. Extracted
  // from the button onClick so both the first-ever run and the confirmed
  // re-run share one code path.
  function runSubdivideAllBodies(sectionId: string | null): void {
    setSubdividingBodies(true)
    // Pipeline STEP 1 (owner ruling 2026-08-04): subdivide the CPTs into
    // packing bands and propose NOTHING. Auto-correlate is the engineer's next
    // press, so the machine's ties arrive as suggestions he reviews rather than
    // as accepted work he never sanctioned.
    // ``sectionId`` scopes it to the section on screen (owner ruling
    // 2026-08-15); null is the deliberate all-sections press.
    void handleSubdivideAllBodies({
      deriveEdges: false,
      // A STATISTIC re-run is MODEL-WIDE (owner 2026-08-18: "when you redivide
      // with another mean statistic all need to be rederived ofcourse"): the
      // stamp that clears the tag is model-level, so a scoped re-run would
      // clear it while the other sections still carry old-statistic bands —
      // and first-subdivision-wins would then freeze that discrepancy in. The
      // moved-contacts tag stays section-scoped: its stale columns are the
      // section on screen.
      sectionId: geotechBandsStale ? null : sectionId,
      // Only ever non-null before the first subdivide — the effect above drops
      // it once a model exists. The backend honours it on creation and ignores
      // it on a re-run, so a stale value cannot re-classify a built model.
      representativeStatistic: pendingStatistic,
      // First subdivision wins (owner ruling 2026-08-18): an already-banded
      // column is imported as-is, so pressing the step on a tie section never
      // tells a second story. The two REBUILD tags are the exception — when
      // the button itself announces a re-run (statistic change, moved
      // contacts), the press means rebuild and skipping would pin the tag on.
      rebuildExisting: geotechBandsStale || columnsNeedingRederive.length > 0,
    }).finally(() => {
      setSubdividingBodies(false)
      // A rebuild re-anchors accepted ties and can flag some of them, so the
      // counts step 4 gates on have moved even though nothing was proposed.
      void refreshTieStatus()
    })
  }

  /**
   * Press step 1, confirming first when it would destroy work on THIS section.
   *
   * The gate used to be "a geotech model exists", which since the verb became
   * section-scoped fired on a section holding nothing and read as a threat to
   * the section that did (owner, 2026-08-15: *"We do however get an overwrite
   * popup on cs2 while there is no subdivision there yet. Now it seems like it
   * is warning that i'll overwrite CS 1"*). The gate is now the bands the
   * press will actually rebuild: none, and it goes straight through. That
   * still covers the first-ever run, which has no bands anywhere. The chosen
   * scope is parked until the dialog answers.
   */
  // The subdivide itself, once any admixture answer is settled. Split out so the
  // admixture prompt can hand control back to exactly this point after saving —
  // the re-subdivide confirmation still stands in front of a destructive re-run.
  function proceedSubdivide(sectionId: string | null): void {
    // The statistic re-run clears MODEL-WIDE, so its confirmation gates on the
    // MODEL's bands — an open section without bands must not slip a model-wide
    // clear past the dialog (owner 2026-08-18).
    const bandsAtRisk = geotechBandsStale ? subdivideScope.modelBandCount : subdivideScope.bandCount
    if (bandsAtRisk > 0) {
      setPendingSubdivideSectionId(sectionId)
      setReSubdivideConfirmOpen(true)
      return
    }
    runSubdivideAllBodies(sectionId)
  }

  function pressSubdivide(sectionId: string | null): void {
    if (subdividingBodies || !activeLithoModel) return
    // FIRST gate (walk22b): a sand unit carrying an admixture the NAD table can
    // read two ways must be answered before the subdivide classifies it — the
    // same question the Geotech-stage Build asks. A fully-answered (or
    // admixture-free) model goes straight through to the re-subdivide gate.
    admixtureGate.runGated(() => proceedSubdivide(sectionId))
  }

  function handleReSubdivideCancel(): void {
    setReSubdivideConfirmOpen(false)
  }

  function handleReSubdivideConfirm(): void {
    setReSubdivideConfirmOpen(false)
    runSubdivideAllBodies(pendingSubdivideSectionId)
  }

  return {
    subdividingBodies,
    reSubdivideConfirmOpen,
    pressSubdivide,
    handleReSubdivideCancel,
    handleReSubdivideConfirm,
    hasAmbiguousAdmixtureUnits: admixtureGate.hasAmbiguousAdmixtureUnits,
    askingAdmixtures: admixtureGate.askingAdmixtures,
    admixtureSelections: admixtureGate.admixtureSelections,
    admixtureBusy: admixtureGate.admixtureBusy,
    selectAdmixture: admixtureGate.selectAdmixture,
    confirmAdmixtures: admixtureGate.confirmAdmixtures,
    cancelAdmixtures: admixtureGate.cancelAdmixtures,
    // Re-open the prompt to review / change answers; confirm re-subdivides.
    openAdmixtureChoices: () =>
      admixtureGate.openAdmixtureChoices(() => proceedSubdivide(null)),
  }
}
