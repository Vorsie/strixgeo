"""Measure, on the owner's real model, how many accepted geotech ties re-anchor.

The question
------------
``SubdivideAllBodies`` now carries an accepted packing tie across a rebuild by
matching the rebuilt band to the old one on **the same investigation, the same
depth interval, and the same NAD class** (owner ruling 2026-08-01, exact — no
tolerance).  How many of the owner's accepted ties actually survive that rule on
his own project, and for the ones that do not, WHY?

The method, and why it is trustworthy
-------------------------------------
1. The dev ``groundmodel`` DB is opened **read-only**.  A guard aborts if the
   DSN is not the dev DB, and the only statements issued against it are
   SELECTs (``build_project_bundle`` is a pure reader).
2. The project is copied into the sibling ``groundmodel_integration`` DB with
   the production ``.strix`` bundle round-trip — the same code path the app uses
   to open a saved project, so the copy carries the real CPT series, the real
   litho picks, the real geo surfaces, the real view-state knobs (min thickness,
   gradient snap) and the real accepted ties.
3. The copy is **verified against the source** before anything is measured:
   every geotech band's ``(investigation, depth interval, NAD class)`` and every
   accepted tie's fingerprint must match the dev DB exactly.  If they do not the
   script aborts — a measurement on a distorted copy would be worthless.
4. The REAL ``SubdivideAllBodies`` then runs against the copy.  The dev DB is
   never written.
5. The outcome is computed TWICE and cross-checked: once by the use case itself
   (its ``reanchored_tie_count`` / ``lost_tie_count`` / ``lost_tie_reasons``),
   and once independently in this script from the before/after band tables with
   the matching rule re-implemented on plain tuples.  Agreement between an
   implementation and an independent re-derivation is the evidence; either one
   alone is just a claim.

It also reports what the answer would be under BIT-EXACT float comparison
instead of the millimetre grain the DB itself distinguishes intervals at, so
the choice of grain can be seen to cost nothing (or not).

Usage
-----
    uv run python scripts/measure_geotech_tie_reanchor.py
    uv run python scripts/measure_geotech_tie_reanchor.py --json out.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any
from uuid import UUID

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from groundmodel.application.subdivide_all_bodies import SubdivideAllBodies  # noqa: E402
from groundmodel.infrastructure.db.models.geological_formation_orm import (  # noqa: E402
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (  # noqa: E402
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (  # noqa: E402
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm  # noqa: E402
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm  # noqa: E402
from groundmodel.infrastructure.db.repositories.project_bundle import (  # noqa: E402
    build_project_bundle,
    restore_project_bundle,
)
from groundmodel.shared.config import settings  # noqa: E402

# Reason tokens, re-declared here rather than imported: this script is the
# INDEPENDENT check on the use case, so it must not borrow the use case's
# matching code. The strings are compared against the use case's output at the
# end; a divergence in either direction is reported.
REASON_CLASS_CHANGED = "class_changed"
REASON_INTERVAL_MOVED = "interval_moved"
REASON_BAND_ABSENT = "band_absent"
REASON_BOREHOLE_DEFERRED = "borehole_endpoint_deferred"


def _confirm_dev_db() -> str:
    """Print the source DSN and ABORT unless it is the dev ``groundmodel`` DB.

    Returns
    -------
    str
        The verified dev DSN.

    Raises
    ------
    SystemExit
        When the DSN does not contain ``groundmodel`` or already names an
        ``_integration`` / ``_test`` sibling.
    """
    url = settings.database_url
    print(f"  source DB: {url}")
    if "groundmodel" not in url:
        raise SystemExit(f"ABORT: DSN does not contain 'groundmodel' ({url!r}).")
    if url.rstrip("/").endswith(("_integration", "_test")):
        raise SystemExit(f"ABORT: DSN already names an integration/test DB ({url!r}).")
    return url


def _integration_dsn(dev_dsn: str) -> str:
    """Derive the sibling integration DSN from the dev DSN.

    Parameters
    ----------
    dev_dsn : str
        The dev database URL.

    Returns
    -------
    str
        The same server with the ``_integration`` database name.

    Raises
    ------
    SystemExit
        When the derived DSN does not name an integration DB (a guard against
        ever pointing the writing half at the dev database).
    """
    head, _, _tail = dev_dsn.rpartition("/")
    dsn = f"{head}/groundmodel_integration"
    if not dsn.endswith("_integration"):
        raise SystemExit(f"ABORT: derived target DSN is not an integration DB ({dsn!r}).")
    print(f"  target DB: {dsn}")
    return dsn


async def _load_geotech_model(session: AsyncSession) -> GeologicalModelOrm:
    """Return the project's geotechnical model, or abort.

    Parameters
    ----------
    session : AsyncSession
        Session on the database to read.

    Returns
    -------
    GeologicalModelOrm
        The single geotechnical model.

    Raises
    ------
    SystemExit
        When there is not exactly one geotechnical model.
    """
    models = (
        (
            await session.execute(
                select(GeologicalModelOrm).where(GeologicalModelOrm.kind == "geotechnical")
            )
        )
        .scalars()
        .all()
    )
    if len(models) != 1:
        raise SystemExit(f"ABORT: expected exactly one geotechnical model, found {len(models)}.")
    return models[0]


async def _band_rows(
    session: AsyncSession, geotech_model_id: UUID
) -> list[tuple[UUID, str, str, float, float, int | None]]:
    """Read every geotech band as ``(layer_id, kind, inv, top_m, base_m, nad)``.

    Parameters
    ----------
    session : AsyncSession
        Session on the database to read.
    geotech_model_id : UUID
        The geotech model.

    Returns
    -------
    list[tuple[UUID, str, str, float, float, int | None]]
        One row per band, with the raw metre depths as the DB stores them.
    """
    rows = (
        await session.execute(
            select(
                LithoLayerOrm.id,
                LithoLayerOrm.cpt_id,
                LithoLayerOrm.borehole_id,
                LithoLayerOrm.depth_top_m,
                LithoLayerOrm.depth_base_m,
                GeologicalFormationOrm.nad_class,
            )
            .join(
                GeologicalFormationOrm,
                LithoLayerOrm.formation_id == GeologicalFormationOrm.id,
            )
            .where(LithoLayerOrm.model_id == geotech_model_id)
        )
    ).all()
    out = []
    for r in rows:
        kind = "borehole" if r.borehole_id is not None else "cpt"
        inv = str(r.borehole_id if r.borehole_id is not None else r.cpt_id)
        out.append((r.id, kind, inv, r.depth_top_m, r.depth_base_m, r.nad_class))
    return out


async def _accepted_ties(session: AsyncSession, geotech_model_id: UUID) -> list[dict[str, Any]]:
    """Read every accepted tie with both endpoints' band identity.

    Parameters
    ----------
    session : AsyncSession
        Session on the database to read.
    geotech_model_id : UUID
        The geotech model.

    Returns
    -------
    list[dict[str, Any]]
        One dict per accepted tie: ids, section, sides, source, and each
        endpoint's ``(kind, investigation, top_m, base_m, nad_class)``.
    """
    edges = (
        (
            await session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == geotech_model_id,
                    LithoContactCorrelationEdgeOrm.user_approved.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    bands = {row[0]: row for row in await _band_rows(session, geotech_model_id)}
    ties: list[dict[str, Any]] = []
    for e in edges:
        band_a = bands.get(e.layer_a_id)
        band_b = bands.get(e.layer_b_id)
        if band_a is None or band_b is None:
            print(f"  ! accepted edge {e.id} has an endpoint outside the model — skipped")
            continue
        ties.append(
            {
                "edge_id": str(e.id),
                "section_id": str(e.section_id),
                "sides": (e.layer_a_side, e.layer_b_side),
                "source": e.source,
                "a": {
                    "kind": band_a[1],
                    "inv": band_a[2],
                    "top_m": band_a[3],
                    "base_m": band_a[4],
                    "nad": band_a[5],
                },
                "b": {
                    "kind": band_b[1],
                    "inv": band_b[2],
                    "top_m": band_b[3],
                    "base_m": band_b[4],
                    "nad": band_b[5],
                },
            }
        )
    return ties


def _mm(x: float) -> int:
    """Millimetre key for a depth — the grain the DB's exclusion constraint uses."""
    return int(round(x * 1000.0))


