"""Result returned by the ImportInterpretationsDov use case."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ImportInterpretationsDovResult:
    """Outcome of a DOV interpretation bbox import.

    Attributes
    ----------
    fetched : int
        Number of interpretation XMLs that downloaded + parsed successfully
        (regardless of whether they were attached to a borehole).
    attached : int
        Number of ``Observation`` rows queued for persistence and attached
        to a borehole (a subset of ``fetched`` — interpretations belonging
        to a borehole NOT in the caller's ``test_id_to_borehole_id`` map
        are dropped).
    skipped_no_borehole : int
        Number of interpretations whose ``test_id`` did not match any
        known borehole — typically interpretations published for boreholes
        outside the caller's map.
    skipped_already_present : int
        Refresh-on-duplicate counter: interpretations whose
        ``dov_permkey`` was already stored under the matched borehole.
        We see them in the WFS response but skip the persist step.
    failed : int
        Number of interpretations that could not be downloaded, parsed,
        or persisted. Per-row failures are isolated.
    per_stream : dict[str, int]
        ``observation_type.value`` → attached-count breakdown for the log
        line / future API summary.
    """

    fetched: int = 0
    attached: int = 0
    skipped_no_borehole: int = 0
    skipped_already_present: int = 0
    failed: int = 0
    per_stream: dict[str, int] = field(default_factory=dict)
