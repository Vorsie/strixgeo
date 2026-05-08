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
    borehole_ids : list[UUID]
        IDs of all boreholes the caller now sees in the project — newly
        imported plus pre-existing duplicates.
    """

    imported: int
    duplicates: int
    failed: int
    borehole_ids: list[UUID] = field(default_factory=list)
