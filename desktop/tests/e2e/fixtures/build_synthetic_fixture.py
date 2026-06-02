#!/usr/bin/env python3
"""Synthetic e2e fixture builder for the Strix smoke harness.

Builds a minimal but realistic project bundle and POSTs it to
``POST /projects/{id}/restore`` on the running FastAPI backend.

The fixture provides:
* 1 project ("E2E Smoke Project")
* 8 CPTs (CPTU, realistic qc/fs data across 10 m depth) in three rows
* 1 geological model with 3 formations + depth contacts at each CPT
* 1 lithostratigraphic model (empty — the spec flows call suggest/accept)
* 3 cross-sections; A (empty, build specs), B (body), C (crossing)
* No boreholes, no lab tests — not needed for the 6 spec flows

All UUIDs are deterministic (UUID5 off a fixed namespace + seed) so
running the script twice is idempotent — the second run re-POSTs the
same ids and the restore endpoint's "skip existing by id" logic
returns cleanly without duplicating.

Prerequisites
-------------
* The FastAPI backend must be running on port 8765.
* DATABASE_URL must point at the integration DB (ends in
  _integration or _test) — the script verifies this before doing
  anything so it cannot accidentally trash the dev DB.

Usage
-----
::

    # From the repo root (uv venv active):
    uv run python desktop/tests/e2e/fixtures/build_synthetic_fixture.py

    # Or with a custom API base:
    uv run python desktop/tests/e2e/fixtures/build_synthetic_fixture.py \\
        --api-base http://127.0.0.1:8765

Output
------
Prints the project UUID on stdout (last line, no trailing newline) so
the launch helper can capture it with a subshell for passing as
E2E_FIXTURE_PROJECT_ID.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import sys
import uuid
from typing import Any

import httpx

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

API_BASE = "http://127.0.0.1:8765"
_NS = uuid.UUID("e2e50000-0000-4000-a000-000000000001")

# Lambert72 coordinates for a synthetic site near Antwerp.
# The section buffer is 200 m; each row of CPTs falls inside its own section.
_SITE_X = 157_500.0  # m, Lambert72
_SITE_Y = 214_000.0  # m, Lambert72
_EPSG = 31370  # RD New → Lambert 72 (Belgian)
_VERTICAL_EPSG = 5710  # Ostend datum

# CPT grid — 8 points on three rows.
#   Row 1 (y+0)   : CPTs 0,1,2 → Section A, kept EMPTY for build-from-scratch
#                   specs (suggest → accept, band / contact / empty-space menus).
#   Row 2 (y+300) : CPTs 3,4,5 → Section B, PRE-SEEDED with committed litho
#                   contacts + a bilateral body (body/contact action specs).
#   Row 3 (y+600) : CPTs 6,7   → Section C, PRE-SEEDED with an interfingered
#                   crossing (auto-lens spec).
# The three scenarios live on DISJOINT CPTs so ``auto-correlate`` — which loads
# the whole model — can never cross-contaminate one section's data into another.
_CPT_OFFSETS: list[tuple[float, float]] = [
    (0.0, 0.0),
    (150.0, 0.0),
    (300.0, 0.0),
    (0.0, 300.0),
    (150.0, 300.0),
    (300.0, 300.0),
    (0.0, 600.0),
    (150.0, 600.0),
]

# Realistic CPT qc profile: stiff sand below silt below soft clay.
# 200 rows @ 5 cm intervals = 10 m depth.
_N_ROWS = 200
_DEPTH_STEP = 0.05  # m

# Layer scheme — CONSISTENT boundary depths across every CPT so the Robertson
# segmenter lands its contacts at the same depths everywhere. That keeps
# auto-correlate matching shallow-to-shallow (similar depth) instead of drawing
# diagonal shallow-to-deep edges, which is what near-identical-but-jittered
# profiles produced before. The three layers are well separated in qc so the
# classifier never collapses one into a degenerate full-column band.
#   0.0–2.5 m : soft clay  qc ≈ 0.6 MPa  (Ic ~ 3.5)
#   2.5–4.5 m : silt       qc ≈ 3.5 MPa  (Ic ~ 2.7)  ← pinches out on some CPTs
#   4.5–10  m : dense sand qc ≈ 16  MPa  (Ic ~ 1.8)
_CLAY_BASE_M = 2.5
_SILT_BASE_M = 4.5
# CPTs where the silt layer is ABSENT (clay runs straight to sand). The silt
# then pinches out between these and their neighbours, giving auto-correlate a
# real lens/body to close for the body-menu e2e test.
_PINCH_OUT_CPT_INDICES = {2}


# ---------------------------------------------------------------------------
# Deterministic UUID helpers
# ---------------------------------------------------------------------------


def _uid(seed: str) -> str:
    """Return a deterministic UUID5 hex-string for the given seed."""
    return str(uuid.uuid5(_NS, seed))


# ---------------------------------------------------------------------------
# Series generation
# ---------------------------------------------------------------------------


def _make_series(cpt_index: int) -> dict[str, Any]:
    """Generate a realistic 200-row CPTU series for one CPT.

    Three well-separated layers at CONSISTENT boundary depths (see the module
    constants): soft clay over silt over dense sand. The qc contrast between
    layers is large, so the Robertson segmenter produces clean, repeatable
    contacts at the same depths on every CPT — auto-correlate then matches them
    shallow-to-shallow. On the pinch-out CPTs (``_PINCH_OUT_CPT_INDICES``) the
    silt layer is absent (clay runs straight to sand), so the silt pinches out
    between those CPTs and their neighbours.

    The only per-CPT variation is a tiny depth-phase qc ripple WITHIN each
    layer — it never crosses a layer boundary, so it adds realism without
    jittering the contact depths (which is what produced diagonal
    shallow-to-deep correlations before).

    Parameters
    ----------
    cpt_index : int
        0-based index. Used only to decide whether this CPT is a pinch-out CPT
        and to phase-shift the intra-layer ripple deterministically.

    Returns
    -------
    dict[str, Any]
        Series dict matching CptSeriesOrm column names (without cpt_id).
    """
    depths: list[float] = []
    qc: list[float] = []
    fs: list[float] = []
    u2: list[float] = []

    pinch_out = cpt_index in _PINCH_OUT_CPT_INDICES
    # Deterministic per-CPT phase so the intra-layer ripple differs slightly
    # between CPTs without moving any boundary.
    phase = cpt_index * 0.7

    for i in range(_N_ROWS):
        depth = round((i + 1) * _DEPTH_STEP, 4)
        depths.append(depth)

        ripple = 0.05 * math.sin(depth * 2.0 + phase)
        if depth <= _CLAY_BASE_M:
            # Soft clay — Ic zone ~3.5
            qc_val = 0.6 + ripple
            fs_val = max(0.010, qc_val * 0.05)
        elif depth <= _SILT_BASE_M and not pinch_out:
            # Silt — Ic zone ~2.7
            qc_val = 3.5 + ripple
            fs_val = max(0.010, qc_val * 0.025)
        elif depth <= _SILT_BASE_M and pinch_out:
            # No silt here — clay continues to the sand top (pinch-out).
            qc_val = 0.7 + ripple
            fs_val = max(0.010, qc_val * 0.05)
        else:
            # Dense sand — Ic zone ~1.8
            qc_val = 16.0 + ripple
            fs_val = max(0.010, qc_val * 0.008)

        qc.append(round(qc_val, 4))
        fs.append(round(fs_val, 4))
        # Simplified u2: hydrostatic below 1 m water table
        u2_val = max(0.0, (depth - 1.0) * 0.01)  # ~10 kPa/m
        u2.append(round(u2_val, 4))

    # rf_pct computed from qc + fs (COMPUTED provenance — matches parser convention)
    rf = [round(f / max(q, 1e-6) * 100.0, 4) for q, f in zip(qc, fs)]

    return {
        "depths_m": depths,
        "qc_mpa": qc,
        "fs_mpa": fs,
        "u2_mpa": u2,
        "rf_pct": rf,
        "rf_source": "computed",
        "q_total_mpa": None,
    }


# ---------------------------------------------------------------------------
# Bundle builder
# ---------------------------------------------------------------------------


def _build_bundle(project_id: str) -> dict[str, Any]:
    """Assemble the v3 project bundle for the integration DB.

    Parameters
    ----------
    project_id : str
        The deterministic UUID for the project (hex-string).

    Returns
    -------
    dict[str, Any]
        A ``ProjectBundleRequest``-shaped dict, ready to JSON-serialise
        and POST to ``/projects/{project_id}/restore``.
    """
    # --- Project header -------------------------------------------------------
    project = {
        "id": project_id,
        "name": "E2E Smoke Project",
        "project_number": "SMOKE-2026-001",
        "client": "E2E Test Client",
        "site_label": "Smoke Site",
        "description": "Synthetic fixture for Playwright smoke harness",
        "tags": ["e2e", "smoke"],
        "default_horizontal_epsg": _EPSG,
        "default_vertical_epsg": _VERTICAL_EPSG,
        "phase": "investigation",
        "status": "active",
        "view_state": {},
    }

    # --- CPTs ------------------------------------------------------------------
    cpts: list[dict[str, Any]] = []
    cpt_ids: list[str] = []
    for i, (dx, dy) in enumerate(_CPT_OFFSETS):
        cpt_id = _uid(f"cpt-{i}")
        cpt_ids.append(cpt_id)
        x = _SITE_X + dx
        y = _SITE_Y + dy
        cpts.append(
            {
                "id": cpt_id,
                "name": f"CPT-E2E-{i + 1:02d}",
                "cpt_type": "CPTU",
                "project_id": "E2E",
                "test_id": f"test-{i + 1:02d}",
                "file_date": "2026-01-01",
                "company": "Smoke B.V.",
                "report_code": None,
                "location_x": x,
                "location_y": y,
                "elevation_m": 4.5 - i * 0.2,  # slight variation
                "epsg": _EPSG,
                "z_epsg": _VERTICAL_EPSG,
                "elevation_source": "surveyed",
                "original_elevation_m": None,
                "original_z_epsg": None,
                "original_elevation_source": None,
                "pre_drill_m": 0.0,
                "water_depth_m": None,
                "cone_area_ratio": 0.8,
                "cone_type_code": None,
                "stop_criterion": None,
                "max_depth_m": _N_ROWS * _DEPTH_STEP,
                "n_rows": _N_ROWS,
                "series": _make_series(i),
            }
        )

    # --- Geological formations ------------------------------------------------
    # Three simple formations: Quaternary (surface), Tertiary Clay, Tertiary Sand.
    geo_model_id = _uid("geo-model")
    formation_ids = [_uid(f"formation-{j}") for j in range(3)]
    formations_data = [
        ("Quaternary", "Q", "#a8d5a2", 0),
        ("Tertiary Clay", "TC", "#c2a0d8", 1),
        ("Tertiary Sand", "TS", "#f5c842", 2),
    ]

    geological_formations: list[dict[str, Any]] = []
    for j, (name, code, color, display_order) in enumerate(formations_data):
        geological_formations.append(
            {
                "id": formation_ids[j],
                "app_project_id": project_id,
                "name": name,
                "code": code,
                "color": color,
                "display_order": display_order,
                "pinned_order": False,
                "regional_ref": None,
                "description": None,
                "lithology": None,
                "nad_class": None,
                "parent_formation_id": None,
                "parent_extrapolated": False,
                "litho_main_soil_code": None,
                "litho_admixtures": None,
                "instance_ordinal": None,
                "instance_ordinal_locked": False,
            }
        )

    # --- Geological model with contacts ----------------------------------------
    # Formation contacts: top-of-formation depths at each CPT anchor.
    # Q  : top at 0.0 m (always — it's the surface)
    # TC : top at 2.0 m (onset of clay column)
    # TS : top at 5.0 m (onset of dense sand column)
    contact_depths = [0.0, 2.0, 5.0]
    contacts: list[dict[str, Any]] = []
    for cpt_id in cpt_ids:
        for j, depth in enumerate(contact_depths):
            contact_id = _uid(f"contact-{cpt_id}-{j}")
            contacts.append(
                {
                    "id": contact_id,
                    "model_id": geo_model_id,
                    "formation_id": formation_ids[j],
                    "borehole_id": None,
                    "cpt_id": cpt_id,
                    "synthetic_x": None,
                    "synthetic_y": None,
                    "synthetic_elevation_m": None,
                    "depth_top_m": depth,
                    "source": "manual_pick",
                    "observation_id": None,
                    "observation_layer_id": None,
                    "confidence": "medium",
                    "notes": None,
                }
            )

    geo_model: dict[str, Any] = {
        "id": geo_model_id,
        "app_project_id": project_id,
        "name": "Geological Model (E2E)",
        "description": "Auto-generated by build_synthetic_fixture.py",
        "is_active": True,
        "excluded_borehole_ids": [],
        "kind": "geological",
        "parent_geological_model_id": None,
        "contacts": contacts,
        "surfaces": [],
    }

    # --- Lithostratigraphic model (empty — flows call suggest/accept) ----------
    litho_model_id = _uid("litho-model")
    litho_model: dict[str, Any] = {
        "id": litho_model_id,
        "app_project_id": project_id,
        "name": "Litho Model (E2E)",
        "description": "Populated by e2e flows via suggest/accept",
        "is_active": True,
        "excluded_borehole_ids": [],
        "kind": "lithostratigraphic",
        "parent_geological_model_id": geo_model_id,
        "contacts": [],
        "surfaces": [],
    }

    geological_models = [geo_model, litho_model]

    # --- Cross-sections -------------------------------------------------------
    # Section A: east–west through the southern row of CPTs (y = _SITE_Y)
    # Section B: east–west through the northern row (y = _SITE_Y + 300)
    section_a_id = _uid("section-a")
    section_b_id = _uid("section-b")
    cross_sections: list[dict[str, Any]] = [
        {
            "id": section_a_id,
            "app_project_id": project_id,
            "name": "Section A (E2E)",
            "description": "Southern transect",
            "start_x": _SITE_X - 100.0,
            "start_y": _SITE_Y,
            "end_x": _SITE_X + 400.0,
            "end_y": _SITE_Y,
            "epsg": _EPSG,
            "projection_buffer_m": 200.0,
            "vertical_exaggeration": 5.0,
            "excluded_borehole_ids": [],
            "excluded_cpt_ids": [],
            "min_depth_m": None,
            "max_depth_m": None,
            "display_order": 0,
            "view_state": {},
            "seeded_formation_contact_ids": [],
        },
        {
            "id": section_b_id,
            "app_project_id": project_id,
            "name": "Section B (E2E)",
            "description": "Northern transect",
            "start_x": _SITE_X - 100.0,
            "start_y": _SITE_Y + 300.0,
            "end_x": _SITE_X + 400.0,
            "end_y": _SITE_Y + 300.0,
            "epsg": _EPSG,
            "projection_buffer_m": 200.0,
            "vertical_exaggeration": 5.0,
            "excluded_borehole_ids": [],
            "excluded_cpt_ids": [],
            "min_depth_m": None,
            "max_depth_m": None,
            "display_order": 1,
            "view_state": {},
            "seeded_formation_contact_ids": [],
        },
        {
            "id": _uid("section-c"),
            "app_project_id": project_id,
            "name": "Section C (E2E)",
            "description": "Third transect — pre-seeded crossing (auto-lens)",
            "start_x": _SITE_X - 100.0,
            "start_y": _SITE_Y + 600.0,
            "end_x": _SITE_X + 400.0,
            "end_y": _SITE_Y + 600.0,
            "epsg": _EPSG,
            "projection_buffer_m": 200.0,
            "vertical_exaggeration": 5.0,
            "excluded_borehole_ids": [],
            "excluded_cpt_ids": [],
            "min_depth_m": None,
            "max_depth_m": None,
            "display_order": 2,
            "view_state": {},
            "seeded_formation_contact_ids": [],
        },
    ]

    # --- Assemble bundle -------------------------------------------------------
    return {
        "format_version": 3,
        "project": project,
        "cpts": cpts,
        "boreholes": [],
        "geological_formations": geological_formations,
        "geotechnical_units": [],
        "geological_models": geological_models,
        "cross_sections": cross_sections,
        "investigation_reviews": [],
        "litho_correlation_edges": [],
        "litho_lenses": [],
        "formation_absences": [],
    }


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def _cleanup_litho_state(client: httpx.Client, api_base: str, project_id: str) -> None:
    """Delete all spec-created state for the fixture project so each run starts clean.

    The restore endpoint is idempotent (it skips existing rows), but it cannot
    remove rows created by previous spec runs (scratch formations / models from
    flow_crossing_validator and flow_build_3d_model, failed-cleanup formations
    from flow_create_formation, accepted litho contacts, correlation edges, etc.).
    This function removes all of them via the API DELETE endpoints before the
    restore so the project is in the same baseline state every run.

    Cleaned up in order (FK cascades handle the rest):
    1. All non-fixture geological models — cascades their contacts + surfaces.
       The fixture geological model is identified by its deterministic UUID.
    2. All lithostratigraphic models — cascades contacts, edges, lens metadata.
    3. All non-fixture formations — covers scratch formations left by failed tests
       (flow_crossing_validator A/B, flow_create_formation leaks) AND litho child
       formations created by the accept flow.

    Parameters
    ----------
    client : httpx.Client
        Shared HTTP client (connected to the running backend).
    api_base : str
        Base URL of the FastAPI backend (no trailing slash).
    project_id : str
        UUID of the fixture project to clean.
    """
    geology_base = f"{api_base}/projects/{project_id}/geology"

    # Deterministic fixture IDs — these are the ONLY rows we keep.
    fixture_geo_model_id = _uid("geo-model")
    fixture_formation_ids = {_uid(f"formation-{j}") for j in range(3)}

    # 1. Delete all non-fixture geological models (scratch models from tests).
    #    Cascade deletes their formation_contact + formation_surface rows.
    models_resp = client.get(f"{geology_base}/models")
    if models_resp.status_code == 200:
        for model in models_resp.json():
            mid = model["id"]
            if mid == fixture_geo_model_id:
                continue  # Keep the fixture geological model.
            del_resp = client.delete(f"{geology_base}/models/{mid}")
            if del_resp.status_code == 204:
                print(
                    f"[fixture] Deleted scratch/litho model {mid} (kind={model.get('kind')!r})",
                    file=sys.stderr,
                )
            elif del_resp.status_code == 404:
                pass  # Already gone — fine.
            else:
                print(
                    f"[fixture] WARNING: DELETE /models/{mid} returned {del_resp.status_code}",
                    file=sys.stderr,
                )

    # 2. Delete all non-fixture formations.
    #    This covers: litho child formations (parent_formation_id set),
    #    scratch formations (E2E-Crossing-*, E2E-Formation-*) left by
    #    failed test cleanups.
    formations_resp = client.get(f"{geology_base}/formations")
    if formations_resp.status_code == 200:
        extra_ids = [
            f["id"] for f in formations_resp.json() if f["id"] not in fixture_formation_ids
        ]
        for fid in extra_ids:
            del_resp = client.delete(f"{geology_base}/formations/{fid}")
            if del_resp.status_code not in (204, 404):
                print(
                    f"[fixture] WARNING: DELETE /formations/{fid} returned {del_resp.status_code}",
                    file=sys.stderr,
                )
        if extra_ids:
            print(
                f"[fixture] Deleted {len(extra_ids)} non-fixture formation(s)",
                file=sys.stderr,
            )


async def _seed_action_scenarios_async(project_id: str) -> None:
    """Seed the pre-built scenarios the UI ACTION specs drive against.

    Runs AFTER the REST restore via a direct DB session — the bilateral body's
    closure edges are cross-lithology, which the REST correlate endpoint
    rejects. Idempotency is handled upstream: ``_cleanup_litho_state`` deletes
    the prior run's demo formations before restore, and ``formation_id`` is
    ``ondelete=CASCADE`` so their bodies / contacts / edges cascade away.

    Seeds on DISJOINT sections so ``auto-correlate`` (which loads the whole
    model) never cross-contaminates:
      * Section B (CPTs 3/4/5): committed litho contacts + a bilateral body
        (source CPT-4 cap@2 / body@4 / base@6, single targets @3 on CPT-3/5,
        four approved edges) → body + contact action specs.
      * Section C (CPTs 6/7): an interfingered ZAND/KLEI crossing (no edges —
        the auto-lens spec runs auto-correlate to surface the lens diamond).
    """
    from uuid import UUID

    from sqlalchemy import select
    from uuid6 import uuid7

    from groundmodel.application.detect_bodies import DetectBodies
    from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
    from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
    from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
    from groundmodel.infrastructure.db.models.geological_formation_orm import (
        GeologicalFormationOrm,
    )
    from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
        LithoContactCorrelationEdgeOrm,
    )
    from groundmodel.infrastructure.db.session import AsyncSessionFactory

    pid = UUID(project_id)
    mid = UUID(_uid("litho-model"))
    parent = UUID(_uid("formation-0"))  # Quaternary geological formation
    sec_b = UUID(_uid("section-b"))
    sec_c = UUID(_uid("section-c"))
    cpt3, cpt4, cpt5 = UUID(_uid("cpt-3")), UUID(_uid("cpt-4")), UUID(_uid("cpt-5"))
    cpt6, cpt7 = UUID(_uid("cpt-6")), UUID(_uid("cpt-7"))

    async with AsyncSessionFactory() as s:

        def form(name: str, soil: str, order: int, color: str) -> GeologicalFormationOrm:
            f = GeologicalFormationOrm(
                id=uuid7(),
                app_project_id=pid,
                name=name,
                color=color,
                display_order=order,
                parent_formation_id=parent,
                litho_main_soil_code=soil,
            )
            s.add(f)
            return f

        def contact(f: GeologicalFormationOrm, cpt: UUID, depth: float) -> FormationContactOrm:
            c = FormationContactOrm(
                id=uuid7(),
                model_id=mid,
                formation_id=f.id,
                cpt_id=cpt,
                depth_top_m=depth,
                source="manual_pick",
                confidence="medium",
            )
            s.add(c)
            return c

        def edge(ca: FormationContactOrm, cb: FormationContactOrm) -> None:
            a, b = (ca.id, cb.id) if ca.id < cb.id else (cb.id, ca.id)
            s.add(
                LithoContactCorrelationEdgeOrm(
                    id=uuid7(),
                    model_id=mid,
                    contact_a_id=a,
                    contact_b_id=b,
                    source="manual",
                    user_approved=True,
                )
            )

        # --- Body scenario (Section B) ---
        f_top = form("ZAND top cap (action seed)", "ZAND", 30, "#f5c842")
        f_body = form("KLEI body (action seed)", "KLEI", 31, "#c2a0d8")
        f_base = form("ZAND base cap (action seed)", "ZAND", 32, "#f5c842")
        f_tgt = form("ZAND target (action seed)", "ZAND", 33, "#f5c842")
        await s.flush()
        c_top = contact(f_top, cpt4, 2.0)
        c_body = contact(f_body, cpt4, 4.0)
        c_base = contact(f_base, cpt4, 6.0)
        c_left = contact(f_tgt, cpt3, 3.0)
        c_right = contact(f_tgt, cpt5, 3.0)
        await s.flush()
        edge(c_body, c_left)
        edge(c_base, c_left)
        edge(c_body, c_right)
        edge(c_base, c_right)
        body_contact_ids = [c_top.id, c_body.id, c_base.id, c_left.id, c_right.id]

        # --- Crossing scenario (Section C) — no edges; auto-lens creates them ---
        f_zand = form("ZAND crossing (action seed)", "ZAND", 40, "#f5c842")
        f_klei = form("KLEI crossing (action seed)", "KLEI", 41, "#c2a0d8")
        await s.flush()
        x1 = contact(f_zand, cpt6, 1.0)
        x2 = contact(f_klei, cpt6, 5.0)
        x3 = contact(f_zand, cpt7, 5.0)
        x4 = contact(f_klei, cpt7, 1.0)
        crossing_contact_ids = [x1.id, x2.id, x3.id, x4.id]
        await s.flush()

        # Make the contacts visible on their sections (explicit-content invariant).
        sb = (
            await s.execute(select(CrossSectionOrm).where(CrossSectionOrm.id == sec_b))
        ).scalar_one()
        sb.seeded_formation_contact_ids = list(
            set(sb.seeded_formation_contact_ids or []) | set(body_contact_ids)
        )
        sc = (
            await s.execute(select(CrossSectionOrm).where(CrossSectionOrm.id == sec_c))
        ).scalar_one()
        sc.seeded_formation_contact_ids = list(
            set(sc.seeded_formation_contact_ids or []) | set(crossing_contact_ids)
        )
        await s.commit()

        # Resolve instance ordinals (DetectBodies needs them), then detect the
        # bilateral body. The crossing has no edges → no body forms there.
        await ResolveLithoInstances(s).execute(model_id=mid)
        await s.commit()
        res = await DetectBodies(s).execute(project_id=pid, model_id=mid, prefer_section_id=sec_b)
        await s.commit()
        print(
            f"[fixture] action scenarios seeded — bodies_created={res.bodies_created} "
            f"(body on Section B, crossing on Section C)",
            file=sys.stderr,
        )


def main() -> None:
    """Build and POST the synthetic fixture, then print the project UUID.

    The function:
    1. Validates DATABASE_URL points at an integration/test DB.
    2. Confirms the backend is reachable (GET /openapi.json).
    3. Cleans up any litho-derived state from a previous run (so each run
       starts with the same baseline — no stale accepted contacts or litho
       formations that would make accept-count assertions non-deterministic).
    4. Builds the bundle dict.
    5. POSTs to ``POST /projects/<id>/restore``.
    6. Prints the project UUID on stdout (last line, bare UUID).

    Raises
    ------
    SystemExit
        On any failure (bad DB URL, unreachable backend, non-2xx restore).
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--api-base",
        default=os.environ.get("E2E_API_BASE", API_BASE),
        help="Base URL of the FastAPI backend (default: http://127.0.0.1:8765)",
    )
    args = parser.parse_args()
    api_base: str = args.api_base.rstrip("/")

    # Safety guard: refuse to run against the dev DB
    db_url = os.environ.get(
        "DATABASE_URL",
        "postgresql://groundmodel:groundmodel@localhost:5433/groundmodel_integration",
    ).lower()
    db_name = db_url.rsplit("/", 1)[-1].split("?", 1)[0]
    if not (db_name.endswith("_integration") or db_name.endswith("_test")):
        print(
            f"ERROR: DATABASE_URL must end in _integration or _test.\n"
            f"Current DB name: {db_name!r}\n"
            "Set DATABASE_URL to groundmodel_integration before running fixture.",
            file=sys.stderr,
        )
        sys.exit(1)

    project_id = _uid("smoke-project")

    # Check backend reachability
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(f"{api_base}/openapi.json")
            resp.raise_for_status()
    except Exception as exc:  # noqa: BLE001
        print(
            f"ERROR: FastAPI backend not reachable at {api_base}.\n"
            f"Start the backend before running the fixture builder.\n"
            f"Detail: {exc}",
            file=sys.stderr,
        )
        sys.exit(2)

    bundle = _build_bundle(project_id)

    # Clean up any litho state left over from a previous run so each run
    # starts with the same baseline state.  The restore below is idempotent
    # for the base geological model + CPTs, but cannot remove rows that
    # previous spec runs added (accepted contacts, child formations, etc.).
    with httpx.Client(timeout=30.0) as client:
        print(f"[fixture] Cleaning up litho state for project {project_id} …", file=sys.stderr)
        _cleanup_litho_state(client, api_base, project_id)

        print(f"[fixture] POSTing bundle for project {project_id} …", file=sys.stderr)
        resp = client.post(
            f"{api_base}/projects/{project_id}/restore",
            content=json.dumps(bundle),
            headers={"Content-Type": "application/json"},
        )
        if resp.status_code not in (200, 201):
            print(
                f"ERROR: restore returned HTTP {resp.status_code}.\nBody: {resp.text[:500]}",
                file=sys.stderr,
            )
            sys.exit(3)

    print(f"[fixture] Restore OK — project {project_id}", file=sys.stderr)

    # Seed the action-spec scenarios (body on Section B, crossing on Section C)
    # via a direct DB session — see ``_seed_action_scenarios_async``.
    print(f"[fixture] Seeding action scenarios for project {project_id} …", file=sys.stderr)
    asyncio.run(_seed_action_scenarios_async(project_id))

    # Last line on stdout: bare project UUID for shell capture
    print(project_id)


if __name__ == "__main__":
    main()