def _endpoint_key(ep: dict[str, Any], *, exact_float: bool) -> tuple:
    """Build the three-part identity key for one tie endpoint."""
    if exact_float:
        return (ep["inv"], ep["top_m"], ep["base_m"], ep["nad"])
    return (ep["inv"], _mm(ep["top_m"]), _mm(ep["base_m"]), ep["nad"])


def _band_key(band: tuple, *, exact_float: bool) -> tuple:
    """Build the three-part identity key for one rebuilt band."""
    _layer_id, _kind, inv, top_m, base_m, nad = band
    if exact_float:
        return (inv, top_m, base_m, nad)
    return (inv, _mm(top_m), _mm(base_m), nad)


def _diagnose(ep: dict[str, Any], after_by_inv: dict[str, list[tuple]]) -> str:
    """Say why an endpoint's band is not in the rebuild.

    Parameters
    ----------
    ep : dict[str, Any]
        The endpoint's captured identity.
    after_by_inv : dict[str, list[tuple]]
        Rebuilt bands grouped by investigation.

    Returns
    -------
    str
        One of the four reason tokens.
    """
    bands = after_by_inv.get(ep["inv"], [])
    if not bands:
        return REASON_BOREHOLE_DEFERRED if ep["kind"] == "borehole" else REASON_BAND_ABSENT
    for _lid, _kind, _inv, top_m, base_m, _nad in bands:
        if _mm(top_m) == _mm(ep["top_m"]) and _mm(base_m) == _mm(ep["base_m"]):
            return REASON_CLASS_CHANGED
    for _lid, _kind, _inv, top_m, base_m, _nad in bands:
        if _mm(top_m) < _mm(ep["base_m"]) and _mm(ep["top_m"]) < _mm(base_m):
            return REASON_INTERVAL_MOVED
    return REASON_BAND_ABSENT


