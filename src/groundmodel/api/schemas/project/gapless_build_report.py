"""Wire schemas for the seven-clause gapless gate.

The gate answers one question per build: *does the model this build produced
keep the owner's guarantee that it has no gaps and no fallbacks except where a
user made a mistake?*  It **fails the report loudly and never the build** — the
solids are written either way, and the engineer is shown which section and which
gap to look at.

Four shapes, mirroring
``desktop/src/renderer/src/utils/gaplessGate/types.ts`` field for field:

* :class:`GaplessMeasureSchema` — a number a finding claims something about.
* :class:`GaplessClauseEntrySchema` — one named spot a clause was broken at.
* :class:`GaplessClauseInputSchema` — what the renderer says about clause 1-4:
  substance only, no name.  The backend re-stamps the number and the title from
  ``gapless_build_report_constants`` so the seven promises have one home.
* :class:`GaplessClauseSchema` / :class:`GaplessBuildReportSchema` — the
  assembled report, as stored on the build generation and returned to the
  client.

Every field is additive on both endpoints it touches, so a client that predates
the gate sends nothing and reads nothing.
"""

from typing import Any

from pydantic import BaseModel, Field

from groundmodel.application.gapless_clause_constants import (
    GaplessClauseKey,
    GaplessClauseStatus,
    GaplessMeasureUnit,
    GaplessVerdict,
)


class GaplessMeasureSchema(BaseModel):
    """A number a clause entry is making a claim about.

    Attributes
    ----------
    value : float
        The measured quantity.
    unit : {'m', 'm2', 'count'}
        What it is measured in — metres, square metres, or a plain tally.
    budget : float or None
        What the value was allowed to be, where the clause has a derived
        allowance (clause 7's vertical-quantisation budget, clause 6's hairline
        limit).  ``None`` where the clause forbids the thing outright, which is
        most of them.
    """

    value: float
    unit: GaplessMeasureUnit
    budget: float | None = None


class GaplessClauseEntrySchema(BaseModel):
    """One named spot a clause was broken at.

    Attributes
    ----------
    label : str
        One line in the engineer's own vocabulary.  Never a variable name — the
        banner prints this verbatim.
    section_id : str or None
        The cross-section row id, where the finding stands on one.
    section_name : str or None
        Its display name, so the line reads without a lookup.
    gap_index : int or None
        The frame gap index within that section.
    gap_investigation_ids : list of str or None
        The two investigations whose columns the gap stands between, in axis
        order — what a reader NAVIGATES by.  ``gap_index`` above is a label the
        sentence quotes; it indexes the litho frame's column list and nothing
        else, so it cannot be resolved to a position by any other surface.  The
        renderer resolves the pair while the frame is still in scope and sends
        the names; this schema only has to carry them through without dropping
        them.  ``None`` whenever the clause could not name the pair — a
        backend-computed clause, a gap index past the frame's own columns, or a
        report written before this field existed.
    investigation_id : str or None
        A CPT / borehole id, where the finding names one.
    world_x, world_y : float or None
        Project-CRS position, where the finding stands at a map position
        (clause 5 names grid columns, which have no section).
    measure : GaplessMeasureSchema or None
        What the finding measured.
    params : dict or None
        The finding's raw numbers (section index, areas, counts, along-metres,
        millimetres) so the RENDERER composes the sentence in the engineer's
        language — the wire carries data, not English prose.  ``label`` stays
        populated as the fallback for a client that has no composer for this
        clause (backwards compatibility); a renderer that knows the clause key
        prefers ``params``.  ``None`` on a clause that carries no structured
        numbers.

    Notes
    -----
    Every locator is optional because different clauses know different things,
    and a field is populated only when the clause genuinely knows it.  Nothing
    here is guessed to fill a slot.
    """

    label: str
    section_id: str | None = None
    section_name: str | None = None
    gap_index: int | None = None
    gap_investigation_ids: list[str] | None = None
    investigation_id: str | None = None
    world_x: float | None = None
    world_y: float | None = None
    measure: GaplessMeasureSchema | None = None
    params: dict[str, Any] | None = None


class GaplessClauseInputSchema(BaseModel):
    """What the renderer says about one 2-D clause — substance only.

    Carries no ``number`` and no ``title``: naming a clause is the backend's
    job, so the seven promises cannot drift between TypeScript and Python.

    Attributes
    ----------
    key : GaplessClauseKey
        Which clause this is.
    status : {'pass', 'fail', 'not-evaluated'}
        Whether it was kept.  ``not-evaluated`` is a real answer, not a soft
        pass — see :class:`GaplessBuildReportSchema`.
    not_evaluated_reason : str or None
        Why it could not be measured.  Meaningful only on ``not-evaluated``.
    entries : list of GaplessClauseEntrySchema
        The named spots; empty unless the status is ``fail``.
    """

    key: GaplessClauseKey
    status: GaplessClauseStatus
    not_evaluated_reason: str | None = None
    entries: list[GaplessClauseEntrySchema] = Field(default_factory=list)


class GaplessClauseSchema(GaplessClauseInputSchema):
    """One clause as the backend assembled it — substance plus its name.

    Attributes
    ----------
    number : int
        1-7, the clause's number in the guarantee.  Stable across versions: it
        is quoted in the banner and in owner conversations, so it is part of the
        contract.
    title : str
        The promise this clause keeps, stated positively.
    """

    number: int
    title: str


class GaplessBuildReportSchema(BaseModel):
    """The whole gate, one per build.

    Attributes
    ----------
    verdict : {'pass', 'fail', 'incomplete'}
        ``fail`` when any clause failed.  ``incomplete`` when none failed but at
        least one could not be measured — deliberately NOT green, because an
        unmeasured clause is an unkept promise until it is measured.  ``pass``
        only when all seven were measured and all seven held.
    clauses : list of GaplessClauseSchema
        All seven, always, in clause-number order — including the unmeasured
        ones.  A report that silently omits a clause is indistinguishable from a
        report that passed it.
    generated_at : str
        ISO-8601 UTC instant the report was assembled.
    """

    verdict: GaplessVerdict
    clauses: list[GaplessClauseSchema]
    generated_at: str
