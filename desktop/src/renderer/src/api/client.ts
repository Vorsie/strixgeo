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

// ---------------------------------------------------------------------------
// CPT domain
// ---------------------------------------------------------------------------

export type {
  CptListItem,
  CptResponse,
  CptPlotResponse,
  ImportCptResponse,
  ImportDovResponse,
  ElevationPatchBody,
} from './clients/cpt'
export { DuplicateCptError } from './clients/cpt'

// ---------------------------------------------------------------------------
// Borehole domain
// ---------------------------------------------------------------------------

export type { BoreholeAxis } from './clients/borehole'
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
  ImportBoreholeDovResponse,
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

// ---------------------------------------------------------------------------
// Geology domain (largest — all geological/litho/body types)
// ---------------------------------------------------------------------------

export type {
  GeologicalFormationResponse,
  GeologicalFormationCreatePayload,
  GeologicalFormationUpdatePayload,
  ModelKind,
  GeologicalModelResponse,
  GeologicalModelCreatePayload,
  GeologicalModelUpdatePayload,
  ContactSource,
  ContactConfidence,
  FormationContactResponse,
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
  LithoLayerBatchStatusPayload,
  LithoLayerBatchStatusResponse,
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
  AutoPopulateFromStratigraphyResponse,
  SeedLithoFromParentResponse,
  FormationCandidateItem,
  LumpingCollisionItem,
  DiscoverFromStratigraphyResponse,
  DeduplicateContactsResponse,
  RebuildSurfacesResponse,
  FormationSurfaceResponse,
  GapIssueResponse,
  GapValidationResponse,
  CrossingValidationResponse,
  GroundSurfaceBuildResponse,
  GeotechnicalUnitResponse,
  GeotechnicalUnitCreatePayload,
  GeotechnicalUnitUpdatePayload,
  LithoCorrelationEdge,
  LithoContactCorrelationEdge,
  ResolveInstancesResponse,
  AutoCorrelateResult,
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
  PinchOutCandidate,
  SuggestPinchOutsResponse,
} from './clients/geology'
export { DuplicateContactError, ProvenanceViolationError } from './clients/geology'

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
import { geologyClient, geotechnicalUnitClient } from './clients/geology'
import { codelistClient, virtueleboringClient } from './clients/codelist'

/** Structured API client — use ``api.<domain>.<method>(...)`` at call sites. */
export const api = {
  cpt: cptClient,
  borehole: boreholeClient,
  project: projectClient,
  dem: demClient,
  geology: geologyClient,
  geotechnicalUnit: geotechnicalUnitClient,
  review: reviewClient,
  section: sectionClient,
  codelists: codelistClient,
  virtueleBoring: virtueleboringClient,
}
