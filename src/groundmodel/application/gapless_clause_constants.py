"""Constants for the seven-clause gapless gate.

THE SEVEN PROMISES LIVE HERE AND NOWHERE ELSE.  The renderer computes clauses
1-4 and the backend clauses 5-7, but only this module names them: the backend
re-stamps every clause's number and title from these tables before the report is
stored or returned, so a title cannot drift between the two languages.  The
TypeScript side carries the matching *keys* only —
``desktop/src/renderer/src/utils/gaplessGate/types.ts``.

It sits in the APPLICATION layer, not beside the API schemas, because the use
case that assembles the report needs it and application code must never import
from the API.  The API schema module imports its literal types from here, which
is the legal direction.

The titles are written as PROMISES KEPT, not as defects found ("Every column
inside the model footprint carries material", never "empty columns").  A report
that passes then reads as a list of guarantees, which is what the owner's
constraint actually is; a report that fails reads as the same list with the
broken promise struck through.
"""

from typing import Final, Literal

GaplessClauseKey = Literal[
    "area-conservation",
    "edge-reach",
    "cause-closure",
    "section-closure",
    "column-totality",
    "stack-voids",
    "section-reconciliation",
]

GaplessClauseStatus = Literal["pass", "fail", "not-evaluated"]

GaplessVerdict = Literal["pass", "fail", "incomplete"]

GaplessMeasureUnit = Literal["m", "m2", "count"]

# The clause order IS the report order and the numbering. Appending a clause is
# additive; renumbering an existing one is not — the number is quoted in owner
# conversations and in the banner, so it is part of the contract.
GAPLESS_CLAUSE_ORDER: Final[tuple[GaplessClauseKey, ...]] = (
    "area-conservation",
    "edge-reach",
    "cause-closure",
    "section-closure",
    "column-totality",
    "stack-voids",
    "section-reconciliation",
)

GAPLESS_CLAUSE_TITLES: Final[dict[GaplessClauseKey, str]] = {
    "area-conservation": "Classed and unclassed ground add up to the litho cover",
    "edge-reach": "The 3-D build can read the fill at every column edge",
    "cause-closure": "Every patch of unclassed ground has a known cause",
    "section-closure": "Every section in the model reached the build",
    "column-totality": "Every column inside the model footprint carries material",
    "stack-voids": "No column has an interior void above the hairline limit",
    "section-reconciliation": "The 3-D model holds the ground its sections classed",
}

# Which half of the build owns each clause. Used to write an honest
# ``not_evaluated_reason`` when one half never ran: a litho build sends no 2-D
# clauses, and a checksum-skipped build labels no grid.
GAPLESS_2D_CLAUSES: Final[tuple[GaplessClauseKey, ...]] = (
    "area-conservation",
    "edge-reach",
    "cause-closure",
    "section-closure",
)

GAPLESS_3D_CLAUSES: Final[tuple[GaplessClauseKey, ...]] = (
    "column-totality",
    "stack-voids",
    "section-reconciliation",
)

# Why a 2-D clause was not measured, when the payload carried none. Stated as
# the fact observed, not as an excuse: the caller sent nothing.
NO_2D_CLAUSES_REASON: Final[str] = (
    "the build payload carried no 2-D gate result — either a lithology build "
    "(which runs no packing fill) or a client older than the gate"
)

# Why a 3-D clause was not measured, when no grid was labelled.
NO_GRID_REASON: Final[str] = (
    "no voxel grid was labelled by this build — either the build produced "
    "nothing at all, or the partition payload was unchanged and the build was "
    "not forced, so the 3-D model on screen is the previous build's"
)

# Why clause 7 alone was not measured, when a grid WAS labelled but the check
# did not run. Distinct from NO_GRID_REASON on purpose: "we could not check it"
# and "there was nothing to check" are different facts and the engineer acts on
# them differently.
NO_RECONCILIATION_REASON: Final[str] = "the 2-D↔3-D comparison did not run for this build"
