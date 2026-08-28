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
import type { Translator } from '../../../i18n/translate'

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
  /** Active-language translator, threaded from the toolbar so a language flip
   *  re-renders every verb in one pass. */
  t: Translator
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
    t,
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
      label: `${t('sections.litho.suggestAllInSection')}${
        bulkAnchors.length > 0 ? ` (${bulkAnchors.length})` : ''
      }`,
      icon: <Sparkles size={12} />,
      onClick: () => setBulkConfirmOpen(true),
      disabled: !activeLithoModel || !hasSection || bulkLithoSuggesting || lithoSuggesting,
      title: !activeLithoModel
        ? t('sections.litho.createModelFirst')
        : !hasSection
          ? t('sections.litho.openSectionFirst')
          : bulkLithoSuggesting
            ? t('sections.litho.runningSegmenterAll')
            : t('sections.litho.suggestAllInSectionTitle'),
      testid: 'litho-suggest-all',
    },
    {
      label: activeLithoModel
        ? `${t('sections.litho.suggestNewTests')} (${newTestAnchors.length})`
        : t('sections.litho.suggestNewTests'),
      icon: <Sparkles size={12} />,
      onClick: () => void handleSuggestNewTests(),
      disabled:
        !activeLithoModel ||
        bulkLithoSuggesting ||
        lithoSuggesting ||
        newTestAnchors.length === 0,
      title: !activeLithoModel
        ? t('sections.litho.createModelFirst')
        : bulkLithoSuggesting
          ? t('sections.litho.runningSegmenter')
          : newTestAnchors.length === 0
            ? t('sections.litho.allHaveContacts')
            : t('sections.litho.suggestNewTestsTitle', {
                n: newTestAnchors.length,
                investigation: t(
                  newTestAnchors.length === 1
                    ? 'sections.litho.investigationOne'
                    : 'sections.litho.investigationMany',
                ),
              }),
      testid: 'litho-suggest-new-tests',
    },
  ]
}

/** The Correlate split-button's caret menu (auto / accept / clear). */
export function buildLithoCorrelateMenuItems(deps: LithoToolbarItemsDeps): ToolbarDropdownItem[] {
  const {
    t,
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
      label: autoCorrelating ? t('sections.busy.correlating') : t('sections.litho.autoCorrelate'),
      onClick: () => {
        void handleAutoCorrelateWithCheck()
      },
      disabled: !activeLithoModel || autoCorrelating || !sectionHasLithoContacts,
      title: !activeLithoModel
        ? t('sections.litho.createModelFirst')
        : !sectionHasLithoContacts
          ? t('sections.litho.acceptFirstToCorrelate')
          : autoCorrelating
            ? t('sections.litho.runningAutoCorrelate')
            : t('sections.litho.autoCorrelateTitle'),
      testid: 'litho-auto-correlate',
    },
    {
      icon: <CheckCheck size={13} />,
      label: acceptingCorrelations ? t('sections.busy.accepting') : t('sections.litho.acceptCorrelations'),
      onClick: () => {
        void handleAcceptCorrelations()
      },
      disabled:
        !activeLithoModel || !hasSection || acceptingCorrelations || !sectionHasLithoContacts,
      title: !activeLithoModel
        ? t('sections.litho.createModelFirst')
        : !hasSection
          ? t('sections.litho.openSectionAcceptCorr')
          : !sectionHasLithoContacts
            ? t('sections.litho.acceptFirstToCorrelate')
            : acceptingCorrelations
              ? t('sections.litho.acceptingCorrelations')
              : t('sections.litho.acceptCorrelationsTitle'),
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
      label: t('sections.toolbar.clearCorrelationSuggestions'),
      onClick: () => {
        void handleClearSuggestions()
      },
      disabled: !activeLithoModel,
      title: !activeLithoModel
        ? t('sections.litho.createModelFirst')
        : t('sections.litho.clearCorrelationsTitle'),
      testid: 'litho-clear-suggestions',
    },
  ]
}

