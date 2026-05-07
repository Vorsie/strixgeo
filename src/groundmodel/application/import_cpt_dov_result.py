"""Result returned by the ImportCptDov use case."""

from dataclasses import dataclass, field
from uuid import UUID


@dataclass
class ImportCptDovResult:
    """Outcome of a DOV bounding-box CPT import.

    Attributes
    ----------
    imported : int
        Number of CPTs successfully parsed and persisted.
    duplicates : int
        Number of CPTs that already existed in this project (skipped).
    failed : int
        Number of CPTs that could not be downloaded or parsed.
    cpt_ids : list[UUID]
        IDs of all persisted CPTs (new and pre-existing duplicates).
    """

    imported: int
    duplicates: int
    failed: int
    cpt_ids: list[UUID] = field(default_factory=list)
