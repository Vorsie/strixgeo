"""What a column's geotech bands were derived FROM, and whether it still holds.

Debt #266: a geotech packing band-set has no dependency link back to the litho
stack it subdivides.  Drag one litho contact and every band inside that column
silently describes a lithology stack that no longer exists — nothing marks it,
nothing warns, and an export ships stale packing to a client.

The link this module provides is a **digest of the column's litho stack**: the
ordered accepted intervals and the lithology of each, reduced to one short
string.  A geotech press stamps the digest it built from; a later read
recomputes today's digest and compares.  Differing means the ground moved.

Why a digest of the stack rather than a counter each litho verb bumps
---------------------------------------------------------------------
Because #266 IS a missed dependency link, and a counter reproduces that bug
class on the next verb someone writes.  Two facts about this codebase make the
counter unworkable in particular:

* Over forty verbs mutate litho, and several cannot name the columns they
  touched — ``UpdateFormationContact`` holds only a contact id,
  ``BatchUpdateLithoLayers`` only layer ids, ``PropagateLithoAdmixtures`` walks
  a correlation graph.
* Litho writes are mirrored by DB triggers in BOTH directions
  (``mirror_litho_layer_to_contact`` / the contact→layer pair), and the
  contiguity trigger rewrites a NEIGHBOUR row's ``depth_base_m`` without
  touching its ``updated_at``.  #266 documents that trap directly.  A verb that
  bumped only what it wrote would miss exactly the rows the trigger moved.

A digest is computed FROM the rows as they now stand, so it cannot be bypassed
by a verb that did not know geotech existed, nor by a trigger firing behind one.

It also follows the pattern this codebase already names "the #266 compare-on-
load pattern" on ``geological_model.classified_with_statistic``: stamp what the
build used, derive the staleness, never store a flag that needs clearing.

Scope, stated honestly
----------------------
This answers *"has this column's litho stack moved since its bands were made?"*
— the failure the debt entry describes.  It does NOT answer the second-order
question *"has a body-wide aggregate shifted because a DIFFERENT column in the
same body was edited?"*.  Body regrouping and correlation edits change lateral
grouping, not a column's own intervals, so they are deliberately quiet here:
flagging every column of a body on every edit anywhere is the alarm-fatigue
failure, and the engineer would learn to ignore the one warning that matters.

Pure: no I/O, no ORM, no logging.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable, Mapping, Set
from dataclasses import dataclass

from groundmodel.domain.services.litho_column_digest_constants import (
    LITHO_DIGEST_DEPTH_DECIMALS,
    LITHO_DIGEST_FIELD_SEPARATOR,
    LITHO_DIGEST_RECORD_SEPARATOR,
    LITHO_DIGEST_SIZE_BYTES,
    LITHO_DIGEST_VERSION,
)


@dataclass(frozen=True)
class LithoColumnInterval:
    """One accepted litho interval on one column, as the geotech press reads it.

    Attributes
    ----------
    depth_top_m : float
        Interval top, metres below the collar.
    depth_base_m : float
        Interval base, metres below the collar.
    formation_id : str
        The litho formation (the unit) this interval belongs to.  Identity, not
        label: renaming a formation or editing its admixtures leaves the id
        alone, and the geotech unit points at the same row, so the bands stay
        correct.  Re-classifying an interval to a DIFFERENT soil re-points
        ``formation_id`` and the bands do not.
    """

    depth_top_m: float
    depth_base_m: float
    formation_id: str


def _canonical_record(interval: LithoColumnInterval) -> str:
    """Render one interval to its depth-rounded canonical form."""
    # ``+ 0.0`` normalises a rounded ``-0.0`` to ``0.0`` so two equal stacks can
    # never differ by a sign that no depth actually carries.
    top = round(interval.depth_top_m, LITHO_DIGEST_DEPTH_DECIMALS) + 0.0
    base = round(interval.depth_base_m, LITHO_DIGEST_DEPTH_DECIMALS) + 0.0
    return LITHO_DIGEST_FIELD_SEPARATOR.join(
        (
            f"{top:.{LITHO_DIGEST_DEPTH_DECIMALS}f}",
            f"{base:.{LITHO_DIGEST_DEPTH_DECIMALS}f}",
            interval.formation_id,
        )
    )


def litho_column_digest(intervals: Iterable[LithoColumnInterval]) -> str:
    """Reduce one column's litho stack to a comparable tag.

    Sorted before hashing, so the answer is a fact about the stack and never
    about the order rows came back in.  An empty stack is a legal reading with
    its own answer — that is what makes bands over a cleared column *stale*
    rather than *unknown*.

    Parameters
    ----------
    intervals : Iterable[LithoColumnInterval]
        The column's accepted intervals, in any order.

    Returns
    -------
    str
        ``"<version>:<hex>"``.  Equal digests mean the same stack at millimetre
        resolution; different digests mean it moved, was re-classified, or was
        added to / removed from.
    """
    records = sorted(_canonical_record(i) for i in intervals)
    canonical = LITHO_DIGEST_RECORD_SEPARATOR.join(records)
    hexdigest = hashlib.blake2b(
        canonical.encode("utf-8"), digest_size=LITHO_DIGEST_SIZE_BYTES
    ).hexdigest()
    return f"{LITHO_DIGEST_VERSION}:{hexdigest}"


def stale_column_ids(
    *,
    stamps: Mapping[str, str],
    current: Mapping[str, str],
) -> tuple[str, ...]:
    """Name the columns whose litho moved after their bands were made.

    A column is stale when it HAS a record of what its bands were built from and
    that record disagrees with the ground today — including the case where the
    litho is gone entirely (absent from *current*), which is the strongest form
    of "describing a stack that no longer exists".

    A column with no record is NOT stale.  Every project banded before this
    shipped is in that state, and calling them stale would flag whole models on
    first open and teach the engineer the indicator means nothing.  This is the
    same reading ``classified_with_statistic`` gives NULL: no build yet, so no
    claim, so no alarm.

    Parameters
    ----------
    stamps : Mapping[str, str]
        Column id → the digest recorded when that column's bands were built.
    current : Mapping[str, str]
        Column id → the digest of the litho stack under it now.

    Returns
    -------
    tuple[str, ...]
        Stale column ids, sorted, so two reads present the same list.
    """
    return tuple(sorted(column for column, stamp in stamps.items() if current.get(column) != stamp))


def next_stamp_map(
    *,
    previous: Mapping[str, str],
    rebuilt_digests: Mapping[str, str],
    banded_column_ids: Set[str],
) -> dict[str, str]:
    """Fold a press's results into the stored provenance map.

    Three rules, one per way a column can leave a press:

    * **Rebuilt** — take the fresh digest.  This is what makes re-pressing the
      only way to clear the warning, and it clears by construction: there is no
      acknowledge button that would let the engineer dismiss it without doing
      the thing it asks for.
    * **Left alone** — keep the old digest.  Boreholes and CPTs are banded by
      two different presses; a borehole press that cleared the CPT columns would
      report a moved column as fine.  A column ``skip_existing`` protected is
      the same case: its bands really were made from the old stack.
    * **No bands any more** — drop it.  A count that includes columns with
      nothing on them sends the engineer to press a verb with nothing to
      rebuild.

    A column that has bands but appears in neither *previous* nor
    *rebuilt_digests* stays unstamped: the press must not invent provenance for
    bands it did not build, because the guess would be wrong exactly when the
    ground HAS moved.

    Parameters
    ----------
    previous : Mapping[str, str]
        The map as stored before this press.
    rebuilt_digests : Mapping[str, str]
        Column id → digest, for the columns this press actually (re)built.
    banded_column_ids : Set[str]
        Every column carrying at least one band after the press.

    Returns
    -------
    dict[str, str]
        The map to store.
    """
    folded: dict[str, str] = {}
    for column in banded_column_ids:
        fresh = rebuilt_digests.get(column)
        if fresh is not None:
            folded[column] = fresh
        elif column in previous:
            folded[column] = previous[column]
    return folded
