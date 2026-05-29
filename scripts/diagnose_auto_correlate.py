"""Read-only diagnostic for the litho auto-correlate "skipped borehole" symptom (#163).

Answers three questions for a chosen cross-section + lithostratigraphic model,
using the REAL projection + adjacency code so the numbers match what the app does:

1. PROJECTION  — for every in-corridor investigation prints its true map (x, y),
   its ALONG-section distance (the left-right placement on the section) and its
   perpendicular OFFSET (the ``<-N m`` header label). These are INDEPENDENT
   quantities: a borehole 17 m off the line can sit between two CPTs that are
   only 5-7 m off the line, because left-right order is driven by ``along``, not
   by ``offset``. This table proves whether the projection is correct.

2. ADJACENCY (hypothesis A) — runs the real relative-neighbourhood-graph gate
   (``_relative_neighbourhood_adjacency``) in TRUE map plane over the model's
   participating investigations and prints, for each focus pair, whether they
   are RNG-adjacent and which third test (if any) blocks them. Resolves "did the
   17 m borehole fall OUTSIDE the two CPTs' lune, so the CPTs paired directly?".

3. BOUNDARY SIGNATURES (hypothesis B) — prints each focus investigation's contact
   stack with ``(parent_formation, litho_above, litho_below)`` and shows which
   signatures are SHARED across columns. Resolves "do the CPT-segmenter soil
   codes even match the borehole-log codes, or is the cross-source match the
   thing that silently drops every CPT<->borehole pair?".

Finally it runs the actual ``auto_correlate_contact_edges`` algorithm and prints
the proposed edges that touch the focus investigations — the ground truth of what
auto-correlate would draw.

Read-only: no writes, no commits. Runs against the dev DB (``settings.database_url``
default — ``localhost:5433/groundmodel``), which is where dogfed data lives.

Usage
-----
    uv run python scripts/diagnose_auto_correlate.py
        -> lists available sections + litho models, then exit.

    uv run python scripts/diagnose_auto_correlate.py --section "1" --names S27,B6,S26
        -> full diagnostic for the section whose name contains "1", focusing the
           pairwise analysis on the three named investigations.

    uv run python scripts/diagnose_auto_correlate.py --section "1" --model <uuid>
        -> pin the litho model explicitly when a section has more than one.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from uuid import UUID

from sqlalchemy import select

from groundmodel.domain.services.auto_correlate_contact_edges import (
    ContactRecord,
    InvestigationLocation,
    _dist,
    _relative_neighbourhood_adjacency,
    auto_correlate_contact_edges,
)
from groundmodel.domain.services.auto_correlate_contact_edges_constants import (
    MAX_COLUMN_DISTANCE_M,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.session import AsyncSessionFactory
from groundmodel.infrastructure.gis.section_projection import (
    SectionEndpoints,
    project_point_onto_line,
)


def _short(u: UUID | None) -> str:
    """Return the first 8 chars of a UUID for compact, readable output."""
    return str(u)[:8] if u is not None else "—"


def _rule(title: str) -> None:
    """Print a section banner."""
    print(f"\n{'=' * 78}\n{title}\n{'=' * 78}")


async def _resolve_section(session, needle: str | None) -> CrossSectionOrm | None:
    """Return the single cross-section whose name contains ``needle`` (ci).

    Lists all sections and returns ``None`` when the needle is missing or
    ambiguous so the caller can stop and let the user pick.
    """
    sections = (await session.execute(select(CrossSectionOrm))).scalars().all()
    if not sections:
        print("No cross-sections exist in the DB.")
        return None
    if needle is None:
        print("Available cross-sections (pass --section <name substring | id prefix>):")
        for s in sections:
            print(f"  {_short(s.id)}  {s.name!r}  (project {_short(s.app_project_id)})")
        return None
    # Match on name substring OR id prefix (names collide across projects, so
    # the short id from the listing is the unambiguous selector).
    nl = needle.lower()
    matches = [s for s in sections if nl in s.name.lower() or str(s.id).lower().startswith(nl)]
    if len(matches) == 1:
        return matches[0]
    print(f"--section {needle!r} matched {len(matches)} sections — use the id prefix:")
    for s in matches or sections:
        print(f"  {_short(s.id)}  {s.name!r}  (project {_short(s.app_project_id)})")
    return None


async def _resolve_model(
    session, project_id: UUID, model_arg: str | None
) -> GeologicalModelOrm | None:
    """Return the lithostratigraphic model for the project.

    Auto-picks when the project has exactly one litho model; otherwise lists
    them (or matches a uuid / name substring passed via ``model_arg``).
    """
    models = (
        (
            await session.execute(
                select(GeologicalModelOrm).where(
                    GeologicalModelOrm.app_project_id == project_id,
                    GeologicalModelOrm.kind == "lithostratigraphic",
                )
            )
        )
        .scalars()
        .all()
    )
    if not models:
        print("No lithostratigraphic models in this project.")
        return None
    if model_arg:
        matches = [
            m
            for m in models
            if model_arg.lower() in str(m.id).lower() or model_arg.lower() in m.name.lower()
        ]
        if len(matches) == 1:
            return matches[0]
        print(f"--model {model_arg!r} matched {len(matches)} models:")
        for m in matches or models:
            print(f"  {_short(m.id)}  {m.name!r}")
        return None
    if len(models) == 1:
        return models[0]
    print("Project has multiple litho models (pass --model <uuid|name>):")
    for m in models:
        print(f"  {_short(m.id)}  {m.name!r}")
    return None


async def _load_locations(
    session, project_id: UUID
) -> tuple[list[InvestigationLocation], dict[UUID, str], dict[UUID, str]]:
    """Load every CPT + borehole location in the project.

    Returns the location list (as the algorithm consumes it), a name lookup,
    and a kind lookup (``"CPT"`` / ``"BH"``) keyed by investigation id.
    """
    cpts = (
        await session.execute(
            select(CptOrm.id, CptOrm.name, CptOrm.location_x, CptOrm.location_y).where(
                CptOrm.app_project_id == project_id
            )
        )
    ).all()
    bhs = (
        await session.execute(
            select(
                BoreholeOrm.id, BoreholeOrm.name, BoreholeOrm.location_x, BoreholeOrm.location_y
            ).where(BoreholeOrm.app_project_id == project_id)
        )
    ).all()
    locations = [
        InvestigationLocation(investigation_id=r.id, x=r.location_x, y=r.location_y)
        for r in (*cpts, *bhs)
    ]
    names = {r.id: r.name for r in (*cpts, *bhs)}
    kinds = {r.id: "CPT" for r in cpts} | {r.id: "BH" for r in bhs}
    return locations, names, kinds


async def _load_contact_records(session, model_id: UUID) -> list[ContactRecord]:
    """Rebuild the exact ``ContactRecord`` list the auto-correlate use case feeds.

    Mirrors ``AutoCorrelateContactEdges.execute`` steps 2-3 verbatim so the
    derived ``litho_below_code`` matches production.
    """
    rows = (
        await session.execute(
            select(
                FormationContactOrm.id,
                FormationContactOrm.formation_id,
                FormationContactOrm.cpt_id,
                FormationContactOrm.borehole_id,
                FormationContactOrm.depth_top_m,
                GeologicalFormationOrm.parent_formation_id,
                GeologicalFormationOrm.litho_main_soil_code,
            )
            .join(
                GeologicalFormationOrm,
                GeologicalFormationOrm.id == FormationContactOrm.formation_id,
            )
            .where(FormationContactOrm.model_id == model_id)
        )
    ).all()

    stacks: dict[UUID, list[tuple[float, UUID, UUID, UUID | None, str]]] = {}
    for row in rows:
        inv_id = row.borehole_id if row.borehole_id is not None else row.cpt_id
        if inv_id is None:
            continue
        stacks.setdefault(inv_id, []).append(
            (
                row.depth_top_m,
                row.id,
                row.formation_id,
                row.parent_formation_id,
                row.litho_main_soil_code or "",
            )
        )
    for s in stacks.values():
        s.sort()

    records: list[ContactRecord] = []
    for inv_id, entries in stacks.items():
        for i, (depth, cid, fid, parent, litho_above) in enumerate(entries):
            litho_below = entries[i + 1][4] if i + 1 < len(entries) else None
            records.append(
                ContactRecord(
                    contact_id=cid,
                    formation_id=fid,
                    investigation_id=inv_id,
                    depth_top_m=depth,
                    parent_formation_id=parent,
                    litho_main_soil_code=litho_above,
                    litho_below_code=litho_below,
                )
            )
    return records


def _report_projection(
    section: CrossSectionOrm,
    locations: list[InvestigationLocation],
    names: dict[UUID, str],
    kinds: dict[UUID, str],
) -> None:
    """Print the along/offset table for in-corridor investigations."""
    _rule("1. PROJECTION — along (left-right) vs offset (the '<-N m' label)")
    endpoints = SectionEndpoints(
        start_x=section.start_x,
        start_y=section.start_y,
        end_x=section.end_x,
        end_y=section.end_y,
    )
    buffer = section.projection_buffer_m
    excluded = set(section.excluded_cpt_ids) | set(section.excluded_borehole_ids)
    print(
        f"section {section.name!r}  line "
        f"({section.start_x:.1f},{section.start_y:.1f}) -> "
        f"({section.end_x:.1f},{section.end_y:.1f})  buffer={buffer:.0f} m\n"
    )
    print(f"{'name':<26}{'kind':<5}{'x':>12}{'y':>12}{'along_m':>10}{'offset_m':>10}{'|off|':>8}")
    print("-" * 83)
    rows = []
    for loc in locations:
        res = project_point_onto_line(endpoints, loc.x, loc.y)
        if res is None:
            continue
        rows.append((res.along, loc, res))
    rows.sort(key=lambda r: r[0])  # screen left-to-right
    for along, loc, res in rows:
        in_corridor = abs(res.offset) <= buffer and loc.investigation_id not in excluded
        flag = "" if in_corridor else "  (off-section / excluded)"
        print(
            f"{names.get(loc.investigation_id, '?'):<26}"
            f"{kinds.get(loc.investigation_id, '?'):<5}"
            f"{loc.x:>12.1f}{loc.y:>12.1f}{along:>10.1f}{res.offset:>10.1f}"
            f"{abs(res.offset):>8.1f}{flag}"
        )
    print(
        "\nNote: left-right order is by ALONG. OFFSET (the '<-N m' label) is the\n"
        "perpendicular distance to the line and does NOT order columns — a larger\n"
        "offset between two smaller-offset columns is geometrically correct."
    )


def _report_adjacency(
    focus_ids: list[UUID],
    locations: list[InvestigationLocation],
    names: dict[UUID, str],
    kinds: dict[UUID, str],
    participant_ids: set[UUID],
) -> None:
    """Print RNG adjacency + lune blockers for each focus pair (hypothesis A)."""
    _rule("2. ADJACENCY — relative-neighbourhood-graph gate in TRUE map plane (hyp. A)")
    loc_by_id = {loc.investigation_id: loc for loc in locations}
    located = [i for i in participant_ids if i in loc_by_id]
    adjacency = _relative_neighbourhood_adjacency(participant_ids, loc_by_id, MAX_COLUMN_DISTANCE_M)
    print(
        f"{len(located)} located model participants; "
        f"{len(adjacency)} RNG-adjacent pairs (max_distance={MAX_COLUMN_DISTANCE_M:.0f} m)\n"
    )

    def label(i: UUID) -> str:
        return f"{names.get(i, _short(i))}[{kinds.get(i, '?')}]"

    for a in range(len(focus_ids)):
        for b in range(a + 1, len(focus_ids)):
            ia, ib = focus_ids[a], focus_ids[b]
            if ia not in loc_by_id or ib not in loc_by_id:
                print(f"{label(ia)} -- {label(ib)}: missing location, skipped")
                continue
            d_ab = _dist(loc_by_id[ia], loc_by_id[ib])
            adj = frozenset((ia, ib)) in adjacency
            blockers = [
                c
                for c in located
                if c not in (ia, ib)
                and _dist(loc_by_id[ia], loc_by_id[c]) < d_ab
                and _dist(loc_by_id[ib], loc_by_id[c]) < d_ab
            ]
            verdict = "ADJACENT (pairs)" if adj else "blocked (skipped)"
            print(f"{label(ia)} -- {label(ib)}: dist={d_ab:.1f} m -> {verdict}")
            for c in blockers:
                print(
                    f"      blocker {label(c)}: "
                    f"d_to_{names.get(ia, _short(ia))}={_dist(loc_by_id[ia], loc_by_id[c]):.1f} "
                    f"d_to_{names.get(ib, _short(ib))}={_dist(loc_by_id[ib], loc_by_id[c]):.1f} "
                    f"(both < {d_ab:.1f})"
                )
    print(
        "\nRead this against the section: if the two CPTs are ADJACENT and the borehole\n"
        "is NOT a blocker between them, the borehole is a sideways outlier in map space\n"
        "even though it looks 'between' them on the (perpendicular-flattened) section."
    )


def _report_signatures(
    focus_ids: list[UUID],
    records: list[ContactRecord],
    names: dict[UUID, str],
    kinds: dict[UUID, str],
) -> None:
    """Print each focus column's contact stack + cross-column shared signatures."""
    _rule("3. BOUNDARY SIGNATURES — (parent, litho_above, litho_below) per contact (hyp. B)")
    by_inv: dict[UUID, list[ContactRecord]] = {}
    for r in records:
        if r.investigation_id in focus_ids:
            by_inv.setdefault(r.investigation_id, []).append(r)

    # Parents are uuid7 (time-ordered) so their 8-char prefixes collide in the
    # display, masking whether two same-looking codes actually share a parent.
    # Relabel each DISTINCT parent as P0/P1/... so a cross-source parent split
    # is unmissable.
    parents = sorted(
        {r.parent_formation_id for r in records if r.investigation_id in focus_ids},
        key=lambda p: str(p) if p is not None else "",
    )
    plabel = {p: f"P{n}" for n, p in enumerate(parents)}

    def _pl(p: UUID | None) -> str:
        return plabel.get(p, "P?")

    sig_by_inv: dict[UUID, set[tuple]] = {}
    for inv in focus_ids:
        entries = sorted(by_inv.get(inv, []), key=lambda r: r.depth_top_m)
        print(f"\n{names.get(inv, _short(inv))} [{kinds.get(inv, '?')}]  ({len(entries)} contacts)")
        if not entries:
            print("   (no contacts in this model)")
            sig_by_inv[inv] = set()
            continue
        print(f"   {'depth_m':>8}  {'parent':<8}{'above':<10}{'below':<10}")
        sigs = set()
        for r in entries:
            sig = (r.parent_formation_id, r.litho_main_soil_code, r.litho_below_code)
            sigs.add(sig)
            print(
                f"   {r.depth_top_m:>8.2f}  {_pl(r.parent_formation_id):<8}"
                f"{r.litho_main_soil_code:<10}{(r.litho_below_code or '·'):<10}"
            )
        sig_by_inv[inv] = sigs

    print("\nparent legend: " + ", ".join(f"{_pl(p)}={p}" for p in parents))

    print("\nShared boundary signatures (a pair can only correlate where signatures match):")
    fl = [i for i in focus_ids if sig_by_inv.get(i)]
    for a in range(len(fl)):
        for b in range(a + 1, len(fl)):
            ia, ib = fl[a], fl[b]
            shared = sig_by_inv[ia] & sig_by_inv[ib]
            print(
                f"  {names.get(ia, _short(ia))}[{kinds.get(ia, '?')}] ∩ "
                f"{names.get(ib, _short(ib))}[{kinds.get(ib, '?')}]: "
                f"{len(shared)} shared signature(s)"
            )
            for parent, above, below in sorted(shared, key=lambda s: (s[1], s[2] or "")):
                print(f"        parent={_pl(parent)} {above} / {below or '·'}")
    print(
        "\nIf the CPT∩CPT shared count is high but every CPT∩BH count is 0, the borehole\n"
        "is being dropped by signature mismatch (cross-source codes disagree), NOT geometry."
    )


