// The three menus of the geotech-axis toolbar verbs (statistic / pipeline /
// display).
//
// Extracted verbatim from ``SectionsToolbar`` (debt #201) alongside
// ``sectionsGeotechToolbarItems``. Each builder returns a
// ``ToolbarDropdownItem[]``; ``buildGeotechToolbarItems`` folds them into the
// dropdown ``items`` + overflow rows. Pure functions — no hooks, bodies
// byte-identical to the inline originals.

import {
  Zap,
  CheckCheck,
  Layers,
  Network,
  Eye,
  EyeOff,
  SplitSquareVertical,
  FlaskConical,
} from 'lucide-react'

import type { ToolbarDropdownItem } from '../../ToolbarPrimitives'
import { toggleCorrelationOverlay } from '../../../utils/correlationOverlayStore'
import { toggleGeotechFill } from '../../../utils/geotechFillStore'
import { toggleGeotechModelFill } from '../../../utils/geotechModelFillStore'
import { toggleLithoFillOnGeotech } from '../../../utils/lithoFillOnGeotechStore'
import { toggleBoreholePreviewOn } from '../../../utils/boreholePreviewOnStore'
import { sampleDisplayMenuItems } from './sampleDisplayMenuItems'
import { GEOTECH_STATISTICS, type GeotechStatistic } from '../../../utils/geotechStatistic'
import { dividePendingTag, dividePendingTitle } from '../../../utils/geotechPendingScope'
import { sectionsDividePartitionCallback } from '../../../hooks/useProjectBodyRecompute'
import type { GeologicalModelResponse } from '../../../api/client'
import type { UseGeologicalModelResult } from '../../../hooks/useGeologicalModel'
import type { UseSectionsResult } from '../../../hooks/useSections'
import type { summarisePendingTies } from '../../../utils/geotechPendingScope'
import type { unionStaleGeotechColumns } from '../../../utils/staleGeotechColumns'
import type { useGeotechTieStatus } from './useGeotechTieStatus'
import type { Translator } from '../../../i18n/translate'

/** The pending-tie scope summary (model total / this section / dirty sections). */
type PendingScope = ReturnType<typeof summarisePendingTies>
/** The geotech tie-status snapshot (loaded / pending / accepted counts). */
type TieStatus = ReturnType<typeof useGeotechTieStatus>['status']
/** The merged list of columns whose packing bands are out of date (debt #266). */
type StaleGeotechColumns = ReturnType<typeof unionStaleGeotechColumns>

/**
 * Everything the geotech-axis toolbar items + their menus read from
 * ``SectionsToolbar``. One interface for the whole geotech block; each menu
 * builder uses only the subset it needs.
 */
export interface GeotechToolbarItemsDeps {
  /** Active-language translator, threaded from the toolbar so a language flip
   *  re-renders every verb in one pass. */
  t: Translator
  isGeotech: boolean
  activeLithoModel: GeologicalModelResponse | null
  activeGeotechModel: GeologicalModelResponse | null
  selectedSectionId: string | null
  geotechStatistic: string
  geotechBandsStale: boolean
  columnsNeedingRederive: UseGeologicalModelResult['columnsNeedingRederive']
  subdividingBodies: boolean
  dividingBoreholes: boolean
  autoCorrelatingGeotech: boolean
  acceptingGeotechCorrelations: boolean
  sectionHasPackingBands: boolean
  tiesBlockDivide: boolean
  boreholesStale: boolean
  correlateMode: boolean
  geotechFillVisible: boolean
  geotechModelFillVisible: boolean
  lithoFillOnGeotech: boolean
  boreholePreviewOn: boolean
  correlationsVisible: boolean
  sampleMarkersOn: boolean
  psdPreviewOn: boolean
  pendingScope: PendingScope
  tieStatus: TieStatus
  staleGeotechColumns: StaleGeotechColumns
  setDividingBoreholes: (dividing: boolean) => void
  handleSetGeotechStatistic: (statistic: GeotechStatistic) => void
  pressSubdivide: (sectionId: string | null) => void
  runAutoCorrelateGeotech: (sectionId: string | null) => Promise<void>
  runAcceptGeotechCorrelations: (sectionId: string | null) => Promise<void>
  handleDivideBoreholes: UseGeologicalModelResult['handleDivideBoreholes']
  handleRevealPendingTie: () => void
  enterCorrelateMode: UseSectionsResult['enterCorrelateMode']
  exitCorrelateMode: UseSectionsResult['exitCorrelateMode']
}