def _follow_candidates(ep: dict[str, Any], after_by_inv: dict[str, list[tuple]]) -> list[dict]:
    """Rebuilt bands the endpoint's band could have MOVED into.

    The owner's model of a tie is that it is pinned to a band, so when that band's
    boundaries move the tie should travel with it rather than be dropped.  That only
    works if the moved band is identifiable after the rebuild, which is a property of
    the data and not something to assume: this returns every rebuilt band on the same
    investigation that overlaps the captured interval, with how much of the old
    interval each one covers, so ambiguous columns are visible instead of averaged away.

    Parameters
    ----------
    ep : dict[str, Any]
        The endpoint's captured identity (investigation, interval, NAD class).
    after_by_inv : dict[str, list[tuple]]
        Rebuilt bands grouped by investigation.

    Returns
    -------
    list[dict]
        One entry per overlapping band, richest overlap first.
    """
    old_top, old_base = ep["top_m"], ep["base_m"]
    old_span = max(old_base - old_top, 1e-9)
    out: list[dict] = []
    for layer_id, _kind, _inv, top_m, base_m, nad in after_by_inv.get(ep["inv"], []):
        overlap = min(old_base, base_m) - max(old_top, top_m)
        if overlap <= 0:
            continue
        out.append(
            {
                "layer_id": str(layer_id),
                "top_m": top_m,
                "base_m": base_m,
                "nad": nad,
                "overlap_m": overlap,
                "covers_frac": overlap / old_span,
                "same_class": nad == ep["nad"],
            }
        )
    out.sort(key=lambda c: c["overlap_m"], reverse=True)
    return out


