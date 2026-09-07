// The litho-axis Suggest / Accept verbs' state + derivations.
//
// Extracted verbatim from ``SectionsToolbar`` (debt #201). Owns the focused-
// anchor derivation, the ghost-suggestion counts, the bulk anchor list and the
// three busy flags (accept-all, accept-all-bulk, bulk-confirm) plus the five
// async handlers behind the Suggest split-button. Bodies are byte-identical to
// the inline originals; only the surrounding declaration moved. suggestPrimaryMode
// stays in the toolbar because it also gates the split-button label there — it
// reads ``canSuggest`` + ``bulkAnchors`` out of this hook.

import { useMemo, useState } from 'react'

import { investigationsOnSection } from '../../../utils/sectionProjection'
import { filterAnchorsWithNoLithoContacts } from '../../../utils/newTestFilter'
import type {
  GeologicalModelResponse,
  CrossSectionResponse,
  CptListItem,
  BoreholeListItem,
} from '../../../api/client'
import type { FocusTarget } from '../../../components/sections/useFocusColumn'
import type { UseGeologicalModelResult } from '../../../hooks/useGeologicalModel'
import type { UseSectionsResult } from '../../../hooks/useSections'
import type { SectionSuggestAnchor } from './sectionsLithoMenuItems'

/** What the litho Suggest / Accept verbs need from the shell bus. */
export interface UseLithoSuggestVerbsDeps {
  isLitho: boolean
  hasSection: boolean
  activeLithoModel: GeologicalModelResponse | null
  sectionFocusedColumn: FocusTarget | null
  selectedId: string | null
  selectedBoreholeId: string | null
  focusedSuggestAnchorId: UseGeologicalModelResult['focusedSuggestAnchorId']
  ghostsByAnchor: UseGeologicalModelResult['ghostsByAnchor']
  lithoSuggesting: boolean
  lithoContacts: UseGeologicalModelResult['lithoContacts']
  handleSuggestLitho: UseGeologicalModelResult['handleSuggestLitho']
  handleAcceptAllLithoSuggestions: UseGeologicalModelResult['handleAcceptAllLithoSuggestions']
  handleSuggestAllLitho: UseGeologicalModelResult['handleSuggestAllLitho']
  handleAcceptAllBulkLitho: UseGeologicalModelResult['handleAcceptAllBulkLitho']
  selectedSectionId: string | null
  applyUpdatedSection: UseSectionsResult['applyUpdatedSection']
  selectedSection: CrossSectionResponse | null
  visibleCpts: CptListItem[]
  visibleBoreholes: BoreholeListItem[]
}

/** The Suggest / Accept read-outs + handlers the toolbar renders from. */
export interface UseLithoSuggestVerbsResult {
  canSuggest: boolean
  hasSuggestions: boolean
  bulkAnchorCount: number
  cptGhostCount: number
  boreholeGhostCount: number
  acceptingAll: boolean
  acceptingAllBulk: boolean
  bulkConfirmOpen: boolean
  setBulkConfirmOpen: (open: boolean) => void
  bulkAnchors: SectionSuggestAnchor[]
  newTestAnchors: SectionSuggestAnchor[]
  handleSuggest: () => Promise<void>
  handleAcceptAll: () => Promise<void>
  handleBulkSuggestConfirm: () => Promise<void>
  handleSuggestNewTests: () => Promise<void>
  handleAcceptAllBulk: () => Promise<void>
}

/**
 * Own the litho Suggest / Accept verb state + derivations.
 *
 * Parameters
 * ----------
 * deps : UseLithoSuggestVerbsDeps
 *     The shell state + handlers the verbs read.
 *
 * Returns
 * -------
 * UseLithoSuggestVerbsResult
 *     The derived enable flags, counts, anchor lists and async handlers.
 */