def _report_candidates(
    focus_ids: list[UUID],
    records: list[ContactRecord],
    locations: list[InvestigationLocation],
    names: dict[UUID, str],
    kinds: dict[UUID, str],
) -> None:
    """Run the real algorithm and print proposed edges touching the focus set."""
    _rule("GROUND TRUTH — auto_correlate_contact_edges() proposed edges (focus only)")
    inv_by_contact = {r.contact_id: r.investigation_id for r in records}
    depth_by_contact = {r.contact_id: r.depth_top_m for r in records}
    candidates = auto_correlate_contact_edges(records, locations)
    focus_set = set(focus_ids)
    touched = [
        c
        for c in candidates
        if inv_by_contact.get(c.contact_a_id) in focus_set
        or inv_by_contact.get(c.contact_b_id) in focus_set
    ]
    print(
        f"{len(candidates)} total candidate edges model-wide; {len(touched)} touch the focus set\n"
    )
    for c in touched:
        ia = inv_by_contact.get(c.contact_a_id)
        ib = inv_by_contact.get(c.contact_b_id)
        print(
            f"  {names.get(ia, '?')}[{kinds.get(ia, '?')}] "
            f"@ {depth_by_contact.get(c.contact_a_id, float('nan')):.2f} m  <->  "
            f"{names.get(ib, '?')}[{kinds.get(ib, '?')}] "
            f"@ {depth_by_contact.get(c.contact_b_id, float('nan')):.2f} m"
        )
    if not touched:
        print("  (no proposed edges involve the focus investigations)")


