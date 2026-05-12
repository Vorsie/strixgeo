"""Result returned by the ImportBoreholeDov use case."""

from dataclasses import dataclass, field
from uuid import UUID


@dataclass
class ImportBoreholeDovResult:
    """Outcome of a DOV bounding-box borehole import.

    Mirrors ``ImportCptDovResult`` so the API can surface a unified
    "imported / duplicates / failed" summary regardless of which record
    type the user requested.

    Attributes
    ----------
    imported : int
        Number of boreholes successfully parsed and persisted.
    duplicates : int
        Number of boreholes that already existed in this project (skipped
        on the import side; their existing IDs are still returned in
        ``borehole_ids`` so the frontend can auto-load them).
    failed : int
        Number of boreholes that could not be downloaded, parsed, or
        persisted. Per-borehole failures are isolated — a single bad
        XML never aborts the batch.
    interpretations_attached : int
        Number of ``Observation`` rows attached to newly-imported
        boreholes by the Phase C2 interpretation orchestrator. Zero when
        no boreholes were newly imported (interpretations aren't refreshed
        for duplicates — see ``ImportInterpretationsDov`` docstring).
    interpretations_failed : int
        Per-row failures during interpretation download / parse / persist.
        Counted separately from ``failed`` because they don't roll back
        the parent borehole row.
    samples_attached : int
        Number of ``Sample`` rows attached to newly-imported boreholes
        by the Phase C3 sample orchestrator. Same idempotency rule as
        interpretations — duplicates skip the sample fetch.
    samples_failed : int
        Per-row sample persist failures (constraint violation, etc.).
        Isolated from the parent borehole row.
    grain_sizes_attached : int
        Number of ``GrainSize`` rows attached to newly-persisted samples.
    grain_sizes_failed : int
        Per-row grain-size download / parse / persist failures.
    atterberg_attached, caco3_attached, organic_attached,
    water_content_attached : int
        Number of Phase C4 scalar lab-test rows
        (``AtterbergLimits`` / ``CaCO3Content`` / ``OrganicContent`` /
        ``WaterContent``) attached to newly-persisted samples.
    atterberg_failed, caco3_failed, organic_failed,
    water_content_failed : int
        Per-row scalar lab-test failures (mapping / persist / null value).
    scalar_lab_tests_attached : int
        Number of Phase C5 ``ScalarLabTest`` catch-all rows attached
        to newly-persisted samples (parameters that don't qualify
        for a typed family).
    scalar_lab_tests_failed : int
        Per-row catch-all failures (mapping / persist / null value).
    borehole_ids : list[UUID]
        IDs of all boreholes the caller now sees in the project — newly
        imported plus pre-existing duplicates.
    """

    imported: int
    duplicates: int
    failed: int
    interpretations_attached: int = 0
    interpretations_failed: int = 0
    samples_attached: int = 0
    samples_failed: int = 0
    grain_sizes_attached: int = 0
    grain_sizes_failed: int = 0
    atterberg_attached: int = 0
    atterberg_failed: int = 0
    caco3_attached: int = 0
    caco3_failed: int = 0
    organic_attached: int = 0
    organic_failed: int = 0
    water_content_attached: int = 0
    water_content_failed: int = 0
    scalar_lab_tests_attached: int = 0
    scalar_lab_tests_failed: int = 0
    borehole_ids: list[UUID] = field(default_factory=list)
