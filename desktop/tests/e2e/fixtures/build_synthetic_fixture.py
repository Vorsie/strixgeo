#!/usr/bin/env python3
"""Synthetic e2e fixture builder for the Strix smoke harness.

Builds a minimal but realistic project bundle and POSTs it to
``POST /projects/{id}/restore`` on the running FastAPI backend.

The fixture provides:
* 1 project ("E2E Smoke Project")
* 6 CPTs (CPTU, realistic qc/fs data across 10 m depth)
* 1 geological model with 3 formations + depth contacts at each CPT
* 1 lithostratigraphic model (empty — the spec flows call suggest/accept)
* 2 cross-sections that each corridor-include all 6 CPTs
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
# The section buffer is 2 000 m so all 6 CPTs fall inside both sections.
_SITE_X = 157_500.0  # m, Lambert72
_SITE_Y = 214_000.0  # m, Lambert72
_EPSG = 31370  # RD New → Lambert 72 (Belgian)
_VERTICAL_EPSG = 5710  # Ostend datum

# CPT grid — 6 points on a ~300 m × 300 m grid
_CPT_OFFSETS: list[tuple[float, float]] = [
    (0.0, 0.0),
    (150.0, 0.0),
    (300.0, 0.0),
    (0.0, 300.0),
    (150.0, 300.0),
    (300.0, 300.0),
]

# Realistic CPT qc profile: stiff sand layer below soft clay.
# 200 rows @ 5 cm intervals = 10 m depth.
_N_ROWS = 200
_DEPTH_STEP = 0.05  # m


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

    The profile has:
    * 0–2 m  : soft clay (qc ≈ 0.4–0.8 MPa, fs ≈ 0.02–0.04)
    * 2–5 m  : transition / silty clay (qc ≈ 1.0–2.0 MPa)
    * 5–10 m : dense sand (qc ≈ 10–20 MPa)

    A small per-CPT offset on qc creates variation so the Robertson
    segmenter produces slightly different layer boundaries per CPT —
    enough to exercise the bulk-accept flow without creating degenerate
    outputs. The u2 pore pressure is a simplified hydrostatic profile.

    Parameters
    ----------
    cpt_index : int
        0-based index used to compute the per-CPT variation offset.

    Returns
    -------
    dict[str, Any]
        Series dict matching CptSeriesOrm column names (without cpt_id).
    """
    depths: list[float] = []
    qc: list[float] = []
    fs: list[float] = []
    u2: list[float] = []

    # Small per-CPT random-looking (but deterministic) offset
    variation = (cpt_index % 3) * 0.05

    for i in range(_N_ROWS):
        depth = round((i + 1) * _DEPTH_STEP, 4)
        depths.append(depth)

        if depth <= 2.0:
            # Soft clay — Ic zone 3.3 → 4.0
            qc_val = 0.5 + variation + 0.15 * math.sin(depth * math.pi)
            fs_val = max(0.010, qc_val * 0.05)
        elif depth <= 5.0:
            # Transition
            t = (depth - 2.0) / 3.0
            qc_val = 0.8 + t * 1.5 + variation
            fs_val = max(0.010, qc_val * 0.025)
        else:
            # Dense sand — Ic zone 1.5 → 2.0
            qc_val = 10.0 + variation + 2.0 * math.sin(depth * 0.5)
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


def main() -> None:
    """Build and POST the synthetic fixture, then print the project UUID.

    The function:
    1. Validates DATABASE_URL points at an integration/test DB.
    2. Confirms the backend is reachable (GET /openapi.json).
    3. Builds the bundle dict.
    4. POSTs to ``POST /projects/<id>/restore``.
    5. Prints the project UUID on stdout (last line, bare UUID).

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

    project_id = _uid("smoke-project")
    bundle = _build_bundle(project_id)

    print(f"[fixture] POSTing bundle for project {project_id} …", file=sys.stderr)

    with httpx.Client(timeout=30.0) as client:
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
    # Last line on stdout: bare project UUID for shell capture
    print(project_id)


if __name__ == "__main__":
    main()