async def _main(args: argparse.Namespace) -> None:
    """Run the full diagnostic against the dev DB."""
    async with AsyncSessionFactory() as session:
        section = await _resolve_section(session, args.section)
        if section is None:
            return
        model = await _resolve_model(session, section.app_project_id, args.model)
        if model is None:
            return

        print(
            f"\nDiagnosing section {section.name!r} ({_short(section.id)}) "
            f"x litho model {model.name!r} ({_short(model.id)})"
        )

        locations, names, kinds = await _load_locations(session, section.app_project_id)
        records = await _load_contact_records(session, model.id)
        participant_ids = {r.investigation_id for r in records}

        if args.names:
            needles = [n.strip().lower() for n in args.names.split(",") if n.strip()]
            focus_ids = [
                iid for needle in needles for iid, nm in names.items() if needle in nm.lower()
            ]
            # de-dup preserving order
            seen: set[UUID] = set()
            focus_ids = [i for i in focus_ids if not (i in seen or seen.add(i))]
        else:
            # default focus: in-corridor model participants on this section
            endpoints = SectionEndpoints(
                start_x=section.start_x,
                start_y=section.start_y,
                end_x=section.end_x,
                end_y=section.end_y,
            )
            loc_by_id = {loc.investigation_id: loc for loc in locations}
            focus_ids = []
            for iid in participant_ids:
                loc = loc_by_id.get(iid)
                if loc is None:
                    continue
                res = project_point_onto_line(endpoints, loc.x, loc.y)
                if res and abs(res.offset) <= section.projection_buffer_m:
                    focus_ids.append(iid)

        if not focus_ids:
            print("\nNo focus investigations resolved — check --names against the labels above.")

        _report_projection(section, locations, names, kinds)
        if focus_ids:
            print(f"\nFocus set: {[names.get(i, _short(i)) for i in focus_ids]}")
            _report_adjacency(focus_ids, locations, names, kinds, participant_ids)
            _report_signatures(focus_ids, records, names, kinds)
            _report_candidates(focus_ids, records, locations, names, kinds)


def main() -> None:
    """CLI entry point."""
    # The Windows console defaults to cp1252; the report uses a few non-ASCII
    # glyphs (em-dash, set-intersection). Force UTF-8 so it doesn't crash
    # mid-report. stdout may be a non-reconfigurable stream when redirected.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--section", default=None, help="cross-section name substring (case-insensitive)"
    )
    parser.add_argument(
        "--model", default=None, help="litho model uuid or name substring (optional)"
    )
    parser.add_argument(
        "--names",
        default=None,
        help="comma-separated investigation name substrings to focus on (e.g. S27,B6,S26)",
    )
    asyncio.run(_main(parser.parse_args()))


if __name__ == "__main__":
    main()