def _match_offline(
    ties: list[dict[str, Any]],
    after_bands: list[tuple],
    *,
    exact_float: bool = False,
) -> dict[str, Any]:
    """Apply the owner's exact rule to the before/after band tables.

    Independent of the use case's own implementation — this is the cross-check.

    Parameters
    ----------
    ties : list[dict[str, Any]]
        The accepted ties captured before the rebuild.
    after_bands : list[tuple]
        The bands the rebuild produced.
    exact_float : bool
        Compare depths as raw doubles instead of whole millimetres.

    Returns
    -------
    dict[str, Any]
        ``matched`` count, ``lost`` count, per-reason counter and the lost ties'
        details.
    """
    index = {_band_key(b, exact_float=exact_float) for b in after_bands}
    by_inv: dict[str, list[tuple]] = {}
    for band in after_bands:
        by_inv.setdefault(band[2], []).append(band)

    def _follows(ep: dict[str, Any]) -> tuple[bool, str | None]:
        """Tiers 2 and 3, re-derived from the band table.

        Written from the rule rather than by calling the use case, so this stays
        an independent check.  Returns whether the endpoint can be carried at all
        and, when it can, why the engineer would have to confirm it.
        """
        cands = _follow_candidates(ep, by_inv)
        if not cands:
            return False, None
        same_class = [c for c in cands if c["same_class"]]
        if len(same_class) == 1:
            return True, None
        return True, ("ambiguous_band" if same_class else "class_changed")

    matched = 0
    lost: list[dict[str, Any]] = []
    reasons: Counter[str] = Counter()
    reviews: Counter[str] = Counter()
    for tie in ties:
        review_a = review_b = None
        hit_a = _endpoint_key(tie["a"], exact_float=exact_float) in index
        if not hit_a:
            hit_a, review_a = _follows(tie["a"])
        hit_b = _endpoint_key(tie["b"], exact_float=exact_float) in index
        if not hit_b:
            hit_b, review_b = _follows(tie["b"])
        if hit_a and hit_b:
            matched += 1
            review = (
                "class_changed" if "class_changed" in (review_a, review_b) else review_a or review_b
            )
            if review:
                reviews[review] += 1
            continue
        reason_a = None if hit_a else _diagnose(tie["a"], by_inv)
        reason_b = None if hit_b else _diagnose(tie["b"], by_inv)
        for reason in {r for r in (reason_a, reason_b) if r is not None}:
            reasons[reason] += 1
        lost.append({**tie, "reason_a": reason_a, "reason_b": reason_b})
    return {
        "matched": matched,
        "lost": len(lost),
        "reasons": dict(reasons),
        "reviews": dict(reviews),
        "lost_detail": lost,
    }


