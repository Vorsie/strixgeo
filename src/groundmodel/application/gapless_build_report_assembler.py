"""Assembles the seven-clause gapless-gate report for one 3-D build.

The renderer computes clauses 1-4 (2-D) and sends them as plain
key/status/reason/entries dicts (the router converts the Pydantic
``GaplessClauseInputSchema`` list before it reaches here — the application
layer must not import API schemas).  Clauses 5-7 (3-D) are computed
backend-side, from the labeller's :class:`LabelReport` and the per-section
:class:`SectionReconciliation` tuple.

This class is the ONE place that re-stamps every clause's ``number`` and
``title`` from :mod:`groundmodel.application.gapless_clause_constants` and
merges all seven into the report dict that gets stored on
``litho_build_generation.gapless_report`` and returned to the client.  It
returns a plain JSON-ready ``dict`` — not the Pydantic
``GaplessBuildReportSchema`` — so the application layer stays clean-
architecture compliant; the API layer validates the dict into the schema at
the boundary.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from groundmodel.application.gapless_clause_constants import (
    GAPLESS_2D_CLAUSES,
    GAPLESS_3D_CLAUSES,
    GAPLESS_CLAUSE_ORDER,
    GAPLESS_CLAUSE_TITLES,
    NO_2D_CLAUSES_REASON,
    NO_GRID_REASON,
    NO_RECONCILIATION_REASON,
    GaplessClauseKey,
)
from groundmodel.domain.services.voxel_litho.voxel_constants import (
    HAIRLINE_LIMIT_M,
    STACK_VOID_ACTIONABLE_M,
)
from groundmodel.domain.services.voxel_litho.voxel_types import LabelReport, SectionReconciliation
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

__all__ = ["GaplessBuildReportAssembler"]

_CLAUSE_NUMBER: dict[GaplessClauseKey, int] = {
    key: number for number, key in enumerate(GAPLESS_CLAUSE_ORDER, start=1)
}


class GaplessBuildReportAssembler(GroundModelLogger):
    """Builds the seven-clause gapless report dict for one voxel build.

    Notes
    -----
    Inherits :class:`GroundModelLogger`; the class has real behaviour (it logs
    which clauses failed and the overall verdict), unlike the frozen value
    objects it reads.
    """

    def __init__(self) -> None:
        """Initialise the logger under this module's name."""
        super().__init__(__name__)

    def assemble(
        self,
        model_id: UUID,
        *,
        gapless_2d: list[dict[str, Any]] | None,
        label_report: LabelReport | None,
        reconciliations: tuple[SectionReconciliation, ...] | None,
        reconciliation_error: str | None = None,
    ) -> dict[str, Any]:
        """Assemble the seven-clause report, re-stamping every clause's identity.

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic model being built (for the log lines only).
        gapless_2d : list of dict, or None
            The renderer's clause 1-4 findings, each already shaped like
            ``GaplessClauseInputSchema`` (``key`` / ``status`` /
            ``not_evaluated_reason`` / ``entries``) but as a plain dict.
            ``None`` or a list missing a key means that clause was never
            computed (a lithology build, or a client older than the gate).
        label_report : LabelReport or None
            The labeller's structural-anomaly counters, or ``None`` when no
            grid was labelled this build (the checksum-skip path).
        reconciliations : tuple of SectionReconciliation, or None
            The per-section clause-7 comparison, or ``None`` alongside
            ``label_report`` for the same reason.
        reconciliation_error : str or None, optional
            Set when a grid WAS labelled but the clause-7 comparison itself
            raised.  Clause 7 is then ``not-evaluated`` naming that failure,
            while clauses 5 and 6 still answer from the label report — the
            check broke, not the model, and the two must not be confused.
            Ignored when no grid was labelled at all (there is a truer reason).

        Returns
        -------
        dict
            ``{"verdict": ..., "clauses": [...], "generated_at": ...}`` — all
            seven clauses, always, in :data:`GAPLESS_CLAUSE_ORDER`.
        """
        self.info(
            f"GaplessBuildReportAssembler: model={model_id} — "
            f"2d_clauses_received={len(gapless_2d) if gapless_2d else 0} "
            f"label_report={'present' if label_report is not None else 'absent'} "
            f"reconciliations={len(reconciliations) if reconciliations is not None else 'absent'}"
        )

        by_key = {raw["key"]: raw for raw in (gapless_2d or [])}
        clauses: dict[str, dict[str, Any]] = {}
        for key in GAPLESS_2D_CLAUSES:
            clauses[key] = (
                self._restamp(by_key[key])
                if key in by_key
                else self._not_evaluated(key, NO_2D_CLAUSES_REASON)
            )

        if label_report is None:
            for key in GAPLESS_3D_CLAUSES:
                clauses[key] = self._not_evaluated(key, NO_GRID_REASON)
        else:
            clauses["column-totality"] = self._column_totality(label_report)
            clauses["stack-voids"] = self._stack_voids(label_report)
            # A grid exists, so 5 and 6 are answered above whatever happened to
            # 7. Clause 7 is the only one that can fail as a CHECK rather than
            # as a finding, and it says which of the two it was.
            clauses["section-reconciliation"] = (
                self._section_reconciliation(reconciliations)
                if reconciliations is not None and reconciliation_error is None
                else self._not_evaluated(
                    "section-reconciliation",
                    reconciliation_error
                    if reconciliation_error is not None
                    else NO_RECONCILIATION_REASON,
                )
            )

        ordered = [clauses[key] for key in GAPLESS_CLAUSE_ORDER]
        for clause in ordered:
            if clause["status"] == "fail":
                self.warning(
                    f"GaplessBuildReportAssembler: model={model_id} — clause "
                    f"{clause['number']} '{clause['key']}' FAILED with "
                    f"{len(clause['entries'])} entr(y/ies)"
                )

        verdict = self._verdict(ordered)
        report = {
            "verdict": verdict,
            "clauses": ordered,
            "generated_at": datetime.now(UTC).isoformat(),
        }
        if verdict == "pass":
            self.success(f"GaplessBuildReportAssembler: model={model_id} — verdict PASS")
        else:
            self.warning(
                f"GaplessBuildReportAssembler: model={model_id} — verdict {verdict.upper()}"
            )
        return report

    def _restamp(self, raw: dict[str, Any]) -> dict[str, Any]:
        """Re-stamp a renderer-supplied 2-D clause with its number and title."""
        key: GaplessClauseKey = raw["key"]
        return {
            "key": key,
            "status": raw.get("status", "not-evaluated"),
            "not_evaluated_reason": raw.get("not_evaluated_reason"),
            "entries": raw.get("entries", []),
            "number": _CLAUSE_NUMBER[key],
            "title": GAPLESS_CLAUSE_TITLES[key],
        }

    def _not_evaluated(self, key: GaplessClauseKey, reason: str) -> dict[str, Any]:
        """A clause nobody could measure this build, honestly labelled."""
        return {
            "key": key,
            "status": "not-evaluated",
            "not_evaluated_reason": reason,
            "entries": [],
            "number": _CLAUSE_NUMBER[key],
            "title": GAPLESS_CLAUSE_TITLES[key],
        }

    def _clause(
        self, key: GaplessClauseKey, *, failed: bool, entries: list[dict[str, Any]]
    ) -> dict[str, Any]:
        """Assemble a computed (never not-evaluated) 3-D clause dict."""
        return {
            "key": key,
            "status": "fail" if failed else "pass",
            "not_evaluated_reason": None,
            "entries": entries if failed else [],
            "number": _CLAUSE_NUMBER[key],
            "title": GAPLESS_CLAUSE_TITLES[key],
        }

    def _column_totality(self, label_report: LabelReport) -> dict[str, Any]:
        """Clause 5: every column inside the footprint carries material."""
        empty = label_report.empty_in_footprint_columns
        entry = {
            "label": (
                f"{empty} of {label_report.in_footprint_columns} column(s) inside the "
                "model footprint carry no labelled voxel"
            ),
            "measure": {"value": float(empty), "unit": "count", "budget": 0.0},
            "params": {
                "empty_count": empty,
                "in_footprint_count": label_report.in_footprint_columns,
            },
        }
        return self._clause("column-totality", failed=bool(empty), entries=[entry] if empty else [])

    def _stack_voids(self, label_report: LabelReport) -> dict[str, Any]:
        """Clause 6: no column has an interior void an engineer can act on.

        The clause fails on the ACTIONABLE count (voids at or above
        :data:`~groundmodel.domain.services.voxel_litho.voxel_constants.STACK_VOID_ACTIONABLE_M`),
        not on every gap over the hairline limit.  A void between the hairline
        limit and the action threshold is real snap-round residue but nothing the
        engineer can see or act on (owner finding, installer #35: "4 stacks over
        15 mm, worst 33.5 mm"), so it is carried as a NOTE on a PASSING clause
        rather than reported as a broken guarantee.  ``params`` carries the raw
        numbers so the renderer composes the sentence in the engineer's language.
        """
        actionable = label_report.hairline_gaps_actionable
        residue = label_report.hairline_gaps_over_limit
        worst_m = label_report.hairline_worst_m
        failed = bool(actionable)
        params = {
            "actionable_count": actionable,
            "residue_count": residue,
            "worst_mm": worst_m * 1000.0,
            "action_threshold_mm": STACK_VOID_ACTIONABLE_M * 1000.0,
            "hairline_limit_mm": HAIRLINE_LIMIT_M * 1000.0,
        }
        entries: list[dict[str, Any]] = []
        if failed:
            entries.append(
                {
                    "label": (
                        f"{actionable} column stack(s) carry an interior void over "
                        f"{STACK_VOID_ACTIONABLE_M * 1000:.0f} mm; worst "
                        f"{worst_m * 1000:.1f} mm"
                    ),
                    "measure": {
                        "value": worst_m,
                        "unit": "m",
                        "budget": STACK_VOID_ACTIONABLE_M,
                    },
                    "params": params,
                }
            )
        elif residue:
            # A passing clause with a residue: shown as a note, never a ✗.
            entries.append(
                {
                    "label": (
                        f"largest interior gap {worst_m * 1000:.1f} mm, below the "
                        f"{STACK_VOID_ACTIONABLE_M * 1000:.0f} mm action threshold "
                        f"(snap-round residue, {residue} stack(s))"
                    ),
                    "measure": {
                        "value": worst_m,
                        "unit": "m",
                        "budget": STACK_VOID_ACTIONABLE_M,
                    },
                    "params": {**params, "note": True},
                }
            )
        return {
            "key": "stack-voids",
            "status": "fail" if failed else "pass",
            "not_evaluated_reason": None,
            "entries": entries,
            "number": _CLAUSE_NUMBER["stack-voids"],
            "title": GAPLESS_CLAUSE_TITLES["stack-voids"],
        }

    def _section_reconciliation(
        self, reconciliations: tuple[SectionReconciliation, ...]
    ) -> dict[str, Any]:
        """Clause 7: the 3-D model holds the ground its sections classed."""
        entries: list[dict[str, Any]] = []
        for r in reconciliations:
            if not r.violated:
                continue
            note = ""
            if r.samples_outside_footprint:
                note = f"; {r.samples_outside_footprint} sample(s) outside the footprint excluded"
            worst_place = (
                f"worst sample {r.worst_sample_divergence_m * 1000:.0f} mm off at "
                f"{r.worst_sample_along_m:.1f} m along the line"
                if r.worst_sample_along_m is not None
                else "no sample fell inside the model footprint"
            )
            entries.append(
                {
                    "label": (
                        f"section {r.section_index} "
                        f"({r.start_x:.1f}, {r.start_y:.1f}) -> "
                        f"({r.end_x:.1f}, {r.end_y:.1f}): the 3-D model holds "
                        f"{r.swept_3d_m2:.2f} m2 of the {r.swept_2d_m2:.2f} m2 its 2-D "
                        f"fill classed (allowance {r.allowance_m2:.2f} m2; {worst_place})"
                        f"{note}"
                    ),
                    # Coordinates travel so the renderer can resolve the finding to
                    # its own cross-section row (the reconciliation works on the
                    # re-seated payload, which carries no DB section id) and offer a
                    # "Show me" jump; the numbers travel so it composes the sentence
                    # in the engineer's language.
                    "world_x": r.start_x,
                    "world_y": r.start_y,
                    "params": {
                        "section_index": r.section_index,
                        "start_x": r.start_x,
                        "start_y": r.start_y,
                        "end_x": r.end_x,
                        "end_y": r.end_y,
                        "swept_3d_m2": r.swept_3d_m2,
                        "swept_2d_m2": r.swept_2d_m2,
                        "allowance_m2": r.allowance_m2,
                        "worst_sample_along_m": r.worst_sample_along_m,
                        "worst_sample_divergence_mm": (
                            None
                            if r.worst_sample_along_m is None
                            else r.worst_sample_divergence_m * 1000.0
                        ),
                        "samples_outside_footprint": r.samples_outside_footprint,
                    },
                    "measure": {
                        "value": r.divergence_m2,
                        "unit": "m2",
                        "budget": r.allowance_m2,
                    },
                }
            )
        return self._clause("section-reconciliation", failed=bool(entries), entries=entries)

    def _verdict(self, clauses: list[dict[str, Any]]) -> str:
        """Derive the report's overall verdict from its assembled clauses."""
        statuses = {c["status"] for c in clauses}
        if "fail" in statuses:
            return "fail"
        if "not-evaluated" in statuses:
            return "incomplete"
        return "pass"
