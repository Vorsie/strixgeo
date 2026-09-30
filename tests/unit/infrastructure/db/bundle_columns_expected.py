"""Frozen per-array column sets for the ``.strix`` bundle (debt #47 gate).

Why this file is hand-written, not derived
------------------------------------------
``build_project_bundle`` / ``restore_project_bundle`` enumerate every ORM
column via ``__mapper__.column_attrs``, so a column added to any bundled ORM
model rides into the emitted ``.strix`` automatically — convenient during
rapid development, a forward-compat liability once backwards-compat re-arms at
the first external distribution. A new column silently changes the on-disk
format with no version bump and no conscious decision.

The frozen sets below are the counterweight. ``test_bundle_column_pins.py``
asserts each bundled ORM class's live mapper columns equal its set here, so
adding (or removing) a column to any bundled model turns the unit suite RED
until someone updates the matching set on purpose — and, in doing so, decides
whether the new column should ride along in the format (and whether that is a
``format_version`` bump) or be dropped as non-portable (add it to
``_SKIP_COLUMNS`` or a per-relation exclude). The whole value is that the list
does NOT auto-follow the ORM; it is the pinned shape the format was designed
against.

Sets are the FULL mapper column set of each class — deliberately including
columns the serialiser then drops (``_SKIP_COLUMNS`` such as ``created_at`` /
``location`` / ``generation_id``, and per-relation FK back-refs such as
``model_id``). The pin protects "what COULD ride along" — the drop decision is
a separate, orthogonal ruling pinned by ``test_bundle_skip_columns.py``. Keep
the two concerns separate: this file says which columns exist; that file says
which of them are non-portable.

Organisation mirrors the bundle's top-level arrays (``BUNDLE_COLLECTION_KEYS``
plus the scalar ``project`` row). ``BUNDLE_ARRAY_ORM_CLASSES`` maps each
top-level key to every ORM class serialised under it — the array's element
class plus any classes nested inside it (a CPT's series, a borehole's whole
child tree, a geological model's contacts / surfaces / litho layers).
"""

from __future__ import annotations

from groundmodel.infrastructure.db.models.admixture_orm import AdmixtureOrm
from groundmodel.infrastructure.db.models.bed_override_orm import BedOverrideOrm
from groundmodel.infrastructure.db.models.body_boundary_node_orm import BodyBoundaryNodeOrm
from groundmodel.infrastructure.db.models.body_boundary_shape_orm import BodyBoundaryShapeOrm
from groundmodel.infrastructure.db.models.body_geometry_fact_orm import BodyGeometryFactOrm
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.body_separation_orm import BodySeparationOrm
from groundmodel.infrastructure.db.models.body_union_orm import BodyUnionOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.drill_segment_orm import DrillSegmentOrm
from groundmodel.infrastructure.db.models.field_log_interval_orm import FieldLogIntervalOrm
from groundmodel.infrastructure.db.models.formation_absence_orm import FormationAbsenceOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.formation_surface_orm import FormationSurfaceOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.geotech_tie_tombstone_orm import GeotechTieTombstoneOrm
from groundmodel.infrastructure.db.models.investigation_review_orm import InvestigationReviewOrm
from groundmodel.infrastructure.db.models.lab_series_channel_orm import LabSeriesChannelOrm
from groundmodel.infrastructure.db.models.lab_series_lab_result_orm import (
    LabSeriesLabResultOrm,
)
from groundmodel.infrastructure.db.models.lab_series_specimen_orm import LabSeriesSpecimenOrm
from groundmodel.infrastructure.db.models.lab_series_stage_orm import LabSeriesStageOrm
from groundmodel.infrastructure.db.models.lab_series_test_orm import LabSeriesTestOrm
from groundmodel.infrastructure.db.models.lab_test_family_constants import LAB_TEST_FAMILIES
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm

# Every ORM class serialised under each top-level bundle key. The element class
# comes first; nested classes follow. The lab-test families are spread from the
# single-source registry so a seventh typed family joins this list the moment it
# is added — the coverage guard then refuses until its columns are pinned below.
_LAB_FAMILY_CLASSES: tuple[type, ...] = tuple(cls for _, cls in LAB_TEST_FAMILIES)

