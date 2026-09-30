/**
 * Ground Model API client — barrel re-export.
 *
 * All types, error classes, helper functions, and the ``api`` object are
 * implemented in per-domain modules under ``api/clients/``. This file
 * re-exports everything under the same names so no caller needs to change
 * its import path.
 *
 * Consumption shape (unchanged after the split):
 *   - Structured ``api`` object:  ``import { api } from './api/client'``
 *     then ``api.geology.listContacts(...)``
 *   - Named types:                ``import type { CptListItem } from './api/client'``
 *   - Error classes:              ``import { DuplicateCptError } from './api/client'``
 *   - Base-URL override:          ``import { setBaseUrl } from './api/client'``
 *
 * @module api/client
 */

// ---------------------------------------------------------------------------
// Shared HTTP layer
// ---------------------------------------------------------------------------

export { setBaseUrl } from './clients/shared'
// Typed HTTP failure. Consumers that need to branch on an HTTP status
// (e.g. "the project row is gone → restore it from the .strix") import the
// class from ``clients/shared`` DIRECTLY rather than through this barrel:
// a unit test that ``vi.mock``s this module would otherwise hand them an
// undefined binding and break ``instanceof`` at runtime.
export { ApiError, isApiStatus } from './clients/shared'

// ---------------------------------------------------------------------------
// CPT domain
// ---------------------------------------------------------------------------

export type {
  CptListItem,
  CptResponse,
  CptPlotResponse,
  CptSbtProfileResponse,
  GwtProvenance,
  WaterTablePatchBody,
  ImportCptResponse,
  ElevationPatchBody,
} from './clients/cpt'
export { CptRefreshConfirmationRequiredError, DuplicateCptError } from './clients/cpt'
export type { CptRefreshDiff } from './clients/cpt'

// ---------------------------------------------------------------------------
// Borehole domain
// ---------------------------------------------------------------------------

export type { BoreholeAxis } from './clients/borehole'
export { BoreholeRefreshConfirmationRequiredError } from './clients/borehole'
export type {
  BoreholeRefreshDiff,
  ImportBoreholeFileResponse,
  ImportedBoring,
  ImportFlag,
} from './clients/borehole'
export type {
  BoreholeListItem,
  BoreholeDetailResponse,
  AdmixtureResponse,
  ObservationLayerResponse,
  ObservationResponse,
  DrillSegmentResponse,
  FieldLogIntervalResponse,
  GrainSizeResponse,
  AtterbergLimitsResponse,
  CaCO3ContentResponse,
  OrganicContentResponse,
  WaterContentResponse,
  ScalarLabTestResponse,
  SampleResponse,
  TrackIntervalBody,
  TrackIssueResponse,
  BoreholeTrackResponse,
  BoreholeTrackResetResponse,
} from './clients/borehole'

// ---------------------------------------------------------------------------
// Project domain
// ---------------------------------------------------------------------------

export type {
  ProjectPhase,
  ProjectStatus,
  ProjectResponse,
  ProjectBundleResponse,
  ProjectCreatePayload,
  ProjectUpdatePayload,
  ReviewTargetKind,
  ReviewStatus,
  InvestigationReviewResponse,
  InvestigationReviewUpsertPayload,
} from './clients/project'

// ---------------------------------------------------------------------------
// Section / DEM domain
// ---------------------------------------------------------------------------

export type {
  DemSamplePoint,
  DemSampleLineResponse,
  CrossSectionResponse,
  CrossSectionCreatePayload,
  CrossSectionUpdatePayload,
} from './clients/section'

export type {
  BedOverrideResponse,
  BedOverrideCreatePayload,
  BedOverrideUpdatePayload,
  BedOverrideVertex,
} from './clients/bedOverrides'

// ---------------------------------------------------------------------------
// Geology domain (largest — all geological/litho/body types)
// ---------------------------------------------------------------------------