/**
 * The statistic PICKER rows — the four tokens, and nothing else.
 *
 * Split out of the menu below because the ⋯ More menu takes these rows but not
 * the explanatory note above them (owner 2026-09-11: the note is information,
 * not a verb; it reads in the Sections inspector instead).
 */
export function buildGeotechStatisticPickerItems(
  deps: GeotechToolbarItemsDeps,
): ToolbarDropdownItem[] {
  const { t, isGeotech, geotechStatistic, handleSetGeotechStatistic } = deps
  // Built only on the geotech axis: these initialisers read
  // axis-scoped state the other axes never populate.
  return !isGeotech ? [] : [
              // NOT gated on the geotech model existing (owner 2026-08-15:
              // "i can't choose harmonic qc before first subdivide, that's
              // friction we don't need?"). Before step 1 there is no row to
              // write to, so the pick is held in the renderer and handed to
              // the press that creates the model. The statistic TOKEN itself
              // (median / harmonic / …) is a technical term shown verbatim.
              ...GEOTECH_STATISTICS.map(token => ({
                label: token,
                tag: token === geotechStatistic ? t('sections.geotech.currentTag') : undefined,
                title:
                  token === 'harmonic'
                    ? t('sections.geotech.harmonicHint')
                    : token === 'median'
                      ? t('sections.geotech.medianHint')
                      : undefined,
                testid: `geotech-statistic-${token}`,
                onClick: () => handleSetGeotechStatistic(token),
              })),
            ]
}

/** The "qc: <statistic>" dropdown menu — the note, then the picker rows. */
export function buildGeotechStatisticMenuItems(
  deps: GeotechToolbarItemsDeps,
): ToolbarDropdownItem[] {
  const { t, isGeotech } = deps
  const picker = buildGeotechStatisticPickerItems(deps)
  return !isGeotech ? [] : [
              {
                // Stated inside the menu as well as in the tooltip. A tooltip is not
                // read before a click, and the one thing that surprises here is that
                // picking a statistic changes NOTHING on screen by itself.
                label: t('sections.toolbar.applyNextSubdivide'),
                disabled: true,
                testid: 'geotech-statistic-note',
                onClick: () => {},
              },
              ...picker,
            ]
}

