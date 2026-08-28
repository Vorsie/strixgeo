// The four caret / dropdown menus of the litho-axis toolbar verbs.
//
// Extracted verbatim from ``SectionsToolbar`` (debt #201) alongside
// ``sectionsLithoToolbarItems``. Each builder returns a ``ToolbarDropdownItem[]``
// for one menu; ``buildLithoToolbarItems`` folds them into the split-button
// overflow rows + dropdown ``items``. Splitting the menus out of the items
// builder keeps both files under the 500-line advisory. Pure functions — no
// hooks, bodies byte-identical to the inline originals.

import {
  Trash2,
  Sparkles,
  Eraser,
  Zap,
  CheckCheck,
  PaintBucket,
  Network,
  Eye,
  EyeOff,
} from 'lucide-react'

import type { ToolbarDropdownItem } from '../../ToolbarPrimitives'
import { toggleBandFill } from '../../../utils/bandFillStore'
import { toggleCorrelationOverlay } from '../../../utils/correlationOverlayStore'
import { toggleFormationFill } from '../../../utils/formationFillStore'
import { sampleDisplayMenuItems } from './sampleDisplayMenuItems'
import type { GeologicalModelResponse } from '../../../api/client'
import type { FocusTarget } from '../../../components/sections/useFocusColumn'
import type { UseGeologicalModelResult } from '../../../hooks/useGeologicalModel'
import type { UseSectionsResult } from '../../../hooks/useSections'

/** A bulk-suggest anchor (an in-corridor CPT / borehole with surface Z). */
export type SectionSuggestAnchor = {
  kind: 'cpt' | 'borehole'
  id: string
  surfaceElevationM: number | null
}

/**
 * Everything the litho-axis toolbar items + their menus read from
 * ``SectionsToolbar``. One interface for the whole litho block; each menu
 * builder uses only the subset it needs.
 */
export interface LithoToolbarItemsDeps {
  isLitho: boolean
  hasSection: boolean
  activeLithoModel: GeologicalModelResponse | null
  lithoSuggesting: boolean
  bulkLithoSuggesting: boolean
  suggestPrimaryMode: 'focused' | 'all' | 'disabled'
  bulkAnchors: SectionSuggestAnchor[]
  newTestAnchors: SectionSuggestAnchor[]
  bulkAnchorCount: number
  hasSuggestions: boolean
  acceptingAll: boolean
  acceptingAllBulk: boolean
  autoCorrelating: boolean
  acceptingCorrelations: boolean
  correlateMode: boolean
  sectionHasLithoContacts: boolean
  sectionFocusedColumn: FocusTarget | null
  bandsVisible: boolean
  correlationsVisible: boolean
  formationFillVisible: boolean
  resettingBoundaries: boolean
  sampleMarkersOn: boolean
  psdPreviewOn: boolean
  cptGhostCount: number
  boreholeGhostCount: number
  setBulkConfirmOpen: (open: boolean) => void
  setResetBoundariesConfirmOpen: (open: boolean) => void
  handleSuggest: () => Promise<void>
  handleSuggestNewTests: () => Promise<void>
  handleAcceptAll: () => Promise<void>
  handleAcceptAllBulk: () => Promise<void>
  handleAutoCorrelateWithCheck: () => Promise<void>
  handleAcceptCorrelations: () => Promise<void>
  clearLithoSuggestions: UseGeologicalModelResult['clearLithoSuggestions']
  clearBulkLithoGhosts: UseGeologicalModelResult['clearBulkLithoGhosts']
  handleClearSuggestions: UseGeologicalModelResult['handleClearSuggestions']
  handleStripLithoAdmixtures: UseGeologicalModelResult['handleStripLithoAdmixtures']
  handleReseedLithoAdmixtures: UseGeologicalModelResult['handleReseedLithoAdmixtures']
  enterCorrelateMode: UseSectionsResult['enterCorrelateMode']
  exitCorrelateMode: UseSectionsResult['exitCorrelateMode']
}

