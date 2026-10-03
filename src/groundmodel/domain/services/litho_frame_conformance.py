"""Pure helper: does a packing tie conform to the litho frame?

Owner order (2026-08-21, after deleting a silt-to-clay packing tie whose
ground the render never showed): *"next time flag a tie like that when it
doesn't conform to the litho model!"*

A packing (geotech) tie subdivides ground INSIDE the litho frame — it can
only band two bands whose parent litho units the litho model connects.  Two
cases can never band, however lawful the tie is as a surface statement
(the 2026-08-04 shared-adjacent-body ruling keeps admitting those):

* the parent units are DIFFERENT SOILS — one mass across soils does not
  exist at any stage;
* the parent units are DIFFERENT LITHO UNITS of one soil (ZAND and ZAND
  (SL:M)) — owner 2026-10-03: *"a zand and zand/matig siltig are 2 different
  lithologies, never weld those"*, so the tie is a surface statement only;
* the parent units are the same soil but carry NO litho correlation path —
  the litho frame closes each family separately, so the packing tie's line
  crosses ground the frame will never open (the owner's S11 silt: two
  drawn packing ties, rendered as an onlap because the silt litho unit was
  never litho-correlated).

The check WARNS — it never refuses.  The tie is still written (a surface
statement is legitimate), but the engineer is told at draw time instead of
discovering an "onlap that should band" on the canvas.

Pure module — no I/O, no logger, no session.  The caller resolves parent
units, soils and litho-tie connectivity before invoking.
"""

from __future__ import annotations

#: ``review_reason`` token stamped on a flagged edge — renders as the violet
#: review badge, cleared by the existing Confirm-tie flow.
FRAME_MISMATCH_REVIEW_REASON = "frame_mismatch"


def frame_tie_warning(
    *,
    soil_a: str | None,
    soil_b: str | None,
    litho_connected: bool,
    band_a: str,
    band_b: str,
    same_litho_unit: bool | None = None,
) -> str | None:
    """Return the draw-time warning for a non-conforming packing tie, or ``None``.

    Parameters
    ----------
    soil_a : str | None
        Main soil code of band A's parent litho unit (``None`` = unresolved).
    soil_b : str | None
        Main soil code of band B's parent litho unit (``None`` = unresolved).
    litho_connected : bool
        Whether an accepted litho correlation path connects the two parent
        units in the parent litho model.
    band_a : str
        Human description of band A (column + depths — never ids).
    band_b : str
        Human description of band B.
    same_litho_unit : bool | None
        Whether the two parents are the same litho unit (formation row).
        ``False`` warns even for a litho-connected same-soil pair: two units
        never become one mass (owner 2026-10-03). ``None`` = not resolved,
        which is not evidence of non-conformance.

    Returns
    -------
    str | None
        The warning sentence to surface at draw time, or ``None`` when the
        tie conforms (or a parent could not be resolved — an unresolved
        parent is not evidence of non-conformance).
    """
    if soil_a is None or soil_b is None:
        return None
    if soil_a != soil_b:
        return (
            f"This tie links different soils ({band_a} ↔ {band_b}) - it can "
            f"state a shared surface, but the two bands can never become one "
            f"mass. The fill will not band them."
        )
    if same_litho_unit is False:
        return (
            f"This tie links different litho units ({band_a} ↔ {band_b}) - it "
            f"can state a shared surface, but the two bands can never become "
            f"one mass. The fill will not band them."
        )
    if not litho_connected:
        return (
            f"The litho model does not connect the units of {band_a} and "
            f"{band_b} - the frame will not band them. Correlate the litho "
            f"units first if they should read as one mass."
        )
    return None
