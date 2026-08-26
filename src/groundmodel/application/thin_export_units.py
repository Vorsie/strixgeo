"""Use case — merge adjacent same-NAD units for readability (debt #104b).

Owner ruling 2026-08-26, verbatim: *"thin in dxf and pdf, keep plaxis
exact, shallower parent name wins."*

Why the duplicate units exist
-----------------------------
The geotech find-or-create keys a unit on ``(nad_class,
source_litho_formation_id, source_geo_formation_id)``, so same-class
bands *within* one litho parent already share a formation row. Two
stacked units of the SAME class therefore mean two different litho or
geological parents — Quaternary sand of NAD 6 resting on Diest sand of
NAD 6. That boundary is real geology, but it carries no NAD meaning, and
in a delivered DXF or PDF it reads as two materials where the engineer
has one.

Why Plaxis is left exact
------------------------
Both Plaxis exporters emit ONE globally ordered ``soillayer`` stack,
indexed once and reused by every borehole. If a merged unit were ever
interleaved — same class above and below a different unit somewhere on
the section — one global layer would have to appear twice in a column,
which the Plaxis model cannot express. The ruling settles it: the script
stays exact, and the mapping table it already carries names every unit
separately.

What "adjacent" means here — the ONE definition
-----------------------------------------------
``SectionSnapshot`` carries no polygons. A unit's geometry is the set of
TOP contacts it has across the projected columns; the unit occupies the
interval from its own top contact down to the next contact at that same
column. So, at one column, unit B is *directly below* unit A iff B's
contact is the immediate successor of A's when that column's contacts
are sorted by depth.

Lifting that to the section, A and B merge iff ALL of:

1. both carry the same non-null ``unit_identifier`` (same NAD class and
   soil — the ruling's "identical NAD parameters");
2. they share at least one column, so there IS evidence about their
   relationship (two disjoint bodies of one class are not one unit);
3. at EVERY column where both appear, B is A's immediate successor. One
   column with a third unit wedged between them vetoes the merge — that
   is the interleave case, and it is exactly the case Plaxis could not
   express either;
4. the shallower/deeper roles are consistent across those columns. A
   unit that is above its partner in one column and below it in another
   is interfingering, not a duplicate, and is left alone.

The merge itself is then a deletion: drop the deeper unit's top contacts
and its formation row. The surviving shallower unit's interval
automatically runs down to whatever lay below the deeper one, because
that is how every consumer derives a unit's extent. Nothing is
recomputed, so nothing can drift.
"""

from __future__ import annotations

from dataclasses import replace
from uuid import UUID