/** The Suggest split-button's caret menu (bulk variants). */
export function buildLithoSuggestMenuItems(deps: LithoToolbarItemsDeps): ToolbarDropdownItem[] {
  const {
    isLitho,
    bulkAnchors,
    setBulkConfirmOpen,
    activeLithoModel,
    hasSection,
    bulkLithoSuggesting,
    lithoSuggesting,
    newTestAnchors,
    handleSuggestNewTests,
  } = deps
  // Hoisted out of the JSX because a folded control hands its own menu to
  // the ⋯ More menu — the caret items ARE the overflow rows, so declaring
  // them once keeps the two in step by construction.
  // Built only on the litho axis: these initialisers read
  // axis-scoped state the other axes never populate.
  return !isLitho ? [] : [
    {
      label: `Suggest all in this section${
        bulkAnchors.length > 0 ? ` (${bulkAnchors.length})` : ''
      }`,
      icon: <Sparkles size={12} />,
      onClick: () => setBulkConfirmOpen(true),
      disabled: !activeLithoModel || !hasSection || bulkLithoSuggesting || lithoSuggesting,
      title: !activeLithoModel
        ? 'Create a lithostratigraphic model first'
        : !hasSection
          ? 'Open a cross-section first'
          : bulkLithoSuggesting
            ? 'Running segmenter on every investigation in this section…'
            : 'Suggest lithostratigraphic layers for every investigation in this section at once',
      testid: 'litho-suggest-all',
    },
    {
      label: activeLithoModel
        ? `Suggest for new tests (${newTestAnchors.length})`
        : 'Suggest for new tests',
      icon: <Sparkles size={12} />,
      onClick: () => void handleSuggestNewTests(),
      disabled:
        !activeLithoModel ||
        bulkLithoSuggesting ||
        lithoSuggesting ||
        newTestAnchors.length === 0,
      title: !activeLithoModel
        ? 'Create a lithostratigraphic model first'
        : bulkLithoSuggesting
          ? 'Running segmenter…'
          : newTestAnchors.length === 0
            ? 'All visible investigations already have litho contacts — import new tests to use this'
            : `Suggest layers for the ${newTestAnchors.length} investigation${newTestAnchors.length === 1 ? '' : 's'} with no litho contacts yet`,
      testid: 'litho-suggest-new-tests',
    },
  ]
}

/** The Correlate split-button's caret menu (auto / accept / clear). */
export function buildLithoCorrelateMenuItems(deps: LithoToolbarItemsDeps): ToolbarDropdownItem[] {
  const {
    isLitho,
    autoCorrelating,
    handleAutoCorrelateWithCheck,
    activeLithoModel,
    sectionHasLithoContacts,
    acceptingCorrelations,
    handleAcceptCorrelations,
    hasSection,
    handleClearSuggestions,
  } = deps
  // Built only on the litho axis: these initialisers read
  // axis-scoped state the other axes never populate.
  return !isLitho ? [] : [
    {
      icon: <Zap size={13} />,
      label: autoCorrelating ? 'Correlating…' : 'Auto-correlate',
      onClick: () => {
        void handleAutoCorrelateWithCheck()
      },
      disabled: !activeLithoModel || autoCorrelating || !sectionHasLithoContacts,
      title: !activeLithoModel
        ? 'Create a lithostratigraphic model first'
        : !sectionHasLithoContacts
          ? 'Accept litho suggestions to enable correlation — 0 accepted contacts on this section'
          : autoCorrelating
            ? 'Running auto-correlate…'
            : 'Auto-correlate: match contacts at neighbouring investigations within a depth + distance tolerance — inserts unapproved edges across the whole model. Use "Accept correlations" to approve.',
      testid: 'litho-auto-correlate',
    },
    {
      icon: <CheckCheck size={13} />,
      label: acceptingCorrelations ? 'Accepting…' : 'Accept correlations',
      onClick: () => {
        void handleAcceptCorrelations()
      },
      disabled:
        !activeLithoModel || !hasSection || acceptingCorrelations || !sectionHasLithoContacts,
      title: !activeLithoModel
        ? 'Create a lithostratigraphic model first'
        : !hasSection
          ? 'Open a cross-section to accept correlations'
          : !sectionHasLithoContacts
            ? 'Accept litho suggestions to enable correlation — 0 accepted contacts on this section'
            : acceptingCorrelations
              ? 'Accepting correlations…'
              : 'Accept all unapproved contact-level correlation edges in this section — commits lens bodies and recomputes ordinals',
      testid: 'litho-accept-correlations',
    },
    {
      // Clear correlation suggestions (#179, moved under the
      // Correlate caret per dogfeed 2026-05-29). Gated only on the
      // model — NOT on section contacts — so the user can clear
      // model-wide / off-section stale suggestions even when the
      // current section has none. Because this item stays enabled
      // when the section has 0 contacts, the Correlate primary then
      // acts as a caret-fallback (opens this menu) rather than being
      // fully disabled. Reversible via Auto-correlate.
      icon: <Trash2 size={13} />,
      label: 'Clear correlation suggestions',
      onClick: () => {
        void handleClearSuggestions()
      },
      disabled: !activeLithoModel,
      title: !activeLithoModel
        ? 'Create a lithostratigraphic model first'
        : 'Remove all unapproved correlation suggestions across the model (keeps approved correlations). Reversible — re-run Auto-correlate to regenerate.',
      testid: 'litho-clear-suggestions',
    },
  ]
}

