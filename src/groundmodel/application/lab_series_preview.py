"""What the import preview tells the user about one lab file (nothing written)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class LabSeriesPreview:
    """The preview of one raw lab export against one project.

    Owner Q4 (2026-09-29): "ask user, to double check, there should be a
    sample; if no, default create one". The preview is that question: it
    proposes a borehole and a sample (or a new sample) and the user confirms
    or changes them before anything is written.

    Parameters
    ----------
    file_name : str
        The uploaded file's name.
    kind : str
        ``"oedometer"`` or ``"triaxial"``.
    source_format : str
        Which export was recognised (from content).
    test_type_token : str or None
        The lab's test type ("CD", "CU", "UU"); ``None`` for an oedometer.
    identity : dict[str, Any]
        The lab's identity as written: ``job_number``, ``borehole_name``,
        ``sequence_number``, ``sample_number``, ``depth_top_m``,
        ``depth_base_m``, ``visual_description``.
    specimens : list[dict[str, Any]]
        Per specimen: ``label``, ``n_stages``, ``n_readings``.
    borehole_candidates : list[dict[str, str]]
        ``{id, name}`` of the project boreholes that match the lab's identity.
    borehole_match : str
        ``"unique"`` (one candidate, proposed), ``"ambiguous"`` (several) or
        ``"none"``; ``"chosen"`` when the caller named the borehole.
    proposed_borehole_id : str or None
        The borehole the samples below belong to.
    samples : list[dict[str, Any]]
        ``{id, depth_top_m, depth_base_m, sample_number}`` of every sample on
        the proposed borehole (the user may pick another).
    proposed_sample_id : str or None
        The sample the test would attach to.
    sample_match : str
        ``"overlap"``, ``"sample_number"`` or ``"none"`` (then the default is
        to create a sample).
    create_sample_default : dict[str, Any] or None
        ``{depth_top_m, depth_base_m, sample_number}`` for a new sample, from
        the lab's interval; ``None`` when the export carries no interval (the
        user must enter one).
    existing_test : dict[str, Any] or None
        ``{id, sample_id, same_content}`` when a test with the same identity
        is already stored (same content → the import is a no-op; otherwise a
        consented refresh).
    issues : list[dict[str, Any]]
        The parser findings, ``{level, code, message, rows}``.
    has_errors : bool
        True when any finding is an ERROR.
    dov_lookup : dict[str, Any] or None
        Owner 2026-09-30: no project borehole matched, so DOV was asked for
        ``<job>-<borehole>``. ``{status, borehole_name, borehole_id}``;
        ``status`` is ``"fetched"`` (imported into the project and proposed),
        ``"not_found"`` (DOV has no such borehole) or ``"unreachable"`` (DOV
        timed out / no network / answered an error). ``None`` when DOV was not
        asked.
    """

    file_name: str
    kind: str
    source_format: str
    test_type_token: str | None
    identity: dict[str, Any]
    specimens: list[dict[str, Any]] = field(default_factory=list)
    borehole_candidates: list[dict[str, str]] = field(default_factory=list)
    borehole_match: str = "none"
    proposed_borehole_id: str | None = None
    samples: list[dict[str, Any]] = field(default_factory=list)
    proposed_sample_id: str | None = None
    sample_match: str = "none"
    create_sample_default: dict[str, Any] | None = None
    existing_test: dict[str, Any] | None = None
    issues: list[dict[str, Any]] = field(default_factory=list)
    has_errors: bool = False
    dov_lookup: dict[str, Any] | None = None
