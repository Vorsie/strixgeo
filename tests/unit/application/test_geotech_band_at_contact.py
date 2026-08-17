"""A tie endpoint is a contact — a depth on a column — not a layer plus a side.

Owner, 2026-08-17: *"of course you make a copy and tie it to the actual depth of
the contact? ... Can't work in x,y,z space without using x,y,z coordinates."*

The copy used to name the band by identity and side, and the two ends of one
litho tie are not recorded the same way: one names the layer BELOW the contact
(side ``top``), the other the layer ABOVE it (side ``base``).  So a clay-over-
sand contact on both columns was copied as a clay band tied to a sand band.

The same defect produced every crossing on his model.  All four were
``source='auto'``, and the giveaway is that one CPT contact was tied to two
different borehole depths::

    S9 6.71  ->  B3 6.50      plausible
    S9 6.71  ->  B3 0.00      6.5 m away, same contact

Two lines from one point to points metres apart must cross something.  Resolve
the endpoint by depth and both of those collapse to one.
"""

from uuid import UUID

from groundmodel.application.geotech_edge_derivation import band_at_contact

# (top, base, layer_id, formation_id, nad_class) — the planner's row shape.
S6_STACK = [
    (1.52, 3.79, UUID(int=1), UUID(int=91), 13),
    (3.79, 6.00, UUID(int=2), UUID(int=92), 21),
    (6.00, 8.43, UUID(int=3), UUID(int=93), 6),
    (8.43, 9.82, UUID(int=4), UUID(int=94), 7),
]


def test_bc1_a_contact_resolves_to_the_band_that_starts_there() -> None:
    """His S6 contact at 6.00 m is the sand band's TOP, whatever the tie named."""
    assert band_at_contact(S6_STACK, 6.00) == (UUID(int=3), "top")


def test_bc2_the_deepest_contact_resolves_to_a_base() -> None:
    """Nothing starts at the bottom of the stack, so it is the last band's base."""
    assert band_at_contact(S6_STACK, 9.82) == (UUID(int=4), "base")


def test_bc3_the_top_of_the_stack_resolves_to_the_first_band() -> None:
    assert band_at_contact(S6_STACK, 1.52) == (UUID(int=1), "top")


def test_bc4_a_millimetre_of_slack_is_allowed() -> None:
    """litho_layer stores depths to the millimetre; the two models round alike."""
    assert band_at_contact(S6_STACK, 6.0004) == (UUID(int=3), "top")


def test_bc5_a_depth_that_is_no_contact_resolves_to_nothing() -> None:
    """Mid-band is not a surface, and inventing one is how this went wrong before."""
    assert band_at_contact(S6_STACK, 7.10) is None


def test_bc6_a_depth_outside_the_stack_resolves_to_nothing() -> None:
    assert band_at_contact(S6_STACK, 20.0) is None


def test_bc7_an_empty_stack_resolves_to_nothing() -> None:
    """A column with no packing bands cannot own a packing contact."""
    assert band_at_contact([], 6.00) is None