BUNDLE_ARRAY_ORM_CLASSES: dict[str, tuple[type, ...]] = {
    # Scalar top-level row (not an array, but serialised the same way).
    "project": (ProjectOrm,),
    "cpts": (CptOrm, CptSeriesOrm),
    "boreholes": (
        BoreholeOrm,
        DrillSegmentOrm,
        FieldLogIntervalOrm,
        ObservationOrm,
        ObservationLayerOrm,
        AdmixtureOrm,
        SampleOrm,
        *_LAB_FAMILY_CLASSES,
        # The raw lab-series family, nested under each sample (2026-09-29).
        LabSeriesTestOrm,
        LabSeriesSpecimenOrm,
        LabSeriesStageOrm,
        LabSeriesChannelOrm,
        LabSeriesLabResultOrm,
    ),
    "geological_formations": (GeologicalFormationOrm,),
    "geological_models": (
        GeologicalModelOrm,
        FormationContactOrm,
        FormationSurfaceOrm,
        LithoLayerOrm,
    ),
    "cross_sections": (CrossSectionOrm,),
    "bed_overrides": (BedOverrideOrm,),
    "investigation_reviews": (InvestigationReviewOrm,),
    "bodies": (BodyOrm,),
    "formation_absences": (FormationAbsenceOrm,),
    "litho_contact_correlation_edges": (LithoContactCorrelationEdgeOrm,),
    "body_geometry_facts": (BodyGeometryFactOrm,),
    "geotech_tie_tombstones": (GeotechTieTombstoneOrm,),
    "body_separations": (BodySeparationOrm,),
    "body_unions": (BodyUnionOrm,),
    "body_boundary_shapes": (BodyBoundaryShapeOrm,),
    "body_boundary_nodes": (BodyBoundaryNodeOrm,),
    "litho_solids": (LithoBodySolidOrm,),
}

