"""CachedBoreholePdfReport: a triaged borehole-log report kept between the dialog's calls."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_constants import (
    IMPORT_BLOCKING_ISSUES,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_report_digest import (
    BoreholeReportDigest,
)
from groundmodel.infrastructure.parsers.borehole.pdf.digitised_borehole import DigitisedBorehole


@dataclass(frozen=True, eq=False)
class CachedBoreholePdfReport:
    """One triaged borehole report: the file, the digest and the parsed boreholes.

    Parameters
    ----------
    path : pathlib.Path
        The spooled report file.
    file_name : str
        The name the user picked it under (for the stored provenance).
    digest : BoreholeReportDigest
        What the triage found.
    boreholes : dict
        Borehole key (``"<name>@p<first page>"``) -> the parsed borehole. A
        borehole of a triage-only profile (it reads no rows) has no entry.
    """

    path: Path
    file_name: str
    digest: BoreholeReportDigest
    boreholes: dict[str, DigitisedBorehole]

    @property
    def report_sha(self) -> str:
        """Return the SHA-256 hex of the report (the store's key)."""
        return self.digest.file_sha

    def to_triage_dict(self) -> dict[str, Any]:
        """Return what the import dialog lists: the digest plus, per borehole, its parse.

        Every borehole row of the digest gains ``parsed`` (the profile read its
        rows), ``n_intervals`` / ``n_samples``, ``water_level_m`` and
        ``water_unit_assumed`` (ruling 4), ``findings`` (every finding of the
        parse as level / code / message / params: the dialog words them in the
        app language from the code) and ``importable`` (parsed, with a position
        and a ground level). The per-page verdicts are left out: the dialog
        shows the class counts.

        Returns
        -------
        dict
            JSON-ready.
        """
        data = self.digest.to_dict()
        data.pop("pages", None)
        data["file_name"] = self.file_name
        rows: list[dict[str, Any]] = []
        for row in data["boreholes"]:
            parsed = self.boreholes.get(row["key"])
            findings = (
                [
                    {
                        "level": i.level.value,
                        "code": i.code,
                        "message": i.message,
                        "params": i.params,
                    }
                    for i in parsed.issues
                ]
                if parsed is not None
                else []
            )
            water = parsed.water_levels[0] if parsed is not None and parsed.water_levels else None
            blocked = any(f["code"] in IMPORT_BLOCKING_ISSUES for f in findings)
            rows.append(
                {
                    **row,
                    "parsed": parsed is not None,
                    "n_intervals": len(parsed.intervals) if parsed is not None else 0,
                    "n_samples": len(parsed.samples) if parsed is not None else 0,
                    "water_level_m": water.depth_m if water is not None else None,
                    "water_unit_assumed": water.unit_assumed if water is not None else False,
                    "findings": findings,
                    "importable": parsed is not None and not blocked,
                }
            )
        data["boreholes"] = rows
        return data