from groundmodel.application.section_snapshot import (
    SectionFormation,
    SectionFormationContact,
    SectionSnapshot,
)
from groundmodel.infrastructure.exporters.unit_identifier import unit_identifier
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class ThinExportUnits(GroundModelLogger):
    """Collapse adjacent units that share a NAD class and soil."""

    def __init__(self) -> None:
        """Initialise with the standard module-named logger."""
        super().__init__(__name__)

    def execute(self, snapshot: SectionSnapshot) -> SectionSnapshot:
        """Return a snapshot with adjacent same-identifier units merged.

        Runs to a fixpoint, so a stack of three same-class units
        collapses to one rather than two.

        Parameters
        ----------
        snapshot : SectionSnapshot
            The assembled section geometry. Not mutated — the snapshot
            is a frozen value object and the caller may still need the
            unthinned one (the Plaxis export does).

        Returns
        -------
        SectionSnapshot
            A new snapshot with the merged units removed and each
            survivor carrying the names it absorbed. The SAME object is
            returned when nothing merges, so the geological and litho
            paths pay nothing.
        """
        self.debug(
            f"Thinning export units: section={snapshot.section_id} "
            f"formations={len(snapshot.formations)} contacts={len(snapshot.contacts)}"
        )

        formations = list(snapshot.formations)
        contacts = list(snapshot.contacts)
        absorbed_by: dict[UUID, list[str]] = {}

        # Fixpoint: one merge can make a new pair adjacent (A-B-C all of
        # one class — absorbing B leaves A directly on C).
        merged_total = 0
        while True:
            pair = self._first_mergeable_pair(formations, contacts)
            if pair is None:
                break
            survivor_id, absorbed = pair
            absorbed_by.setdefault(survivor_id, []).extend(
                [absorbed.name, *absorbed.absorbed_unit_names]
            )
            formations = [f for f in formations if f.formation_id != absorbed.formation_id]
            contacts = [c for c in contacts if c.formation_id != absorbed.formation_id]
            merged_total += 1
            self.debug(
                f"Merged unit {absorbed.name!r} ({absorbed.formation_id}) into "
                f"{survivor_id} — same identifier, directly adjacent at every shared column"
            )

        if not merged_total:
            self.debug("Thinning merged nothing — no adjacent same-identifier units")
            return snapshot

        formations = [
            replace(f, absorbed_unit_names=tuple(absorbed_by[f.formation_id]))
            if f.formation_id in absorbed_by
            else f
            for f in formations
        ]
        self.success(
            f"Export units thinned: section={snapshot.section_id} "
            f"merged={merged_total} "
            f"formations={len(snapshot.formations)}->{len(formations)} "
            f"contacts={len(snapshot.contacts)}->{len(contacts)}"
        )
        return replace(snapshot, formations=formations, contacts=contacts)

    def _first_mergeable_pair(
        self,
        formations: list[SectionFormation],
        contacts: list[SectionFormationContact],
    ) -> tuple[UUID, SectionFormation] | None:
        """Find one ``(survivor_id, absorbed_formation)`` pair, or ``None``.

        Returns the first pair in snapshot order so the result is
        deterministic across runs; the caller re-scans after each merge.
        """
        by_id = {f.formation_id: f for f in formations}
        # formation_id -> the id directly beneath it, per column.
        below = _successor_by_column(contacts)

        for shallow in formations:
            identifier = unit_identifier(
                nad_class=shallow.nad_class,
                litho_main_soil_code=shallow.litho_main_soil_code,
            )
            if identifier is None:
                continue
            for candidate_id in _candidates_below(shallow.formation_id, below):
                deep = by_id.get(candidate_id)
                if deep is None:
                    continue
                deep_identifier = unit_identifier(
                    nad_class=deep.nad_class,
                    litho_main_soil_code=deep.litho_main_soil_code,
                )
                if deep_identifier != identifier:
                    continue
                if _adjacent_everywhere(shallow.formation_id, deep.formation_id, contacts, below):
                    return shallow.formation_id, deep
        return None


def _successor_by_column(
    contacts: list[SectionFormationContact],
) -> dict[UUID, dict[UUID, UUID]]:
    """Map ``investigation_id -> {formation_id: formation directly below}``.

    Built once per scan from the column's contacts sorted by depth — the
    snapshot's only statement about vertical order.
    """
    by_column: dict[UUID, list[SectionFormationContact]] = {}
    for c in contacts:
        by_column.setdefault(c.investigation_id, []).append(c)

    successors: dict[UUID, dict[UUID, UUID]] = {}
    for investigation_id, column in by_column.items():
        ordered = sorted(column, key=lambda c: c.depth_m)
        successors[investigation_id] = {
            ordered[i].formation_id: ordered[i + 1].formation_id for i in range(len(ordered) - 1)
        }
    return successors


def _candidates_below(formation_id: UUID, below: dict[UUID, dict[UUID, UUID]]) -> list[UUID]:
    """Every formation seen directly beneath ``formation_id`` at any column."""
    seen: list[UUID] = []
    for column in below.values():
        candidate = column.get(formation_id)
        if candidate is not None and candidate not in seen:
            seen.append(candidate)
    return seen


def _adjacent_everywhere(
    shallow_id: UUID,
    deep_id: UUID,
    contacts: list[SectionFormationContact],
    below: dict[UUID, dict[UUID, UUID]],
) -> bool:
    """True when ``deep_id`` sits directly under ``shallow_id`` at EVERY
    column where both are present, and at one column at least.

    A single column with a third unit wedged between them returns False —
    that is the interleave case the ruling leaves alone.
    """
    columns_with_shallow = {c.investigation_id for c in contacts if c.formation_id == shallow_id}
    columns_with_deep = {c.investigation_id for c in contacts if c.formation_id == deep_id}
    shared = columns_with_shallow & columns_with_deep
    if not shared:
        return False
    return all(
        below.get(investigation_id, {}).get(shallow_id) == deep_id for investigation_id in shared
    )