export function useLithoSuggestVerbs(deps: UseLithoSuggestVerbsDeps): UseLithoSuggestVerbsResult {
  const {
    isLitho,
    hasSection,
    activeLithoModel,
    sectionFocusedColumn,
    selectedId,
    selectedBoreholeId,
    focusedSuggestAnchorId,
    ghostsByAnchor,
    lithoSuggesting,
    lithoContacts,
    handleSuggestLitho,
    handleAcceptAllLithoSuggestions,
    handleSuggestAllLitho,
    handleAcceptAllBulkLitho,
    selectedSectionId,
    applyUpdatedSection,
    selectedSection,
    visibleCpts,
    visibleBoreholes,
  } = deps

  const [acceptingAll, setAcceptingAll] = useState(false)
  const [acceptingAllBulk, setAcceptingAllBulk] = useState(false)
  // Bulk-suggest (debt #73 / Phase 3) — confirmation modal open state.
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)

  // Suggest litho — fetches Robertson-2015/borehole segmenter suggestions
  // for the focused column in the active section. On the litho axis the
  // source is the section-local focused column (right-click → Focus in the
  // section canvas), NOT the global coordinator selection which is only set
  // by map/data-stage clicks. This is the workflow: right-click a column in
  // the section to focus it, then click "Suggest litho" in the toolbar.
  const focusedAnchorKind: 'cpt' | 'borehole' | null = isLitho
    ? (sectionFocusedColumn?.kind ?? null)
    : selectedId
      ? 'cpt'
      : selectedBoreholeId
        ? 'borehole'
        : null
  const focusedAnchorId: string | null = isLitho
    ? (sectionFocusedColumn?.id ?? null)
    : (selectedId ?? selectedBoreholeId ?? null)
  const canSuggest = isLitho && activeLithoModel !== null && hasSection && focusedAnchorId !== null
  // Phase 2 of debt #77: derive "has focused suggestions" from the
  // unified Map. True when a focused anchor is set AND its entry has
  // at least one suggestion (segmenter returned ≥1 layer).
  const hasSuggestions =
    focusedSuggestAnchorId !== null &&
    (ghostsByAnchor.get(focusedSuggestAnchorId)?.suggestions.length ?? 0) > 0
  // Bulk anchor count = Map size minus the focused entry. Drives the
  // "Accept all (N bulk)" button's enable state + label.
  const bulkAnchorCount =
    ghostsByAnchor.size -
    (focusedSuggestAnchorId !== null && ghostsByAnchor.has(focusedSuggestAnchorId)
      ? 1
      : 0)

  // Ghost-suggestion counts by anchor kind — drive the Admixtures
  // dropdown's per-scope enable state (dogfeed 2026-05-22).
  const cptGhostCount = useMemo(
    () =>
      Array.from(ghostsByAnchor.values()).filter(
        g => g.kind === 'cpt' && g.suggestions.length > 0,
      ).length,
    [ghostsByAnchor],
  )
  const boreholeGhostCount = useMemo(
    () =>
      Array.from(ghostsByAnchor.values()).filter(
        g => g.kind === 'borehole' && g.suggestions.length > 0,
      ).length,
    [ghostsByAnchor],
  )

  async function handleSuggest(): Promise<void> {
    if (!canSuggest || lithoSuggesting || !focusedAnchorKind || !focusedAnchorId) return
    await handleSuggestLitho(focusedAnchorKind, focusedAnchorId)
  }

  // Accept all non-rejected litho suggestion layers in one bulk call.
  // Threads the section id + applyUpdatedSection so the explicit-content
  // filter includes the seeded contacts immediately (#57 invariant).
  async function handleAcceptAll(): Promise<void> {
    if (!hasSuggestions || acceptingAll) return
    setAcceptingAll(true)
    try {
      await handleAcceptAllLithoSuggestions(
        selectedSectionId ?? null,
        applyUpdatedSection,
      )
    } finally {
      setAcceptingAll(false)
    }
  }

  // Bulk-suggest (debt #73 / Phase 3) — derive the anchors list from
  // investigations that ACTUALLY land on this section (within its
  // span + projection_buffer_m), minus the section's exclusion sets.
  // Skips anchors with no elevation (the ghost overlay needs surface Z
  // to position layers). On click the confirmation dialog has already
  // fired; this kicks off the fan-out.
  //
  // Bug history: earlier this iterated all visible project CPTs +
  // boreholes filtered only by the exclusion sets, so a section with
  // 8 in-corridor tests reported "will run for 68 investigations" —
  // the project's full count, not the section's. Route through
  // ``investigationsOnSection`` the same way SectionOverlays and
  // useSectionData do.
  const bulkAnchorsInCorridor = useMemo(() => {
    if (!selectedSection) return [] as {
      kind: 'cpt' | 'borehole'
      id: string
      surfaceElevationM: number | null
    }[]
    const excludedCptIds = new Set(selectedSection.excluded_cpt_ids ?? [])
    const excludedBhIds = new Set(selectedSection.excluded_borehole_ids ?? [])
    const out: {
      kind: 'cpt' | 'borehole'
      id: string
      surfaceElevationM: number | null
    }[] = []
    for (const p of investigationsOnSection(selectedSection, visibleCpts, excludedCptIds)) {
      if (p.item.elevation_m == null) continue
      out.push({ kind: 'cpt', id: p.item.id, surfaceElevationM: p.item.elevation_m })
    }
    for (const p of investigationsOnSection(selectedSection, visibleBoreholes, excludedBhIds)) {
      if (p.item.elevation_m == null) continue
      out.push({ kind: 'borehole', id: p.item.id, surfaceElevationM: p.item.elevation_m })
    }
    return out
  }, [selectedSection, visibleCpts, visibleBoreholes])

  // Owner ruling 2026-09-07: "Suggest all" skips every column that already
  // carries accepted litho layers (on ANY section). So the count the user sees
  // (and the disable gate + confirm dialog) is the ELIGIBLE set — the columns a
  // run would actually segment. The full in-corridor set is kept above so the
  // handler can report how many it skipped for that reason. Model-wide via
  // lithoContacts (every committed layer in the model, section-independent).
  const bulkAnchors = useMemo(
    () => filterAnchorsWithNoLithoContacts(bulkAnchorsInCorridor, lithoContacts),
    [bulkAnchorsInCorridor, lithoContacts],
  )

  async function handleBulkSuggestConfirm(): Promise<void> {
    setBulkConfirmOpen(false)
    if (bulkAnchors.length === 0) return
    // Pass the FULL in-corridor set: the handler re-derives eligible and reports
    // how many columns it skipped for already carrying accepted layers, so the
    // toast explains the reduced count the user saw on the toolbar.
    await handleSuggestAllLitho(bulkAnchorsInCorridor)
  }

  // Debt #92: "Suggest for new tests" — same fan-out as "Suggest all"
  // but scoped to anchors that have ZERO contacts in the active litho
  // model. Lets the engineer add new investigations to an already-
  // accepted project without re-running the segmenter on every
  // already-handled CPT/borehole.
  const newTestAnchors = useMemo(() => {
    if (!activeLithoModel) return [] as typeof bulkAnchors
    return filterAnchorsWithNoLithoContacts(bulkAnchorsInCorridor, lithoContacts)
  }, [bulkAnchorsInCorridor, lithoContacts, activeLithoModel])

  async function handleSuggestNewTests(): Promise<void> {
    // Defensive guard — button is disabled at zero count (per ux-review
    // recommendation 2026-05-21: disabled+tooltip beats stay-and-toast
    // because the user sees the empty state at a glance, not after a
    // wasted click).
    if (newTestAnchors.length === 0) return
    await handleSuggestAllLitho(newTestAnchors)
  }

  async function handleAcceptAllBulk(): Promise<void> {
    if (bulkAnchorCount === 0 || acceptingAllBulk) return
    setAcceptingAllBulk(true)
    try {
      await handleAcceptAllBulkLitho(
        selectedSectionId ?? null,
        applyUpdatedSection,
      )
    } finally {
      setAcceptingAllBulk(false)
    }
  }

  return {
    canSuggest,
    hasSuggestions,
    bulkAnchorCount,
    cptGhostCount,
    boreholeGhostCount,
    acceptingAll,
    acceptingAllBulk,
    bulkConfirmOpen,
    setBulkConfirmOpen,
    bulkAnchors,
    newTestAnchors,
    handleSuggest,
    handleAcceptAll,
    handleBulkSuggestConfirm,
    handleSuggestNewTests,
    handleAcceptAllBulk,
  }
}
