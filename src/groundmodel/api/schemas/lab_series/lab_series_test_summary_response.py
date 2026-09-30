"""Response schema for one lab-series test in a borehole's list (no readings)."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class LabSeriesTestSummaryResponse(BaseModel):
    """One test as the borehole's Lab tests list shows it — counts, no arrays.

    Parameters
    ----------
    id, sample_id : UUID
        The test and its sample.
    sample_depth_top_m, sample_depth_base_m : float
        The sample's interval (the project's sample, not the lab's).
    sample_number : str or None
        The sample's number.
    kind : str
        ``oedometer`` | ``triaxial``.
    test_type_token : str or None
        The lab's test type (``CD``, ``CU``, ``UU``).
    lab_sample_number : str or None
        The lab's sample number.
    source_file_name : str
        The imported file.
    n_specimens, n_stages, n_readings : int
        Counts over the whole test.
    n_warnings, n_errors : int
        Finding counts frozen at import (the list's flags badge).
    """

    id: UUID
    sample_id: UUID
    sample_depth_top_m: float
    sample_depth_base_m: float
    sample_number: str | None = None
    kind: str
    test_type_token: str | None = None
    lab_sample_number: str | None = None
    source_file_name: str
    n_specimens: int
    n_stages: int
    n_readings: int
    n_warnings: int
    n_errors: int
