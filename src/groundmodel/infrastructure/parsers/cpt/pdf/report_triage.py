"""ReportTriage: the per-page verdicts of one report."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from groundmodel.infrastructure.parsers.cpt.pdf.cpt_origin import CptOrigin
from groundmodel.infrastructure.parsers.cpt.pdf.page_class import PageClass
from groundmodel.infrastructure.parsers.cpt.pdf.page_evidence import PageEvidence
from groundmodel.infrastructure.parsers.cpt.pdf.report_fingerprint import ReportFingerprint


@dataclass(frozen=True)
class ReportTriage:
    """Every page's evidence plus the report's campaign fingerprint.

    Parameters
    ----------
    pages : tuple of PageEvidence
        One entry per page, in page order.
    fingerprint : ReportFingerprint
        The campaign the report is about.
    """

    pages: tuple[PageEvidence, ...]
    fingerprint: ReportFingerprint

    def class_counts(self) -> dict[PageClass, int]:
        """Return how many pages fall in each class.

        Returns
        -------
        dict
            PageClass -> count.
        """
        return dict(Counter(p.page_class for p in self.pages))

    def origin_counts(self) -> dict[CptOrigin, int]:
        """Return how many CPT graph pages have each origin.

        Returns
        -------
        dict
            CptOrigin -> count, over CPT graph pages only.
        """
        return dict(
            Counter(
                p.origin for p in self.pages if p.page_class is PageClass.CPT_GRAPH and p.origin
            )
        )
