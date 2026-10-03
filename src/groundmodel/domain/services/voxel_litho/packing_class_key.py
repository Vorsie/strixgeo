"""Formation-row → packing-class identity key for the geotech body merge.

Since R1 (owner 2026-08-31, debt #278) the geotech model stores one
geological_formation ROW per (NAD packing class, litho parent) — the GEOLOGICAL
parent is a live-derived LABEL, not identity, so a litho unit spanning a
geological boundary keeps ONE row. Owner ruling 2026-08-21 (*"yes one mass one
body"*): in the 3-D voxel PAINT, two regions of the same class OF THE SAME LITHO
UNIT are ONE mass and one body. Owner ruling 2026-10-03 (*"a zand and zand/matig
siltig are 2 different lithologies, never weld those"*): the litho unit is part
of the mass identity, so a NAD-6 ZAND and a NAD-6 ZAND (SL:M) never collapse.
This module writes down the row → class translation once (still robust to
legacy pre-R1 geo-label twins — two rows of one class collapse to one key), so
the cross-section body merge for the voxel paint
(:func:`~groundmodel.domain.services.voxel_litho.merge_bodies_across_sections.plan_body_aliases`)
compares the same identity the 2-D fill does.

NOTE this collapse feeds the 3-D voxel PAINT path ONLY. The persisted body
IDENTITY engine (``plan_layer_groups`` / the recompute) went permanently
granular (owner 2026-09-01) and takes NO key — it keys on the raw formation
row, so same-class masses under different rows stay distinct bodies. The
divergence is deliberate.

This is the domain twin of the frontend
``desktop/src/renderer/src/utils/geotechHierarchicalFill/packingClassOf.ts``
(``buildPackingClassOf``): identical rule, identical ``LITHOUNIT|SOIL|CLASS`` key shape,
so the backend body merge and the frontend fill agree on what "same body" means.

Pure domain module — no I/O, no framework imports, no ORM types. It computes; it
does not act, so nothing inherits ``GroundModelLogger``.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable

__all__ = ["packing_class_key_of"]


def packing_class_key_of(
    rows: Iterable[tuple[str, int | None, str | None, str | None]],
) -> Callable[[str], str]:
    """Build the formation-id → packing-class-key function the merge compares by.

    Parameters
    ----------
    rows : iterable of (str, int or None, str or None, str or None)
        One ``(formation_id, nad_class, litho_main_soil_code,
        source_litho_formation_id)`` row per geotech formation of the project.
        PLAIN tuples, never ORM rows: the domain layer stays free of
        infrastructure, so the application layer projects its query columns to
        strings/ints before calling.

    Returns
    -------
    callable of (str) -> str
        Maps a formation id to ``f"{litho_unit}|{soil_code}|{nad_class}"`` when
        the row carries BOTH a NAD class and a soil code (``f"{soil_code}|
        {nad_class}"`` when its litho unit is unknown), and to the id UNCHANGED
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
    for formation_id, nad_class, soil_code, litho_unit_id in rows:
        if nad_class is not None and soil_code is not None:
            # The litho unit leads the key: two litho units never weld (owner
            # 2026-10-03), however equal their soil and class.
            class_key = f"{soil_code}|{nad_class}"
            class_by_id[formation_id] = (
                class_key if litho_unit_id is None else f"{litho_unit_id}|{class_key}"
            )

    def key_of(formation_id: str) -> str:
        """Return the collapsed class key, or the id itself when unknown."""
        return class_by_id.get(formation_id, formation_id)

    return key_of
