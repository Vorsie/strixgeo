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
import { NO_BANDS_HERE_TITLE } from './sectionsToolbar_constants'
import type { GeologicalModelResponse } from '../../../api/client'
import type { UseGeologicalModelResult } from '../../../hooks/useGeologicalModel'
import type { UseSectionsResult } from '../../../hooks/useSections'
import type { summarisePendingTies } from '../../../utils/geotechPendingScope'
import type { unionStaleGeotechColumns } from '../../../utils/staleGeotechColumns'
import type { useGeotechTieStatus } from './useGeotechTieStatus'

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

/** The "qc: <statistic>" dropdown menu. */
export function buildGeotechStatisticMenuItems(
  deps: GeotechToolbarItemsDeps,
): ToolbarDropdownItem[] {
  const { isGeotech, geotechStatistic, handleSetGeotechStatistic } = deps
  // Built only on the geotech axis: these initialisers read
  // axis-scoped state the other axes never populate.
  return !isGeotech ? [] : [
              {
                // Stated inside the menu as well as in the tooltip. A tooltip is not
                // read before a click, and the one thing that surprises here is that
                // picking a statistic changes NOTHING on screen by itself.
                label: 'Applies to the next Subdivide — nothing re-runs now',
                disabled: true,
                testid: 'geotech-statistic-note',
                onClick: () => {},
              },
              // NOT gated on the geotech model existing (owner 2026-08-15:
              // "i can't choose harmonic qc before first subdivide, that's
              // friction we don't need?"). Before step 1 there is no row to
              // write to, so the pick is held in the renderer and handed to
              // the press that creates the model.
              ...GEOTECH_STATISTICS.map(token => ({
                label: token,
                tag: token === geotechStatistic ? 'current' : undefined,
                title:
                  token === 'harmonic'
                    ? 'Conservative: weighted toward the low qc values that govern bearing and settlement.'
                    : token === 'median'
                      ? 'The spike-robust default.'
                      : undefined,
                testid: `geotech-statistic-${token}`,
                onClick: () => handleSetGeotechStatistic(token),
              })),
            ]
}

