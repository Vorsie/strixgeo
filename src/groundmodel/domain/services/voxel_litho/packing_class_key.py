"""Formation-row → packing-class identity key for the geotech body merge.

Since R1 (owner 2026-08-31, debt #278) the geotech model stores one
geological_formation ROW per (NAD packing class, litho parent) — the GEOLOGICAL
parent is a live-derived LABEL, not identity, so a litho unit spanning a
geological boundary keeps ONE row. Owner ruling 2026-08-21 (*"yes one mass one
body"*): two regions of the same class tied together are ONE mass and one body.
This module writes down the row → class translation once (still robust to legacy
pre-R1 geo-label twins — two rows of one class collapse to one key), so the
cross-section body merge
(:func:`~groundmodel.domain.services.voxel_litho.merge_bodies_across_sections.plan_body_aliases`
and :func:`...plan_layer_groups`) compares the same identity the 2-D fill does.

This is the domain twin of the frontend
``desktop/src/renderer/src/utils/geotechHierarchicalFill/packingClassOf.ts``
(``buildPackingClassOf``): identical rule, identical ``SOIL|CLASS`` key shape,
so the backend body merge and the frontend fill agree on what "same body" means.

Pure domain module — no I/O, no framework imports, no ORM types. It computes; it
does not act, so nothing inherits ``GroundModelLogger``.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable

__all__ = ["packing_class_key_of"]


def packing_class_key_of(
    rows: Iterable[tuple[str, int | None, str | None]],
) -> Callable[[str], str]:
    """Build the formation-id → packing-class-key function the merge compares by.

    Parameters
    ----------
    rows : iterable of (str, int or None, str or None)
        One ``(formation_id, nad_class, litho_main_soil_code)`` triple per
        geotech formation of the project. PLAIN triples, never ORM rows: the
        domain layer stays free of infrastructure, so the application layer
        projects its query columns to strings/ints before calling.

    Returns
    -------
    callable of (str) -> str
        Maps a formation id to ``f"{soil_code}|{nad_class}"`` when the row
        carries BOTH a NAD class and a soil code, and to the id UNCHANGED
        otherwise — including any id not present among ``rows``, so the callable
        is safe to apply to every region's formation blind.

        A formation missing EITHER half of its identity (no NAD class — a
        skeleton band over unread ground — or no soil code) keeps its own row
        id: "two unknowns are not known to be the same density", so it never
        welds across rows. Collapsing a missing half to a placeholder token
        would silently weld two formations that share a class but were never
        shown to share a soil. This mirrors the same guard in
        :mod:`~groundmodel.domain.services.resolve_litho_instances` and the
        frontend twin ``packingClassOf.ts``.
    """
    class_by_id: dict[str, str] = {}
    for formation_id, nad_class, soil_code in rows:
        if nad_class is not None and soil_code is not None:
            class_by_id[formation_id] = f"{soil_code}|{nad_class}"

    def key_of(formation_id: str) -> str:
        """Return the collapsed class key, or the id itself when unknown."""
        return class_by_id.get(formation_id, formation_id)

    return key_of