async def main() -> None:
    """Run the measurement and print the report."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", type=Path, default=None, help="Write the full report as JSON.")
    args = parser.parse_args()

    print("\n=== ACCEPTED GEOTECH TIE RE-ANCHOR — REAL-DATA MEASUREMENT ===\n")
    dev_dsn = _confirm_dev_db()
    target_dsn = _integration_dsn(dev_dsn)

    dev_engine = create_async_engine(dev_dsn, echo=False)
    dev_factory = async_sessionmaker(dev_engine, expire_on_commit=False)
    target_engine = create_async_engine(target_dsn, echo=False)
    target_factory = async_sessionmaker(target_engine, expire_on_commit=False)

    # ---- Step 1: read the dev DB (SELECTs only) --------------------------
    async with dev_factory() as dev_session:
        geotech = await _load_geotech_model(dev_session)
        project_id = geotech.app_project_id
        litho_model_id = geotech.parent_model_id
        if litho_model_id is None:
            raise SystemExit("ABORT: the geotech model has no lithostratigraphic parent.")
        print(f"  project      : {project_id}")
        print(f"  litho model  : {litho_model_id}")
        print(f"  geotech model: {geotech.id}")

        dev_bands = await _band_rows(dev_session, geotech.id)
        dev_ties = await _accepted_ties(dev_session, geotech.id)
        print(f"\n  dev: {len(dev_bands)} geotech band(s), {len(dev_ties)} ACCEPTED tie(s)")
        project_row = await dev_session.get(ProjectOrm, project_id)
        if project_row is None:
            raise SystemExit(f"ABORT: project {project_id} not found on the dev DB.")
        # include_solids=False mirrors what File → Save writes into a .strix,
        # and the cached voxel meshes are irrelevant here — the geotech rebuild
        # reads CPT series, litho picks and geo surfaces, none of which are
        # solids. (Solids also reference litho_build_generation rows the bundle
        # does not carry, so a replace-restore with them attached would trip a
        # foreign key before the measurement could start.)
        bundle = await build_project_bundle(dev_session, project_row, include_solids=False)
    await dev_engine.dispose()

    # ---- Step 2: copy into the integration DB ---------------------------
    print("\n  restoring the project into the integration DB (replace) ...")
    async with target_factory() as session:
        await restore_project_bundle(
            session,
            project_id,
            bundle["project"],
            bundle["cpts"],
            bundle["boreholes"],
            bundle.get("geological_formations"),
            bundle.get("geological_models"),
            bundle.get("cross_sections"),
            bundle.get("investigation_reviews"),
            bundle.get("bodies"),
            bundle.get("formation_absences"),
            bundle.get("litho_contact_correlation_edges"),
            bundle.get("body_boundary_shapes"),
            bundle.get("body_boundary_nodes"),
            bundle.get("litho_solids"),
            replace=True,
        )
        await session.commit()

    # ---- Step 3: verify the copy against the source ----------------------
    async with target_factory() as session:
        copy_geotech = await _load_geotech_model(session)
        copy_bands = await _band_rows(session, copy_geotech.id)
        copy_ties = await _accepted_ties(session, copy_geotech.id)

    def _fingerprints(ties: list[dict[str, Any]]) -> Counter:
        return Counter(
            (
                t["section_id"],
                t["source"],
                frozenset(
                    {
                        _endpoint_key(t["a"], exact_float=False),
                        _endpoint_key(t["b"], exact_float=False),
                    }
                ),
            )
            for t in ties
        )

    dev_band_keys = Counter(_band_key(b, exact_float=False) for b in dev_bands)
    copy_band_keys = Counter(_band_key(b, exact_float=False) for b in copy_bands)
    if dev_band_keys != copy_band_keys:
        raise SystemExit(
            f"ABORT: the copy's band table differs from the dev DB's "
            f"(dev {len(dev_bands)} vs copy {len(copy_bands)}) — a measurement on a "
            f"distorted copy would be worthless."
        )
    if _fingerprints(dev_ties) != _fingerprints(copy_ties):
        raise SystemExit(
            "ABORT: the copy's accepted ties differ from the dev DB's — "
            "the bundle round-trip did not preserve them."
        )
    print(
        f"  copy VERIFIED against the source: {len(copy_bands)} bands and "
        f"{len(copy_ties)} accepted ties are identical"
    )

    # ---- Step 4: run the real use case on the copy -----------------------
    print("\n  running SubdivideAllBodies on the copy ...")
    async with target_factory() as session:
        result = await SubdivideAllBodies(session).execute(
            project_id=project_id,
            litho_model_id=litho_model_id,
        )
    async with target_factory() as session:
        after_bands = await _band_rows(session, result.geotech_model_id)
        after_accepted = await _accepted_ties(session, result.geotech_model_id)

    # ---- Step 5: independent offline match + cross-check ----------------
    offline = _match_offline(copy_ties, after_bands)
    offline_exact_float = _match_offline(copy_ties, after_bands, exact_float=True)

    print("\n--- RESULT ------------------------------------------------------")
    print(f"  accepted ties before the rebuild : {len(copy_ties)}")
    print(f"  bands before / after             : {len(copy_bands)} / {len(after_bands)}")
    print(f"  RE-ANCHORED (use case)           : {result.reanchored_tie_count}")
    print(f"  needs review (use case)          : {result.review_tie_reasons}")
    print(f"  LOST        (use case)           : {result.lost_tie_count}")
    print(f"  loss reasons (use case)          : {result.lost_tie_reasons}")
    print(f"  RE-ANCHORED (independent check)  : {offline['matched']}")
    print(f"  needs review (independent check) : {offline['reviews']}")
    print(f"  LOST        (independent check)  : {offline['lost']}")
    print(f"  loss reasons (independent check) : {offline['reasons']}")
    print(f"  accepted ties persisted after    : {len(after_accepted)}")
    print(
        f"  same answer under BIT-EXACT float depths: "
        f"{offline_exact_float['matched']} re-anchored / {offline_exact_float['lost']} lost"
    )

    agree = (
        result.reanchored_tie_count == offline["matched"]
        and result.review_tie_reasons == offline["reviews"]
        and result.lost_tie_count == offline["lost"]
        and result.lost_tie_reasons == offline["reasons"]
        and len(after_accepted) == offline["matched"]
    )
    print(f"\n  implementation and independent re-derivation agree: {agree}")
    if not agree:
        print("  !! DISAGREEMENT — do not trust either number until this is explained.")

    if offline["lost_detail"]:
        print("\n--- LOST TIES ---------------------------------------------------")
        for lost in offline["lost_detail"][:40]:
            print(
                f"  edge {lost['edge_id']} section {lost['section_id']}\n"
                f"    A {lost['a']['kind']} {lost['a']['inv']} "
                f"{lost['a']['top_m']:.3f}-{lost['a']['base_m']:.3f} m "
                f"nad={lost['a']['nad']} [{lost['reason_a'] or 'matched'}]\n"
                f"    B {lost['b']['kind']} {lost['b']['inv']} "
                f"{lost['b']['top_m']:.3f}-{lost['b']['base_m']:.3f} m "
                f"nad={lost['b']['nad']} [{lost['reason_b'] or 'matched'}]"
            )
        if len(offline["lost_detail"]) > 40:
            print(f"  ... and {len(offline['lost_detail']) - 40} more")

        # --- Would "the tie follows its band" have rescued these? -------------
        # Tests the owner's model (2026-08-02): dragging a boundary moves the band,
        # so the tie should move with it.  That is implementable only where the moved
        # band is unambiguous, so count the cases rather than assert the conclusion.
        after_by_inv: dict[str, list[tuple]] = {}
        for band in after_bands:
            after_by_inv.setdefault(band[2], []).append(band)

        verdicts: Counter[str] = Counter()
        print("\n--- COULD THE TIE HAVE FOLLOWED ITS BAND? -----------------------")
        for lost in offline["lost_detail"]:
            for side in ("a", "b"):
                if lost[f"reason_{side}"] is None:
                    continue
                ep = lost[side]
                cands = _follow_candidates(ep, after_by_inv)
                same = [c for c in cands if c["same_class"]]
                if len(same) == 1:
                    verdict = "UNIQUE same-class overlap"
                elif len(same) > 1:
                    verdict = f"AMBIGUOUS — {len(same)} same-class overlaps"
                elif len(cands) == 1:
                    verdict = f"class changed — 1 overlap, nad {cands[0]['nad']}"
                elif cands:
                    verdict = f"class changed — {len(cands)} overlaps, no same-class"
                else:
                    verdict = "NO overlap at all"
                verdicts[verdict.split(" —")[0]] += 1
                print(
                    f"  {ep['inv']} {ep['top_m']:.3f}-{ep['base_m']:.3f} m "
                    f"nad={ep['nad']} [{lost[f'reason_{side}']}] -> {verdict}"
                )
                for c in cands[:4]:
                    print(
                        f"      cand nad={c['nad']:<3} {c['top_m']:.3f}-{c['base_m']:.3f} m "
                        f"overlap {c['overlap_m']:.3f} m "
                        f"({c['covers_frac'] * 100:.0f}% of the old band)"
                        f"{'  <-- same class' if c['same_class'] else ''}"
                    )
        print(f"\n  verdict tally: {dict(verdicts)}")

    if args.json:
        args.json.write_text(
            json.dumps(
                {
                    "project_id": str(project_id),
                    "accepted_ties_before": len(copy_ties),
                    "bands_before": len(copy_bands),
                    "bands_after": len(after_bands),
                    "use_case": {
                        "reanchored": result.reanchored_tie_count,
                        "lost": result.lost_tie_count,
                        "reasons": result.lost_tie_reasons,
                    },
                    "independent": {
                        "reanchored": offline["matched"],
                        "lost": offline["lost"],
                        "reasons": offline["reasons"],
                    },
                    "exact_float_variant": {
                        "reanchored": offline_exact_float["matched"],
                        "lost": offline_exact_float["lost"],
                    },
                    "agree": agree,
                    "lost_detail": offline["lost_detail"],
                },
                indent=2,
                default=str,
            ),
            encoding="utf-8",
        )
        print(f"\n  wrote {args.json}")

    await target_engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
