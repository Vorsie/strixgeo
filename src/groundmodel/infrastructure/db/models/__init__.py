"""SQLAlchemy ORM model definitions."""

from groundmodel.infrastructure.db.models.admixture_orm import AdmixtureOrm
from groundmodel.infrastructure.db.models.atterberg_limits_orm import AtterbergLimitsOrm
from groundmodel.infrastructure.db.models.bed_override_orm import BedOverrideOrm
from groundmodel.infrastructure.db.models.body_boundary_node_orm import BodyBoundaryNodeOrm
from groundmodel.infrastructure.db.models.body_boundary_shape_orm import BodyBoundaryShapeOrm
from groundmodel.infrastructure.db.models.body_geometry_fact_orm import BodyGeometryFactOrm
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.body_separation_orm import BodySeparationOrm
from groundmodel.infrastructure.db.models.body_union_orm import BodyUnionOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.caco3_content_orm import CaCO3ContentOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.drill_segment_orm import DrillSegmentOrm
from groundmodel.infrastructure.db.models.field_log_interval_orm import FieldLogIntervalOrm
from groundmodel.infrastructure.db.models.formation_absence_orm import FormationAbsenceOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.formation_surface_orm import FormationSurfaceOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.geotech_tie_tombstone_orm import GeotechTieTombstoneOrm
from groundmodel.infrastructure.db.models.grain_size_orm import GrainSizeOrm
from groundmodel.infrastructure.db.models.investigation_review_orm import InvestigationReviewOrm
from groundmodel.infrastructure.db.models.lab_series_channel_orm import LabSeriesChannelOrm
from groundmodel.infrastructure.db.models.lab_series_lab_result_orm import LabSeriesLabResultOrm
from groundmodel.infrastructure.db.models.lab_series_specimen_orm import LabSeriesSpecimenOrm
from groundmodel.infrastructure.db.models.lab_series_stage_orm import LabSeriesStageOrm
from groundmodel.infrastructure.db.models.lab_series_test_orm import LabSeriesTestOrm
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.models.litho_build_generation_orm import (
    LithoBuildGenerationOrm,
)
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.models.organic_content_orm import OrganicContentOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.infrastructure.db.models.scalar_lab_test_orm import ScalarLabTestOrm
from groundmodel.infrastructure.db.models.water_content_orm import WaterContentOrm

__all__ = [
    "AdmixtureOrm",
    "AtterbergLimitsOrm",
    "BedOverrideOrm",
    "BodyBoundaryNodeOrm",
    "BodyBoundaryShapeOrm",
    "BodyGeometryFactOrm",
    "BodySeparationOrm",
    "BodyUnionOrm",
    "GeotechTieTombstoneOrm",
    "BodyOrm",
    "BoreholeOrm",
    "CaCO3ContentOrm",
    "CptOrm",
    "CptSeriesOrm",
    "CrossSectionOrm",
    "DrillSegmentOrm",
    "FieldLogIntervalOrm",
    "FormationContactOrm",
    "FormationSurfaceOrm",
    "GeologicalFormationOrm",
    "GeologicalModelOrm",
    "GrainSizeOrm",
    "InvestigationReviewOrm",
    "FormationAbsenceOrm",
    "LabSeriesChannelOrm",
    "LabSeriesLabResultOrm",
    "LabSeriesSpecimenOrm",
    "LabSeriesStageOrm",
    "LabSeriesTestOrm",
    "LithoBodySolidOrm",
    "LithoBuildGenerationOrm",
    "LithoContactCorrelationEdgeOrm",
    "LithoLayerOrm",
    "ObservationLayerOrm",
    "ObservationOrm",
    "OrganicContentOrm",
    "ProjectOrm",
    "SampleOrm",
    "ScalarLabTestOrm",
    "WaterContentOrm",
]