/** The Bodies dropdown menu (fill / overlays / reset points / samples). */
export function buildLithoBodiesMenuItems(deps: LithoToolbarItemsDeps): ToolbarDropdownItem[] {
  const {
    t,
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
                label: bandsVisible ? t('sections.litho.hideBands') : t('sections.litho.fillBands'),
                icon: <PaintBucket size={12} />,
                onClick: () => toggleBandFill(),
                testid: 'litho-fill-bands',
                title: t('sections.toolbar.lithoFillHint'),
              },
              {
                // Show / hide the CorrelationEdgesOverlay (the ribbons + lines
                // that visualise the user's correlations). Pure 2-D chrome —
                // no link to the 3-D model. Defaults to shown.
                label: correlationsVisible
                  ? t('sections.litho.hideCorrelations')
                  : t('sections.litho.showCorrelations'),
                icon: <Network size={12} />,
                onClick: () => toggleCorrelationOverlay(),
                testid: 'litho-toggle-correlations',
                title: t('sections.toolbar.correlationRibbonsHint'),
              },
              {
                // Show / hide the ModelFillOverlay — the cross-section fill
                // sampled from the built 3-D solids. Appears once the 3-D
                // litho model has been built (Build button). Litho axis only;
                // the geological cross-section keeps its own formation fill.
                // Eye/EyeOff icon conveys the action + avoids the Layers
                // dropdown-trigger collision.
                label: formationFillVisible
                  ? t('sections.litho.hideModelFill')
                  : t('sections.litho.showModelFill'),
                icon: formationFillVisible ? <EyeOff size={12} /> : <Eye size={12} />,
                onClick: () => toggleFormationFill(),
                testid: 'litho-toggle-model-fill',
                title: t('sections.toolbar.solidFillHint'),
              },
              {
                // Reset manual points — clear every hand-drawn body boundary
                // override so all bodies return to their engine-computed shape.
                // Irreversible (DB delete): opens a ConfirmDialog first.
                label: resettingBoundaries
                  ? t('sections.litho.resetting')
                  : t('sections.litho.resetManualPoints'),
                icon: <Eraser size={12} />,
                onClick: () => setResetBoundariesConfirmOpen(true),
                disabled: !activeLithoModel || resettingBoundaries,
                testid: 'litho-reset-manual-points',
                title: !activeLithoModel
                  ? t('sections.litho.createModelFirst')
                  : t('sections.litho.resetManualPointsTitle'),
              },
              // The lab-sample markers draw on this axis too, so their
              // switches belong in the litho view menu as well.
              ...sampleDisplayMenuItems({
                t,
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
    t,
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
                label: `${t('sections.litho.stripCptAdmixtures')}${cptGhostCount > 0 ? ` (${cptGhostCount})` : ''}`,
                icon: <Eraser size={12} />,
                onClick: () => handleStripLithoAdmixtures('cpt'),
                disabled: cptGhostCount === 0,
                title:
                  cptGhostCount === 0
                    ? t('sections.litho.noCptGhosts')
                    : t('sections.litho.stripCptTitle'),
                testid: 'litho-strip-cpt',
              },
              {
                label: `${t('sections.litho.stripBoreholeAdmixtures')}${boreholeGhostCount > 0 ? ` (${boreholeGhostCount})` : ''}`,
                icon: <Eraser size={12} />,
                onClick: () => handleStripLithoAdmixtures('borehole'),
                disabled: boreholeGhostCount === 0,
                title:
                  boreholeGhostCount === 0
                    ? t('sections.litho.noBoreholeGhosts')
                    : t('sections.litho.stripBoreholeTitle'),
                testid: 'litho-strip-borehole',
              },
              {
                label: t('sections.toolbar.stripAdmixtures'),
                icon: <Eraser size={12} />,
                onClick: () => handleStripLithoAdmixtures('all'),
                disabled: cptGhostCount === 0 && boreholeGhostCount === 0,
                title: t('sections.toolbar.clearGhostAdmixtures'),
                testid: 'litho-strip-all',
              },
              {
                label: t('sections.toolbar.reseedAdmixtures'),
                icon: <Sparkles size={12} />,
                onClick: () => handleReseedLithoAdmixtures(),
                disabled: boreholeGhostCount === 0,
                title:
                  boreholeGhostCount === 0
                    ? t('sections.litho.noBoreholeGhosts')
                    : t('sections.litho.reseedBoreholeTitle'),
                testid: 'litho-reseed-borehole',
              },
            ]
}
