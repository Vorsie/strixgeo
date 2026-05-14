"""Validators for the geological model — pure domain logic.

The validator answers two questions:

1. **Per borehole**: do this borehole's formation contacts form a
   contiguous stratigraphy from surface to test depth?
   (``validate_no_gaps``)
2. **Cross-formation**: do any two formation surfaces violate the
   stratigraphic-order superposition rule (younger surface dipping
   below an older one anywhere in the project)?
   (``validate_no_crossings``)

It never raises — bad data is reported as a list of
:class:`GapIssue` items. The editor decides whether to block save
or warn the user.

The first method was lifted out of ``GeologyRepository`` (debt #26):
domain logic does not belong inside an infrastructure file, and a
pure-input shape lets future callers (the model editor's save
batch, the exporter snapshot builder, a hypothetical CLI
linter) validate without touching the database.

Inputs are plain data. The caller (typically a use case or the
repository's loader) maps ORM rows to ``ContactDepth`` /
``FormationSurfaceInput`` before delegating here.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID

from groundmodel.domain.services.tin_surface import TinSurface, evaluate_tin_at
from groundmodel.domain.value_objects.gap_issue import GapIssue
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass(frozen=True)
class ContactDepth:
    """Minimal projection of a formation contact for the validator.

    Carries only the fields the no-gaps check needs — id (so issues
    can point back at the offending row) and depth_top_m. Keeping
    the shape narrow means the validator has no opinion on how
    contacts are stored or rehydrated.
    """

    id: UUID
    depth_top_m: float


@dataclass(frozen=True)
class FormationSurfaceInput:
    """Minimal projection of a formation's TIN for the crossing check.

    Carries the formation's id (so issues can name the offenders),
    its display name (so the issue ``detail`` is readable), its
    stratigraphic order (lower = older — drives the "younger should
    sit above" rule), and the cached TIN. The validator never
    recomputes the TIN; it consumes whatever the cache holds.
    """

    formation_id: UUID
    name: str
    display_order: int
    surface: TinSurface


class GeologyValidator(GroundModelLogger):
    """Pure domain validator for the geological model.

    Stateless; the constructor exists only to wire the
    project-standard logger. Methods take all inputs explicitly so
    the validator can run against ORM rows, domain dataclasses, or
    in-memory editor state with equal ease.
    """

    # Tolerance for the "is this contact at the surface?" check.
    # DOV stratigraphy stores depths to one decimal but real-world
    # surface picks may be a few centimetres off (vegetation cover,
    # soft topsoil). 0.10 m is generous enough to cover honest picks
    # without letting an outright-missing surface formation slip past.
    SURFACE_TOLERANCE_M = 0.10

    # Strict equality on float depths is unreliable; we treat two
    # contacts at the same depth as ambiguous when the absolute
    # difference is below this tolerance. 1 µm is well under the
    # measurement resolution of any real instrument.
    _DUPLICATE_DEPTH_EPSILON_M = 1e-9

    def __init__(self) -> None:
        """Initialise with the project-standard module-named logger."""
        super().__init__(__name__)

    def validate_no_gaps(
        self,
        contacts: Sequence[ContactDepth],
        borehole_total_depth_m: float | None,
    ) -> list[GapIssue]:
        """Check that a borehole's formation contacts form a clean stratigraphy.

        Parameters
        ----------
        contacts : Sequence[ContactDepth]
            Contacts anchored at the borehole, in any order. The
            validator sorts by ``depth_top_m`` internally.
        borehole_total_depth_m : float | None
            Drilled depth of the borehole. When ``None`` the
            "contact below test depth" check is skipped — the
            validator can't anchor the bottom of the column.

        Returns
        -------
        list[GapIssue]
            One issue per problem found. Empty list ⇒ the contacts
            form a valid contiguous stratigraphy.

        Notes
        -----
        Issue kinds emitted:

        * ``no_contacts`` — no formation has been picked for this
          borehole in this model.
        * ``missing_surface_contact`` — shallowest contact is below
          the surface tolerance; the top of the hole has no
          formation assigned.
        * ``duplicate_depth`` — two contacts at the same depth; it's
          ambiguous which formation owns the band below.
        * ``contact_below_test`` — contact depth exceeds the
          borehole's drilled depth; usually a typo or a leftover
          from before the borehole's depth was corrected.
        """
        if not contacts:
            # Not strictly an error (the user may not have started
            # modelling this hole yet) — but worth signalling so the
            # editor can highlight the borehole.
            return [
                GapIssue(
                    kind="no_contacts",
                    detail=("No formation contacts defined for this borehole in this model."),
                )
            ]

        # Sort ascending by depth so consecutive-pair checks are
        # straightforward. Sorting here keeps the contract simple
        # for callers that pull contacts from a free-order source.
        ordered = sorted(contacts, key=lambda c: c.depth_top_m)
        issues: list[GapIssue] = []

        shallowest = ordered[0]
        if shallowest.depth_top_m > self.SURFACE_TOLERANCE_M:
            issues.append(
                GapIssue(
                    kind="missing_surface_contact",
                    detail=(
                        f"Shallowest contact is at {shallowest.depth_top_m:.2f} m; "
                        "no formation defined for the top of the borehole."
                    ),
                    depth_m=shallowest.depth_top_m,
                    contact_ids=(shallowest.id,),
                )
            )

        # Duplicate depths — ambiguous which formation owns the band
        # below. Compare consecutive pairs since the list is sorted.
        for prev, curr in zip(ordered, ordered[1:], strict=False):
            if abs(curr.depth_top_m - prev.depth_top_m) < self._DUPLICATE_DEPTH_EPSILON_M:
                issues.append(
                    GapIssue(
                        kind="duplicate_depth",
                        detail=(f"Two contacts at the same depth {prev.depth_top_m:.2f} m"),
                        depth_m=prev.depth_top_m,
                        contact_ids=(prev.id, curr.id),
                    )
                )

        # Contacts deeper than the test depth — usually a typo or a
        # leftover from before the borehole's depth was corrected.
        if borehole_total_depth_m is not None:
            for c in ordered:
                if c.depth_top_m > borehole_total_depth_m:
                    issues.append(
                        GapIssue(
                            kind="contact_below_test",
                            detail=(
                                f"Contact at {c.depth_top_m:.2f} m is deeper than "
                                f"the borehole's test depth ({borehole_total_depth_m:.2f} m)."
                            ),
                            depth_m=c.depth_top_m,
                            contact_ids=(c.id,),
                        )
                    )

        if issues:
            self.warning(f"validate_no_gaps: {len(issues)} issue(s) on {len(contacts)} contact(s)")
        return issues

    # Two surfaces sampled at the same (x, y) within this many metres
    # of each other don't count as a violation — sub-decimetre overlap
    # is within Delaunay's interpolation noise plus the elevation
    # measurement noise from anchor surveying. 0.01 m (1 cm) is
    # generous enough to absorb noise but small compared to a real
    # geological misordering (which is typically metres).
    CROSSING_TOLERANCE_M = 0.01

    def validate_no_crossings(
        self,
        formations: Sequence[FormationSurfaceInput],
    ) -> list[GapIssue]:
        """Check that no two formation surfaces violate stratigraphic order.

        For every pair (older, younger) where ``older.display_order <
        younger.display_order``, sample each surface's vertices
        against the other's TIN and look for points where the younger
        formation lies BELOW the older — a violation of the geological
        superposition rule. Within ``CROSSING_TOLERANCE_M`` of each
        other counts as touching, not crossing (interpolation noise).

        Parameters
        ----------
        formations : Sequence[FormationSurfaceInput]
            One entry per formation to consider. Formations without a
            triangulated surface (vertices < 3, all collinear) are
            silently skipped — they have no surface to cross.

        Returns
        -------
        list[GapIssue]
            One ``formation_crossing`` issue per offending pair.
            ``formation_ids`` is ``(older_id, younger_id)``;
            ``depth_m`` carries the worst (largest) elevation
            difference (positive metres of "wrong way" overlap).
            Empty list ⇒ stratigraphic order is geologically
            consistent everywhere the surfaces overlap.

        Notes
        -----
        Cost is O(P × V × T) per pair where P is pair count, V is
        sampled vertices, T is target triangles — at v1 cardinality
        (≤ 20 formations × ≤ 200 vertices × ≤ 200 triangles) this is
        well under 100 ms even with no spatial index. Formations
        whose footprints don't overlap produce zero hits, so sparse-
        coverage projects are essentially free.
        """
        issues: list[GapIssue] = []
        # Filter to surfaces that actually have triangles. Equal
        # display_order pairs are skipped (ambiguous order).
        usable = [f for f in formations if f.surface.triangles]
        for i, a in enumerate(usable):
            for b in usable[i + 1 :]:
                if a.display_order == b.display_order:
                    continue
                if a.display_order < b.display_order:
                    older, younger = a, b
                else:
                    older, younger = b, a
                worst_delta = 0.0
                # Sample younger's vertices against older's TIN.
                for vx, vy, vz_y in younger.surface.vertices:
                    vz_o = evaluate_tin_at(older.surface, vx, vy)
                    if vz_o is None:
                        continue
                    # Younger BELOW older = violation. delta is positive
                    # metres of overlap.
                    delta = vz_o - vz_y
                    if delta > self.CROSSING_TOLERANCE_M and delta > worst_delta:
                        worst_delta = delta
                # Symmetric pass: older's vertices against younger's TIN.
                # Catches crossings where younger has no vertex over
                # older's footprint but older has one over younger's.
                for vx, vy, vz_o in older.surface.vertices:
                    vz_y = evaluate_tin_at(younger.surface, vx, vy)
                    if vz_y is None:
                        continue
                    delta = vz_o - vz_y
                    if delta > self.CROSSING_TOLERANCE_M and delta > worst_delta:
                        worst_delta = delta
                if worst_delta > 0.0:
                    issues.append(
                        GapIssue(
                            kind="formation_crossing",
                            detail=(
                                f"Younger formation '{younger.name}' sits below older "
                                f"'{older.name}' by up to {worst_delta:.2f} m — "
                                "violates stratigraphic superposition."
                            ),
                            depth_m=worst_delta,
                            formation_ids=(older.formation_id, younger.formation_id),
                        )
                    )
        if issues:
            self.warning(
                f"validate_no_crossings: {len(issues)} crossing(s) across {len(usable)} surface(s)"
            )
        return issues
