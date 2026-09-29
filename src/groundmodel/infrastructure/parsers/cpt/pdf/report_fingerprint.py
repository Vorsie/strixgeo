"""ReportFingerprint: which campaign a report is about."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ReportFingerprint:
    """The campaign identity used to tell own soundings from reprints.

    Parameters
    ----------
    campaign_codes : tuple of str
        Campaign codes the report is about ("CAMZ-001"), found as the most
        frequent campaign-code token of the whole report (the running header
        repeats it on nearly every page) or given by the caller.
    project_numbers : tuple of str
        Contractor project numbers seen on the campaign's own sheets
        ("23.15-002"); a sheet carrying one of them is campaign too.
    """

    campaign_codes: tuple[str, ...] = field(default_factory=tuple)
    project_numbers: tuple[str, ...] = field(default_factory=tuple)

    def names(self, *values: str | None) -> bool:
        """Return whether any value mentions a campaign code or project number.

        Parameters
        ----------
        *values : str or None
            Sounding-block field values.

        Returns
        -------
        bool
            True on a mention.
        """
        tokens = self.campaign_codes + self.project_numbers
        return any(v and any(t in v for t in tokens) for v in values)