# The full mapper column set of every bundled ORM class, keyed by class name.
# HAND-MAINTAINED. When a column is added to a bundled model the pin test goes
# RED against the class here; update the set consciously and decide whether the
# new column is portable format (rides along, maybe a version bump) or dropped.
EXPECTED_BUNDLE_COLUMNS: dict[str, frozenset[str]] = {
    "ProjectOrm": frozenset(
        {
            "archived_at",
            "client",
            "created_at",
            "default_horizontal_epsg",
            "default_vertical_epsg",
            "description",
            "id",
            "name",
            "phase",
            "project_number",
            "site_label",
            "status",
            "stratigraphy_lumping_revision",
            "stratigraphy_lumping_saved",
            "stratigraphy_lumping_staged",
            "tags",
            "updated_at",
            "view_state",
        }
    ),
    "CptOrm": frozenset(
        {
            "app_project_id",
            "company",
            "cone_area_ratio",
            "cone_type_code",
            "cpt_type",
            "created_at",
            "elevation_m",
            "elevation_source",
            "epsg",
            "file_date",
            "id",
            "location",
            "location_x",
            "location_y",
            "max_depth_m",
            "n_rows",
            "name",
            "original_elevation_m",
            "original_elevation_source",
            "original_water_depth_m",
            "original_water_depth_source",
            "original_z_epsg",
            "pre_drill_m",
            "project_id",
            "report_code",
            "stop_criterion",
            "test_id",
            "updated_at",
            "water_depth_m",
            "water_depth_source",
            "z_epsg",
        }
    ),
    "CptSeriesOrm": frozenset(
        {
            "cpt_id",
            "depths_m",
            "fs_mpa",
            "q_total_mpa",
            "qc_mpa",
            "rf_pct",
            "rf_source",
            "u2_mpa",
        }
    ),
    # ``deleted_dov_permkeys`` (2026-10-04, owner dogfeed 2026-10-01: a deleted
    # DOV track stays deleted on a re-import): portable, rides along so a
    # save + reopen keeps the memory. Additive, NO format_version bump - an
    # older bundle without it restores to the empty default.
    "BoreholeOrm": frozenset(
        {
            "app_project_id",
            "borehole_type",
            "created_at",
            "deleted_dov_permkeys",
            "drill_method",
            "elevation_m",
            "elevation_source",
            "epsg",
            "executor",
            "id",
            "location",
            "location_x",
            "location_y",
            "municipality",
            "n_drill_segments",
            "n_field_log_intervals",
            "name",
            "original_elevation_m",
            "original_elevation_source",
            "original_z_epsg",
            "project_id",
            "purpose",
            "start_date",
            "test_id",
            "total_depth_m",
            "updated_at",
            "water_table_depth_m",
            "z_epsg",
        }
    ),
    "DrillSegmentOrm": frozenset({"base_m", "borehole_id", "id", "method", "top_m"}),
    # ``source`` + ``edited_manually_at`` (2026-09-29, hand-edited borehole
    # tracks): portable, ride along. Additive, NO format_version bump - an older
    # bundle without them restores to the server default (source 'dov', not
    # edited), which is exactly what every pre-2026-09-29 row was.
    "FieldLogIntervalOrm": frozenset(
        {"base_m", "borehole_id", "edited_manually_at", "id", "kind", "source", "top_m", "value"}
    ),
    "ObservationOrm": frozenset(
        {
            "author",
            "borehole_id",
            "dov_permkey",
            "drill_method_score",
            "edited_manually_at",
            "id",
            "observation_date",
            "observation_type",
            "reliability",
            "score_category",
            "source",
        }
    ),
    "ObservationLayerOrm": frozenset(
        {
            "base_m",
            "color",
            "description",
            "id",
            "layer_index",
            "main_soil_codes",
            "observation_id",
            "top_m",
        }
    ),
    "AdmixtureOrm": frozenset({"amount", "id", "locally", "observation_layer_id", "soil_code"}),
    "SampleOrm": frozenset(
        {
            "borehole_id",
            "composition",
            "depth_base_m",
            "depth_top_m",
            "description",
            "dov_permkey",
            "geotech_assignment_source",
            "geotech_body_id",
            "geotech_nad_class",
            "id",
            "instrument",
            "sample_number",
            "sample_type",
            "sampling_date",
        }
    ),
    "GrainSizeOrm": frozenset(
        {
            "diameters_mm",
            "dov_permkey",
            "id",
            "lime_removed",
            "method",
            "organics_removed",
            "pct_larger",
            "sample_id",
            "test_date",
        }
    ),
    "AtterbergLimitsOrm": frozenset(
        {
            "dov_permkey",
            "id",
            "liquid_limit_pct",
            "method",
            "non_plastic",
            "plastic_limit_pct",
            "sample_id",
            "test_date",
        }
    ),
    "CaCO3ContentOrm": frozenset(
        {"content_pct", "dov_permkey", "id", "method", "sample_id", "test_date"}
    ),
    "OrganicContentOrm": frozenset(
        {
            "carbon_pct",
            "dov_permkey",
            "id",
            "matter_pct",
            "method",
            "sample_id",
            "test_date",
        }
    ),
    "WaterContentOrm": frozenset(
        {"content_pct", "dov_permkey", "id", "method", "sample_id", "test_date"}
    ),
    "ScalarLabTestOrm": frozenset(
        {
            "detection_condition",
            "dov_permkey",
            "id",
            "method",
            "parameter",
            "parameter_group",
            "sample_id",
            "test_date",
            "unit",
            "value_numeric",
            "value_text",
        }
    ),
    "GeologicalFormationOrm": frozenset(
        {
            "app_project_id",
            "code",
            "color",
            "color_override",
            "created_at",
            "description",
            "display_order",
            "id",
            "instance_ordinal",
            "instance_ordinal_locked",
            "litho_admixtures",
            "litho_main_soil_code",
            "lithology",
            "nad_admixture_choice",
            "nad_class",
            "name",
            "parent_extrapolated",
            "parent_formation_id",
            "pinned_order",
            "regional_ref",
            "source_geo_formation_id",
            "source_litho_formation_id",
            "updated_at",
        }
    ),
    "GeologicalModelOrm": frozenset(
        {
            "app_project_id",
            "classified_with_statistic",
            "created_at",
            "derived_from_litho_digests",
            "description",
            "excluded_borehole_ids",
            "id",
            "is_active",
            "kind",
            "name",
            "parent_model_id",
            "representative_statistic",
            "updated_at",
        }
    ),
    "FormationContactOrm": frozenset(
        {
            "borehole_id",
            "confidence",
            "cpt_id",
            "created_at",
            "depth_top_m",
            "formation_id",
            "id",
            "model_id",
            "notes",
            "observation_id",
            "observation_layer_id",
            "parent_geo_contact_id",
            "source",
            "synthetic_elevation_m",
            "synthetic_x",
            "synthetic_y",
            "updated_at",
        }
    ),
    "FormationSurfaceOrm": frozenset(
        {
            "created_at",
            "formation_id",
            "id",
            "is_stale",
            "method",
            "model_id",
            "source_contact_checksum",
            "source_contact_count",
            "triangles",
            "updated_at",
            "vertices",
        }
    ),
    "LithoLayerOrm": frozenset(
        {
            "body_id",
            "borehole_id",
            "confidence",
            "cpt_id",
            "created_at",
            "depth_base_m",
            "depth_top_m",
            "formation_id",
            "id",
            "model_id",
            "notes",
            "observation_id",
            "observation_layer_id",
            "parent_geo_contact_id",
            "parent_litho_layer_id",
            "source",
            "status",
            "updated_at",
        }
    ),
    "CrossSectionOrm": frozenset(
        {
            "app_project_id",
            "companion_body_id",
            "created_at",
            "description",
            "display_order",
            "end_x",
            "end_y",
            "epsg",
            "excluded_borehole_ids",
            "excluded_cpt_ids",
            "id",
            "is_body_companion",
            "max_depth_m",
            "min_depth_m",
            "name",
            "projection_buffer_m",
            "seeded_formation_contact_ids",
            "start_x",
            "start_y",
            "updated_at",
            "vertical_exaggeration",
            "view_state",
        }
    ),
    "BedOverrideOrm": frozenset(
        {
            "app_project_id",
            "created_at",
            "epsg",
            "id",
            "label",
            "level_m",
            "updated_at",
            "vertices",
        }
    ),
    "InvestigationReviewOrm": frozenset(
        {
            "app_project_id",
            "created_at",
            "id",
            "is_hidden",
            "review_notes",
            "review_status",
            "reviewed_at",
            "target_id",
            "target_kind",
            "updated_at",
        }
    ),
    "BodyOrm": frozenset(
        {
            "app_project_id",
            "body_ordinal",
            "created_at",
            "display_color",
            "formation_id",
            "id",
            "model_id",
            "name",
            "parent_litho_body_id",
            "primary_section_id",
            "source_investigation_id",
            "updated_at",
        }
    ),
    "FormationAbsenceOrm": frozenset(
        {
            "created_at",
            "formation_id",
            "id",
            "investigation_id",
            "investigation_kind",
            "source",
            "updated_at",
        }
    ),
    "LithoContactCorrelationEdgeOrm": frozenset(
        {
            "created_at",
            "id",
            "layer_a_id",
            "layer_a_side",
            "layer_b_id",
            "layer_b_side",
            "model_id",
            "review_reason",
            "section_id",
            "source",
            "updated_at",
            "user_approved",
        }
    ),
    "BodyGeometryFactOrm": frozenset({"created_at", "id", "layer_a_id", "layer_b_id", "model_id"}),
    "GeotechTieTombstoneOrm": frozenset(
        {
            "a_x",
            "a_y",
            "a_z",
            "b_x",
            "b_y",
            "b_z",
            "created_at",
            "id",
            "model_id",
            "section_id",
        }
    ),
    "BodySeparationOrm": frozenset({"created_at", "id", "layer_a_id", "layer_b_id", "model_id"}),
    "BodyUnionOrm": frozenset({"created_at", "id", "layer_a_id", "layer_b_id", "model_id"}),
    "BodyBoundaryShapeOrm": frozenset({"body_id", "id", "model_id", "render_style"}),
    "BodyBoundaryNodeOrm": frozenset(
        {"along_m", "boundary", "elevation_m", "id", "node_index", "shape_id"}
    ),
    "LithoBodySolidOrm": frozenset(
        {
            "body_id",
            "created_at",
            "formation_id",
            "generation_id",
            "id",
            "is_flagged",
            "is_stale",
            "method",
            "model_id",
            "source_pick_checksum",
            "source_pick_count",
            "triangles",
            "updated_at",
            "vertices",
        }
    ),
    "LabSeriesTestOrm": frozenset(
        {
            "created_at",
            "id",
            "import_issues",
            "kind",
            "lab_borehole_name",
            "lab_job_number",
            "lab_sample_number",
            "lab_sequence_number",
            "n_specimens",
            "sample_id",
            "sampling_depth_base_m",
            "sampling_depth_top_m",
            "source_file_name",
            "source_format",
            "source_header",
            "source_native_file",
            "source_program_version",
            "source_sha256",
            "standard_token",
            "test_start_date",
            "test_type_token",
            "updated_at",
            "visual_description",
        }
    ),
    "LabSeriesSpecimenOrm": frozenset(
        {
            "apparatus_id",
            "calibration",
            "consolidation_stress_kpa",
            "consolidation_volume_change_cm3",
            "dial_coefficient_mm_per_unit",
            "dry_mass_g",
            "failure_description",
            "grain_density_note",
            "grain_density_t_m3",
            "id",
            "initial_diameter_mm",
            "initial_height_mm",
            "initial_water_content_pct",
            "initial_wet_mass_g",
            "lever_ratio",
            "mounting_date",
            "n_points",
            "sort_order",
            "source_header",
            "specimen_depth_base_m",
            "specimen_depth_top_m",
            "specimen_label",
            "strain_rate_mm_per_min",
            "test_id",
        }
    ),
    "LabSeriesStageOrm": frozenset(
        {
            "direction_token",
            "hanger_load_kg",
            "height_at_start_mm",
            "id",
            "lab_coefficient",
            "lab_coefficient_label",
            "lab_stage_settlement_mm",
            "n_readings",
            "point_numbers",
            "reading_timestamps",
            "rezero_indices",
            "specimen_id",
            "stage_index",
            "stage_kind",
            "started_at",
            "target_stress_kpa",
        }
    ),
    "LabSeriesChannelOrm": frozenset(
        {
            "channel_key",
            "derivation_inputs",
            "formula",
            "id",
            "provenance",
            "series_values",
            "sort_order",
            "source_label",
            "stage_id",
            "unit",
        }
    ),
    "LabSeriesLabResultOrm": frozenset(
        {
            "id",
            "parameter",
            "provenance",
            "sort_order",
            "specimen_label",
            "stage_index",
            "test_id",
            "unit",
            "value_numeric",
            "value_text",
        }
    ),
}