/** The four-step packing pipeline dropdown menu. */
export function buildGeotechPipelineMenuItems(
  deps: GeotechToolbarItemsDeps,
): ToolbarDropdownItem[] {
  const {
    t,
    isGeotech,
    subdividingBodies,
    geotechBandsStale,
    geotechStatistic,
    columnsNeedingRederive,
    activeLithoModel,
    selectedSectionId,
    pressSubdivide,
    autoCorrelatingGeotech,
    sectionHasPackingBands,
    runAutoCorrelateGeotech,
    acceptingGeotechCorrelations,
    pendingScope,
    runAcceptGeotechCorrelations,
    dividingBoreholes,
    tiesBlockDivide,
    boreholesStale,
    setDividingBoreholes,
    handleDivideBoreholes,
  } = deps
  // Built only on the geotech axis: these initialisers read
  // axis-scoped state the other axes never populate.
  return !isGeotech ? [] : [
              {
                // No "on this section" qualifier: after the owner deleted the
                // all-sections twin (2026-08-15, "it's ugly and confusing"),
                // the verb has one meaning and a qualifier on a verb with one
                // meaning only invites the question of what the other one is.
                label: subdividingBodies ? t('sections.busy.subdividing') : t('sections.geotech.step1'),
                icon: <SplitSquareVertical size={13} />,
                // Ruling 8: a statistic change never silently re-derives - this
                // tag is where the debt surfaces until the re-subdivide runs.
                // Two debts land on the same verb; the statistic wins, because
                // re-running under it re-derives every column anyway and so
                // subsumes the parentage staleness. Only when the statistic is
                // settled does the column count get the tag to itself.
                tag: geotechBandsStale
                  ? t('sections.geotech.reRunUnder', { stat: geotechStatistic })
                  : columnsNeedingRederive.length > 0
                    ? t('sections.geotech.columnsNeedRederive', {
                        n: columnsNeedingRederive.length,
                        phrase: t(
                          columnsNeedingRederive.length === 1
                            ? 'sections.geotech.columnNeeds'
                            : 'sections.geotech.columnsNeed',
                        ),
                      })
                    : undefined,
                disabled: subdividingBodies || !activeLithoModel || selectedSectionId === null,
                title: !activeLithoModel
                  ? t('sections.axis.createLithoFirst')
                  : selectedSectionId === null
                    ? t('sections.geotech.step1OpenSection')
                    : t('sections.geotech.step1Title'),
                testid: 'geotech-subdivide-cpts',
                // The step labels already read "1 · ..." — the key IS the
                // number the owner reads (ask 2026-08-31).
                shortcut: '1',
                onClick: () => pressSubdivide(selectedSectionId),
              },
              {
                label: autoCorrelatingGeotech ? t('sections.busy.correlating') : t('sections.geotech.step2'),
                icon: <Zap size={13} />,
                disabled:
                  !sectionHasPackingBands ||
                  autoCorrelatingGeotech ||
                  selectedSectionId === null,
                title:
                  selectedSectionId === null
                    ? t('sections.geotech.step2OpenSection')
                    : !sectionHasPackingBands
                      ? t('sections.geotech.noBandsHere')
                      : t('sections.geotech.step2Title'),
                testid: 'geotech-auto-correlate',
                shortcut: '2',
                onClick: () => {
                  void runAutoCorrelateGeotech(selectedSectionId)
                },
              },
              {
                label: acceptingGeotechCorrelations ? t('sections.busy.accepting') : t('sections.geotech.step3'),
                icon: <CheckCheck size={13} />,
                disabled:
                  !sectionHasPackingBands ||
                  acceptingGeotechCorrelations ||
                  selectedSectionId === null,
                tag:
                  pendingScope.sectionPending !== null && pendingScope.sectionPending > 0
                    ? t('sections.geotech.pendingHere', { n: pendingScope.sectionPending })
                    : undefined,
                // The review WORKFLOW, not just the verb (owner dogfeed
                // 2026-08-05): reject first, bulk-accept second, hand-tie last.
                title:
                  selectedSectionId === null
                    ? t('sections.geotech.step3OpenSection')
                    : !sectionHasPackingBands
                      ? t('sections.geotech.noBandsHere')
                      : t('sections.geotech.step3Title'),
                testid: 'geotech-accept-correlations',
                shortcut: '3',
                onClick: () => {
                  void runAcceptGeotechCorrelations(selectedSectionId)
                },
              },
              {
                // No "(whole model)" qualifier any more (owner 2026-08-15:
                // "i'm reading divide boreholes (whole model), no that should
                // also be section scoped") — it is the odd one out no longer.
                label: dividingBoreholes ? t('sections.busy.dividing') : t('sections.geotech.step4'),
                icon: <Layers size={13} />,
                disabled:
                  dividingBoreholes ||
                  !sectionHasPackingBands ||
                  selectedSectionId === null ||
                  tiesBlockDivide,
                // Visible tag instead of a hover title: a disabled menu item
                // fires no mouse events, so the gate must SHOW its reason. The
                // tag counts THIS section's proposals, because those are the
                // only ones this press could throw away.
                tag: tiesBlockDivide
                  ? dividePendingTag(t, pendingScope)
                  : boreholesStale
                    ? t('sections.geotech.staleReDivide')
                    : undefined,
                title:
                  selectedSectionId === null
                    ? t('sections.geotech.step4OpenSection')
                    : !sectionHasPackingBands
                      ? t('sections.geotech.noBandsHere')
                      : tiesBlockDivide
                        ? dividePendingTitle(t, pendingScope)
                        : boreholesStale
                          ? t('sections.geotech.staleReDivideTitle')
                          : t('sections.geotech.step4Title'),
                testid: 'geotech-divide-boreholes',
                shortcut: '4',
                onClick: () => {
                  if (
                    dividingBoreholes ||
                    !sectionHasPackingBands ||
                    selectedSectionId === null ||
                    tiesBlockDivide
                  )
                    return
                  setDividingBoreholes(true)
                  // Assemble the geometry the boreholes are read off BEFORE the
                  // press: the divide rebuilds every borehole band, so a
                  // partition fetched afterwards would describe the model the
                  // press has already changed. A null result is not a failure —
                  // the backend answers with the donor rule (owner ruling
                  // 2026-08-15).
                  void (async () => {
                    const buildPartition = sectionsDividePartitionCallback.current
                    const sectionPartitions =
                      buildPartition === null
                        ? null
                        : await buildPartition(selectedSectionId).catch(() => null)
                    await handleDivideBoreholes({
                      sectionId: selectedSectionId,
                      sectionPartitions,
                      // First subdivision wins (owner 2026-08-18): a borehole
                      // divided from another section keeps its bands — and any
                      // hand-set class — untouched.
                      skipExisting: true,
                    })
                  })().finally(() => {
                    setDividingBoreholes(false)
                  })
                },
              },
            ]
}