/** The four-step packing pipeline dropdown menu. */
export function buildGeotechPipelineMenuItems(
  deps: GeotechToolbarItemsDeps,
): ToolbarDropdownItem[] {
  const {
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
                label: subdividingBodies ? 'Subdividing…' : '1 · Subdivide CPTs',
                icon: <SplitSquareVertical size={13} />,
                // Ruling 8: a statistic change never silently re-derives - this
                // tag is where the debt surfaces until the re-subdivide runs.
                // Two debts land on the same verb; the statistic wins, because
                // re-running under it re-derives every column anyway and so
                // subsumes the parentage staleness. Only when the statistic is
                // settled does the column count get the tag to itself.
                tag: geotechBandsStale
                  ? `re-run under ${geotechStatistic}`
                  : columnsNeedingRederive.length > 0
                    ? `${columnsNeedingRederive.length} ${
                        columnsNeedingRederive.length === 1 ? 'column needs' : 'columns need'
                      } re-deriving`
                    : undefined,
                disabled: subdividingBodies || !activeLithoModel || selectedSectionId === null,
                title: !activeLithoModel
                  ? 'Create a lithostratigraphic model in the Lithology stage first'
                  : selectedSectionId === null
                    ? 'Open a cross-section first — this step subdivides the CPTs on the section you have open'
                    : 'Step 1 of 4 — derive NAD packing classes (1–31) on THIS section’s CPTs, leaving every other section’s bands, ties and bodies untouched. Correlates nothing: “2 · Auto-correlate” proposes the packing ties next. Creates the geotechnical model on first run. A CPT that is on no cross-section is never subdivided.',
                testid: 'geotech-subdivide-cpts',
                onClick: () => pressSubdivide(selectedSectionId),
              },
              {
                label: autoCorrelatingGeotech ? 'Correlating…' : '2 · Auto-correlate',
                icon: <Zap size={13} />,
                disabled:
                  !sectionHasPackingBands ||
                  autoCorrelatingGeotech ||
                  selectedSectionId === null,
                title:
                  selectedSectionId === null
                    ? 'Open a cross-section first — this step proposes ties on the section you have open'
                    : !sectionHasPackingBands
                      ? NO_BANDS_HERE_TITLE
                      : 'Step 2 of 4 — derive the same-class packing ties inside each correlated litho unit ON THIS SECTION, jumping across borehole columns that carry no packing yet. Ties that restate a litho correlation you already approved arrive ACCEPTED; the rest arrive as proposals. Hand-drawn correlations are never touched.',
                testid: 'geotech-auto-correlate',
                onClick: () => {
                  void runAutoCorrelateGeotech(selectedSectionId)
                },
              },
              {
                label: acceptingGeotechCorrelations ? 'Accepting…' : '3 · Accept ties',
                icon: <CheckCheck size={13} />,
                disabled:
                  !sectionHasPackingBands ||
                  acceptingGeotechCorrelations ||
                  selectedSectionId === null,
                tag:
                  pendingScope.sectionPending !== null && pendingScope.sectionPending > 0
                    ? `${pendingScope.sectionPending} pending here`
                    : undefined,
                // The review WORKFLOW, not just the verb (owner dogfeed
                // 2026-08-05): reject first, bulk-accept second, hand-tie last.
                title:
                  selectedSectionId === null
                    ? 'Open a cross-section first — this step accepts the ties on the section you have open'
                    : !sectionHasPackingBands
                      ? NO_BANDS_HERE_TITLE
                      : 'Step 3 of 4 — review, then approve, on the section in front of you. First DELETE the faulty proposals (right-click a tie → Delete) and accept the ones you want to check off singly (right-click → Accept tie). Then press this to accept every remaining proposal ON THIS SECTION. Afterwards, hand-connect anything auto-correlate missed with “Correlate packing”.',
                testid: 'geotech-accept-correlations',
                onClick: () => {
                  void runAcceptGeotechCorrelations(selectedSectionId)
                },
              },
              {
                // No "(whole model)" qualifier any more (owner 2026-08-15:
                // "i'm reading divide boreholes (whole model), no that should
                // also be section scoped") — it is the odd one out no longer.
                label: dividingBoreholes ? 'Dividing…' : '4 · Divide boreholes',
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
                  ? dividePendingTag(pendingScope)
                  : boreholesStale
                    ? 'stale — re-divide'
                    : undefined,
                title:
                  selectedSectionId === null
                    ? 'Open a cross-section first — this step divides the boreholes on the section you have open'
                    : !sectionHasPackingBands
                      ? NO_BANDS_HERE_TITLE
                      : tiesBlockDivide
                        ? dividePendingTitle(pendingScope)
                        : boreholesStale
                          ? 'Bodies or correlations changed — re-divide the boreholes to match'
                          : 'Step 4 of 4 — TIN-divide THIS section’s borehole columns into packing bands, using the CPT transition surfaces and the ties you accepted, and leave every other section as it is. Right-click one borehole’s ghost bands to divide just that column.',
                testid: 'geotech-divide-boreholes',
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
                label: geotechFillVisible ? 'Hide fill' : 'Show fill',
                icon: geotechFillVisible ? <EyeOff size={13} /> : <Eye size={13} />,
                onClick: () => toggleGeotechFill(),
                title:
                  'Show or hide the NAD packing-band fill — the LIVE packing classes, as the pipeline last wrote them. One fill renders at a time.',
                testid: 'geotech-toggle-fill',
              },
              {
                // Show / hide the ModelFillOverlay — the cross-section fill cut
                // out of the built 3-D GEOTECH solids. The peer of the litho
                // axis's own "Show model fill" (Bodies menu), added on the
                // owner's ask 2026-08-26: "can we show the actual 3D model on
                // the 2d sections just like in litho stage". Appears once the
                // geotech 3-D model has been built (Geotechnical stage → Build).
                label: geotechModelFillVisible ? 'Hide model fill' : 'Show model fill',
                icon: geotechModelFillVisible ? <EyeOff size={13} /> : <Eye size={13} />,
                onClick: () => toggleGeotechModelFill(),
                title:
                  'Show or hide the fill cut out of the BUILT 3-D geotechnical solids — the model as of the last Build, not the live bands. One fill renders at a time.',
                testid: 'geotech-toggle-model-fill',
              },
              {
                label: lithoFillOnGeotech ? 'Hide litho fill' : 'Show litho fill',
                icon: lithoFillOnGeotech ? <EyeOff size={13} /> : <Eye size={13} />,
                onClick: () => toggleLithoFillOnGeotech(),
                title:
                  'Swap the lithostratigraphic fill in for the NAD packing fill — one fill renders at a time, never both.',
                testid: 'geotech-toggle-litho-fill',
              },
              {
                // Owner ruling 2026-08-07: the divide-boreholes preview is
                // OPT-IN — auto-appearing ghosts kept reading as "my boreholes
                // got subdivided" at whatever verb last drained the tie count.
                label: boreholePreviewOn ? 'Hide borehole preview' : 'Show borehole preview',
                icon: boreholePreviewOn ? <EyeOff size={13} /> : <Eye size={13} />,
                onClick: () => toggleBoreholePreviewOn(),
                title:
                  'Preview the packing bands "4 · Divide boreholes" would commit, hatched over the borehole columns. Nothing is written.',
                testid: 'geotech-toggle-borehole-preview',
              },
              {
                label: correlationsVisible ? 'Hide correlations' : 'Show correlations',
                icon: <Network size={13} />,
                onClick: () => toggleCorrelationOverlay(),
                title:
                  'Show or hide the correlation ribbons drawn across the section (2-D visualisation only).',
                testid: 'geotech-toggle-correlations',
              },
              ...sampleDisplayMenuItems({
                sampleMarkersOn,
                psdPreviewOn,
                testidPrefix: 'geotech',
                iconSize: 13,
              }),
            ]
}