/** The Bodies dropdown menu (fill / overlays / reset points / samples). */
export function buildLithoBodiesMenuItems(deps: LithoToolbarItemsDeps): ToolbarDropdownItem[] {
  const {
    isLitho,
    bandsVisible,
    correlationsVisible,
    formationFillVisible,
    resettingBoundaries,
    setResetBoundariesConfirmOpen,
    activeLithoModel,
    sampleMarkersOn,
    psdPreviewOn,
  } = deps
  // Built only on the litho axis: these initialisers read
  // axis-scoped state the other axes never populate.
  return !isLitho ? [] : [
              {
                // Explicit, finish-then-click verb — colour every body's closed
                // loop with its lithology. Do this AFTER correlating + pinch-outs;
                // it never auto-draws (owner directive 2026-06-03). Toggles on/off.
                label: bandsVisible ? 'Hide bands' : 'Fill bands',
                icon: <PaintBucket size={12} />,
                onClick: () => toggleBandFill(),
                testid: 'litho-fill-bands',
                title:
                  'Colour every body’s closed loop with its lithology, across the section. Do this once correlations + pinch-outs are done. Toggles on / off.',
              },
              {
                // Show / hide the CorrelationEdgesOverlay (the ribbons + lines
                // that visualise the user's correlations). Pure 2-D chrome —
                // no link to the 3-D model. Defaults to shown.
                label: correlationsVisible ? 'Hide correlations' : 'Show correlations',
                icon: <Network size={12} />,
                onClick: () => toggleCorrelationOverlay(),
                testid: 'litho-toggle-correlations',
                title:
                  'Show or hide the correlation ribbons + lines drawn across the section. A 2-D visualisation of your correlations only — it has no link to the 3-D model. Toggles on / off.',
              },
              {
                // Show / hide the ModelFillOverlay — the cross-section fill
                // sampled from the built 3-D solids. Appears once the 3-D
                // litho model has been built (Build button). Litho axis only;
                // the geological cross-section keeps its own formation fill.
                // Eye/EyeOff icon conveys the action + avoids the Layers
                // dropdown-trigger collision.
                label: formationFillVisible ? 'Hide model fill' : 'Show model fill',
                icon: formationFillVisible ? <EyeOff size={12} /> : <Eye size={12} />,
                onClick: () => toggleFormationFill(),
                testid: 'litho-toggle-model-fill',
                title:
                  'Show or hide the cross-section fill sampled from the built 3-D solids. Toggles on / off.',
              },
              {
                // Reset manual points — clear every hand-drawn body boundary
                // override so all bodies return to their engine-computed shape.
                // Irreversible (DB delete): opens a ConfirmDialog first.
                label: resettingBoundaries ? 'Resetting…' : 'Reset manual points',
                icon: <Eraser size={12} />,
                onClick: () => setResetBoundariesConfirmOpen(true),
                disabled: !activeLithoModel || resettingBoundaries,
                testid: 'litho-reset-manual-points',
                title: !activeLithoModel
                  ? 'Create a lithostratigraphic model first'
                  : 'Clear every hand-drawn body boundary point on this model. Bodies return to their computed shape. Cannot be undone.',
              },
              // The lab-sample markers draw on this axis too, so their
              // switches belong in the litho view menu as well.
              ...sampleDisplayMenuItems({
                sampleMarkersOn,
                psdPreviewOn,
                testidPrefix: 'litho',
                iconSize: 12,
              }),
            ]
}

/** The Admixtures dropdown menu (strip / reseed ghost admixtures). */
export function buildLithoAdmixtureMenuItems(deps: LithoToolbarItemsDeps): ToolbarDropdownItem[] {
  const {
    isLitho,
    cptGhostCount,
    boreholeGhostCount,
    handleStripLithoAdmixtures,
    handleReseedLithoAdmixtures,
  } = deps
  // Built only on the litho axis: these initialisers read
  // axis-scoped state the other axes never populate.
  return !isLitho ? [] : [
              {
                label: `Strip CPT admixtures${cptGhostCount > 0 ? ` (${cptGhostCount})` : ''}`,
                icon: <Eraser size={12} />,
                onClick: () => handleStripLithoAdmixtures('cpt'),
                disabled: cptGhostCount === 0,
                title:
                  cptGhostCount === 0
                    ? 'No CPT ghost suggestions'
                    : 'Clear admixtures from every CPT ghost suggestion',
                testid: 'litho-strip-cpt',
              },
              {
                label: `Strip borehole admixtures${boreholeGhostCount > 0 ? ` (${boreholeGhostCount})` : ''}`,
                icon: <Eraser size={12} />,
                onClick: () => handleStripLithoAdmixtures('borehole'),
                disabled: boreholeGhostCount === 0,
                title:
                  boreholeGhostCount === 0
                    ? 'No borehole ghost suggestions'
                    : 'Clear admixtures from every borehole ghost suggestion',
                testid: 'litho-strip-borehole',
              },
              {
                label: 'Strip all admixtures',
                icon: <Eraser size={12} />,
                onClick: () => handleStripLithoAdmixtures('all'),
                disabled: cptGhostCount === 0 && boreholeGhostCount === 0,
                title: 'Clear admixtures from every ghost suggestion',
                testid: 'litho-strip-all',
              },
              {
                label: 'Reseed borehole admixtures',
                icon: <Sparkles size={12} />,
                onClick: () => handleReseedLithoAdmixtures(),
                disabled: boreholeGhostCount === 0,
                title:
                  boreholeGhostCount === 0
                    ? 'No borehole ghost suggestions'
                    : 'Restore the segmenter’s admixtures on borehole ghosts (undo a strip)',
                testid: 'litho-reseed-borehole',
              },
            ]
}