/** The Display dropdown menu (fill / model fill / litho fill / preview / etc.). */
export function buildGeotechDisplayMenuItems(
  deps: GeotechToolbarItemsDeps,
): ToolbarDropdownItem[] {
  const {
    t,
    isGeotech,
    geotechFillVisible,
    geotechModelFillVisible,
    lithoFillOnGeotech,
    boreholePreviewOn,
    correlationsVisible,
    sampleMarkersOn,
    psdPreviewOn,
  } = deps
  // Built only on the geotech axis: these initialisers read
  // axis-scoped state the other axes never populate.
  //
  // The three fills lead the menu, contiguously, and the two the owner named
  // are adjacent — dogfeed 2026-08-26: "i want to keep the old show fill and
  // wanted a new model fill next to it". They exclude one another, so the menu
  // has to read as a set to pick ONE from; scattering the model fill four items
  // down (where it shipped) made it look like an unrelated switch that had
  // helped itself to his axis.
  return !isGeotech ? [] : [
              {
                label: geotechFillVisible ? t('sections.geotech.hideFill') : t('sections.geotech.showFill'),
                icon: geotechFillVisible ? <EyeOff size={13} /> : <Eye size={13} />,
                // The bare-F hook dispatches this key — hint only.
                shortcutHint: 'f',
                onClick: () => toggleGeotechFill(),
                title: t('sections.toolbar.packingFillHint'),
                testid: 'geotech-toggle-fill',
              },
              {
                // Show / hide the ModelFillOverlay — the cross-section fill cut
                // out of the built 3-D GEOTECH solids. The peer of the litho
                // axis's own "Show model fill" (Bodies menu), added on the
                // owner's ask 2026-08-26: "can we show the actual 3D model on
                // the 2d sections just like in litho stage". Appears once the
                // geotech 3-D model has been built (Geotechnical stage → Build).
                label: geotechModelFillVisible
                  ? t('sections.litho.hideModelFill')
                  : t('sections.litho.showModelFill'),
                icon: geotechModelFillVisible ? <EyeOff size={13} /> : <Eye size={13} />,
                onClick: () => toggleGeotechModelFill(),
                title: t('sections.toolbar.geotechSolidFillHint'),
                testid: 'geotech-toggle-model-fill',
              },
              {
                label: lithoFillOnGeotech ? t('sections.geotech.hideLithoFill') : t('sections.geotech.showLithoFill'),
                // The bare-L hook dispatches this key (axis-aware) — hint only.
                shortcutHint: 'l',
                icon: lithoFillOnGeotech ? <EyeOff size={13} /> : <Eye size={13} />,
                onClick: () => toggleLithoFillOnGeotech(),
                title: t('sections.toolbar.swapFillHint'),
                testid: 'geotech-toggle-litho-fill',
              },
              {
                // Owner ruling 2026-08-07: the divide-boreholes preview is
                // OPT-IN — auto-appearing ghosts kept reading as "my boreholes
                // got subdivided" at whatever verb last drained the tie count.
                label: boreholePreviewOn
                  ? t('sections.geotech.hideBoreholePreview')
                  : t('sections.geotech.showBoreholePreview'),
                icon: boreholePreviewOn ? <EyeOff size={13} /> : <Eye size={13} />,
                onClick: () => toggleBoreholePreviewOn(),
                title: t('sections.toolbar.previewDivideHint'),
                testid: 'geotech-toggle-borehole-preview',
              },
              {
                label: correlationsVisible
                  ? t('sections.litho.hideCorrelations')
                  : t('sections.litho.showCorrelations'),
                icon: <Network size={13} />,
                onClick: () => toggleCorrelationOverlay(),
                title: t('sections.geotech.correlationsHint'),
                testid: 'geotech-toggle-correlations',
              },
              ...sampleDisplayMenuItems({
                t,
                sampleMarkersOn,
                psdPreviewOn,
                testidPrefix: 'geotech',
                iconSize: 13,
              }),
            ]
}