export type {
  GeologicalFormationResponse,
  GeologicalFormationCreatePayload,
  GeologicalFormationUpdatePayload,
  NadAdmixtureChoice,
  ModelKind,
  GeologicalModelResponse,
  GeologicalModelCreatePayload,
  GeologicalModelUpdatePayload,
  ContactSource,
  ContactConfidence,
  FormationContactResponse,
  ContactUpdateOutcome,
  FormationContactCreatePayload,
  FormationContactUpdatePayload,
  FormationContactBatchUpdateEntry,
  FormationContactBatchUpdateResponse,
  LithoLayerStatus,
  LithoLayerSource,
  LithoLayerConfidence,
  LithoLayerResponse,
  LithoLayerUpdatePayload,
  LithoLayerCreateItem,
  LithoLayerBoundaryMovePayload,
  LithoLayerBoundaryMoveResponse,
  LithoLayerCompositionPayload,
  LithoLayerSplitResponse,
  LithoLayerBatchUpdateItem,
  LithoLayerBatchUpdateResponse,
  LithoSuggestionConfidence,
  AdmixtureItem,
  LithoLayerSuggestion,
  LithoSuggestionResponse,
  LithoSuggestionRequest,
  AcceptLithoSuggestionsRequest,
  AcceptLithoSuggestionsResponse,
  BatchAcceptLithoAnchor,
  BatchAcceptLithoSuggestionsRequest,
  BatchAcceptLithoAnchorResult,
  BatchAcceptLithoSuggestionsResponse,
  AutoPopulateMode,
  AutoPopulateFromStratigraphyResponse,
  FormationCandidateItem,
  LumpingCollisionItem,
  DiscoverFromStratigraphyResponse,
  DeduplicateContactsResponse,
  RebuildSurfacesResponse,
  FormationSurfaceResponse,
  GapIssueResponse,
  CrossingValidationResponse,
  GroundSurfaceBuildResponse,
  LithoContactCorrelationEdge,
  ResolveInstancesResponse,
  CrossingPinchOut,
  DeleteAutoCorrelationsResult,
  NameBodyRequest,
  NameBodyResponse,
  FormationAbsenceItem,
  UpsertFormationAbsenceRequest,
  UpsertFormationAbsenceResponse,
  BodyListItem,
  BodyBoundaryNode,
  BodyRenderStyle,
  BodyBoundaryResponse,
  // Body separations ("Separate" verb, debt #278 R5).
  BodySeparationResponse,
  BodySeparationListItem,
  BodySeparationAnchorInfo,
  BodySeparationRejoinResponse,
  // Body unions ("Join with…" verb, debt #278).
  BodyUnionResponse,
  BodyUnionListItem,
  BodyUnionAnchorInfo,
  BodyUnionDisjoinResponse,
  LithoBodySolidResponse,
  RebuildLithoSolidsResponse,
  UpdateBodyColorResponse,
  VoxelBuildRequest,
  // F4 — "Subdivide all bodies" endpoint response.
  SubdivideAllBodiesResponse,
  // "Divide boreholes" endpoint response.
  DivideBoreholeResponse,
  // Pipeline step 3 — how many packing ties are still proposed.
  GeotechTieStatusResponse,
  // "Divide boreholes" DRY RUN — the ghost bands drawn over undivided boreholes.
  DivideBoreholePreviewBand,
  DivideBoreholePreviewColumn,
  DivideBoreholePreviewDonor,
  DivideBoreholePreviewResponse,
  // Geotech packing-band hand edits (split / merge) — preview + commit payloads.
  GeotechBandIntervalItem,
  GeotechBandWarningItem,
  GeotechBandEditPlanResponse,
  GeotechBandEditResponse,
} from './clients/geology'
export { DuplicateContactError } from './clients/geology'

// ---------------------------------------------------------------------------
// Raw lab-series domain (Geosys oedometer / triaxial readings)
// ---------------------------------------------------------------------------

export type {
  LabSeriesIssue,
  LabSeriesIdentity,
  LabSeriesPreviewSample,
  LabSeriesPreviewResponse,
  LabSeriesImportResponse,
  LabSeriesImportTarget,
  LabSeriesRefreshDiff,
  LabSeriesChannel,
  LabSeriesStage,
  LabSeriesSpecimen,
  LabSeriesLabResult,
  LabSeriesTest,
  LabSeriesTestSummary,
} from './clients/labSeries'
export { LabSeriesRefreshConfirmationRequiredError } from './clients/labSeries'

// ---------------------------------------------------------------------------
// Codelist / Virtuele Boring domain
// ---------------------------------------------------------------------------

export type {
  G3Dv3UnitResponse,
  G3Dv3CatalogResponse,
  FormalStratigraphyUnitResponse,
  FormalStratigraphyCatalogResponse,
  VirtueleBoringLagenmodelEntry,
  VirtueleBoringLayer,
  VirtueleBoringInvestigationPrediction,
  VirtueleBoringPredictionsResponse,
} from './clients/codelist'

// ---------------------------------------------------------------------------
// ``api`` object — identical nested shape as before the split.
//
// Every domain module exports a plain client object; the ``api`` object
// here wires the original nested names onto those exports so existing
// callers (``api.geology.listContacts``, ``api.cpt.plotBatch``, etc.)
// continue to work without any import-path changes.
// ---------------------------------------------------------------------------

import { cptClient } from './clients/cpt'
import { boreholeClient } from './clients/borehole'
import { projectClient, reviewClient } from './clients/project'
import { demClient, sectionClient } from './clients/section'
import { bedOverrideClient } from './clients/bedOverrides'
import { geologyClient } from './clients/geology'
import { codelistClient, virtueleboringClient } from './clients/codelist'
import { labSeriesClient } from './clients/labSeries'

/** Structured API client — use ``api.<domain>.<method>(...)`` at call sites. */
export const api = {
  cpt: cptClient,
  borehole: boreholeClient,
  project: projectClient,
  dem: demClient,
  geology: geologyClient,
  review: reviewClient,
  section: sectionClient,
  bedOverrides: bedOverrideClient,
  codelists: codelistClient,
  virtueleBoring: virtueleboringClient,
  labSeries: labSeriesClient,
}
