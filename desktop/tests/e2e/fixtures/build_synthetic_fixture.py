#!/usr/bin/env python3
"""Synthetic e2e fixture builder for the Strix smoke harness.

Builds a minimal but realistic project bundle and POSTs it to
``POST /projects/{id}/restore`` on the running FastAPI backend.

The fixture provides:
* 1 project ("E2E Smoke Project")
* 8 CPTs (CPTU, realistic qc/fs data across 10 m depth) in three rows
* 1 borehole (Section B, east end) sharing the seeded KLEI/ZAND litho
  bodies with CPT-5 — the shape the borehole packing preview needs
* 1 geological model with 3 formations + depth contacts at each CPT
* 1 lithostratigraphic model (empty — the spec flows call suggest/accept)
* 6 cross-sections; A (empty, build specs), B (body), C (crossing),
  D (per-instance), E (facies competition), F (two disjoint same-class
  KLEI bodies for the Join verb)
* 1 GEOTECHNICAL model (kind='geotechnical', parent = the litho model)
  seeded through the REAL pipeline verbs — ``subdivide-all-bodies``
  (packing bands + proposed ties) followed by the model-wide accept verb
  — so Section B carries accepted NAD packing bands and approved geotech
  correlation edges, and fence panels exist for the Parameters stage's
  fence cutout (``flow_unit_statistics``). See ``_seed_geotech_model``.
* No lab tests — not needed for the 6 spec flows

All UUIDs are deterministic (UUID5 off a fixed namespace + seed) so
running the script twice is idempotent — the second run re-POSTs the
same ids and the restore endpoint's "skip existing by id" logic
returns cleanly without duplicating.  The geotech model's rows are the
one exception: the pipeline verbs mint uuid7 ids, so the geotech model /
formation / layer / edge ids CHANGE per seed while their CONTENT (NAD
classes, depths, tie topology — everything a golden screenshot renders)
stays deterministic.  Specs must resolve geotech ids through the API at
runtime, never hard-code them.

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

# CPT grid — 11 points on five rows.
#   Row 1 (y+0)    : CPTs 0,1,2   → Section A, kept EMPTY for build-from-scratch
#                    specs (suggest → accept, band / contact / empty-space menus).
#   Row 2 (y+300)  : CPTs 3,4,5   → Section B, PRE-SEEDED with committed litho
#                    contacts + a bilateral body (body/contact action specs).
#   Row 3 (y+600)  : CPTs 6,7     → Section C, PRE-SEEDED with an interfingered
#                    crossing (auto-lens spec).
#   Row 4 (y+900)  : CPTs 8,9,10  → Section D, PRE-SEEDED with TWO uncorrelated
#                    same-lithology (KLEI) bodies at different depths on the
#                    centre CPT — the per-instance body spec
#                    (flow_per_instance_body): two distinct depth-ranked labels
#                    (QC1 / QC2), merge-on-correlate, and no-jump framing.
#   Row 5 (y+1200) : CPTs 11,12,13 → Section E, PRE-SEEDED with a FACIES
#                    COMPETITION scenario: a shared KLEI body has two different
#                    bodies directly above it (ZAND on CPTs 11/12, VEEN on CPT
#                    13). This triggers the ``assemble_facies_competitors`` path
#                    in ``build_body_solids`` (the multi-patch solid builder).
# The five scenarios live on DISJOINT CPTs so ``auto-correlate`` — which loads
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
    (0.0, 900.0),
    (150.0, 900.0),
    (300.0, 900.0),
    # Section E — facies competition (CPTs 11, 12, 13). The MIDDLE CPT (index
    # 12) is offset +60 m in Y so the three facies anchors are NON-COLLINEAR.
    # The shared KLEI body's 3-point footprint must triangulate for
    # ``build_body_solids`` to fit a TIN and route the competitors (ZAND, VEEN)
    # through ``assemble_facies_competitors`` — three CPTs on a perfectly
    # straight E-W line give SciPy Delaunay a degenerate (collinear) point set
    # → 0 triangles → every facies body falls back to flagged disk markers and
    # the facies prism path never fires. The +60 m stagger stays well inside
    # Section E's 200 m projection buffer so all three CPTs still project onto
    # the section.
    (0.0, 1200.0),
    (150.0, 1260.0),
    (300.0, 1200.0),
    # Section F — the same-class Join target (CPTs 14, 15, 16 at y+1500). Two
    # geometrically DISJOINT KLEI bodies (shallow + deep) both classified to ONE
    # NAD class, so ``flow_join_body_ui`` has two same-colour regions of DIFFERENT
    # bodies to join. Unlike the per-instance CPTs (8/9/10) these carry a qc series
    # (uniform clay, see ``_make_uniform_clay_series``) so ``subdivide-all-bodies``
    # classifies both bodies — Section D stays deliberately series-less. 300 m from
    # Section E (buffer 200 m), so nothing cross-projects.
    (0.0, 1500.0),
    (150.0, 1500.0),
    (300.0, 1500.0),
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

# The crossing CPTs (Section C) are DEDICATED to the pre-seeded ZAND/KLEI
# inversion and carry NO qc series. The litho segmenter reuses formations by
# litho code, so if these CPTs had a realistic profile every all-CPT seeder
# (suggest-litho + accept) would assign segmenter ZAND/KLEI contacts onto the
# very "crossing (action seed)" formations the crossing lives on — burying the
# clean inversion. With no series, ``suggest-litho`` returns no layers (the
# seeders skip the CPT) so the crossing stays pristine no matter what other
# specs run first. The explicit crossing contacts are still seeded directly in
# ``_seed_action_scenarios_async`` (independent of any series).
_CROSSING_CPT_INDICES = {6, 7}

# The per-instance CPTs (Section D) are likewise DEDICATED and carry NO qc
# series, for the same reason as the crossing CPTs: ``suggest-litho`` returns no
# layers for a series-less CPT, so every all-CPT seeder (suggest + accept) skips
# them and the pre-seeded two-instance scenario stays pristine no matter what
# other specs run first. CPT 8 = centre/source (two KLEI units), 9 = left
# target, 10 = right target.
_PER_INSTANCE_CPT_INDICES = {8, 9, 10}

# The facies CPTs (Section E) are DEDICATED and carry NO qc series, for the
# same reason as the crossing / per-instance CPTs: ``suggest-litho`` returns no
# layers for a series-less CPT, so every all-CPT seeder skips them and the
# pre-seeded facies scenario stays pristine.
_FACIES_CPT_INDICES = {11, 12, 13}

# The same-class-pair CPTs (Section F) carry a UNIFORM CLAY qc series, NOT the
# three-layer profile: two geometrically DISJOINT KLEI bodies (shallow @2/3 m,
# deep @7/8 m) separated by a ZAND band are action-seeded across CPTs 14/15/16,
# and ``subdivide-all-bodies`` reads this series to classify all three bands. A
# uniform qc means both KLEI depth ranges land in the SAME NAD class — the join
# spec (flow_join_body_ui) needs two same-colour regions of DIFFERENT bodies, and
# same-class is same-colour. The qc value is chosen from the KLEI-clean band of
# ``NAD_QC_BANDS`` (``nad_classification_constants.py``): ``[(1.0, 21), (2.0, 22),
# (4.0, 23), (None, 24)]`` — 1.0 <= qc < 2.0 is class 22 (KLEI, matig vast).
# ``_CLAY_QC_MPA`` = 1.5 sits mid-band, safely clear of both 1.0 and 2.0
# boundaries, so both KLEI bands classify to 22 by construction; the same qc on
# the ZAND separator lands in the ZAND ``[2.0, 4.0)`` band -> class 5, a distinct
# class the resolver never unions with the KLEI (different soil). The ZAND band is
# what keeps the two KLEI bands from touching: without it the gap-free litho column
# would butt the shallow KLEI's base against the deep KLEI's top and the resolver
# would MERGE them into one body (owner 2026-08-19), leaving nothing to join. See
# ``_seed_action_scenarios_async`` (Section F block) for the full rationale.
# Because the series is uniform (no qc contrast), ``suggest-litho`` cannot
# manufacture a competing layer, so even under an all-CPT suggest+accept run the
# two KLEI bodies stay class 22 and disjoint — always a same-class pair to join.
_SAME_CLASS_PAIR_CPT_INDICES = {14, 15, 16}

# Uniform-clay qc for the Section F CPTs — mid-band of KLEI class 22 (see above).
_CLAY_QC_MPA = 1.5

# CPTs that carry NO qc series (dedicated pre-seeded scenarios — see above).
_SERIESLESS_CPT_INDICES = _CROSSING_CPT_INDICES | _PER_INSTANCE_CPT_INDICES | _FACIES_CPT_INDICES

# The fixture's only BOREHOLE, on Section B's transect (y+300), 60 m east of
# CPT-5 and 40 m short of the section's east end so it projects inside the
# corridor. It exists for one reason no other scenario covered: the borehole
# packing preview (``POST .../geotech/divide-boreholes/preview``) plans bands
# only for a borehole whose accepted litho layers sit in the SAME resolver body
# as a CPT's — ``DivideBoreholes.plan`` walks ``load_body_picks``, which skips
# any layer with a NULL ``body_id`` (an uncorrelated singleton). So the borehole
# is given the SAME two seeded formations as CPT-3/4/5 (KLEI top @2 m, ZAND base
# @5 m) and its contacts are correlated to CPT-5's on Section B, which puts it
# in both bodies. ``Subdivide all bodies`` writes CPT bands only, so the
# borehole column stays blank after SAB — exactly the state the preview exists
# to fill in.
#
# Placed at the EAST END of the transect on purpose: appending a fourth column
# beyond CPT-5 leaves the seeded 3-column body intact, where a borehole dropped
# between two CPTs would split it. It is 300 m from Sections A and C (buffer
# 200 m), so it projects onto Section B and nothing else.
_BOREHOLE_OFFSET: tuple[float, float] = (360.0, 300.0)

# Total depth of the borehole. The FC→LL trigger derives the DEEPEST litho
# layer's ``depth_base_m`` from ``borehole.total_depth_m`` (there is no next
# contact to bound it), so this value IS the base of the ZAND unit — keep it
# equal to the CPTs' 10 m so the body's base is flat across the section.
_BOREHOLE_TOTAL_DEPTH_M = 10.0


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


def _empty_series() -> dict[str, Any]:
    """Return an empty CPTU series (no rows).

    Used for the dedicated crossing CPTs so the litho segmenter has nothing to
    segment and every all-CPT seeder skips them (see ``_CROSSING_CPT_INDICES``).

    Returns
    -------
    dict
        The series dict with empty arrays for every channel.
    """
    return {
        "depths_m": [],
        "qc_mpa": [],
        "fs_mpa": [],
        "u2_mpa": [],
        "rf_pct": [],
        "rf_source": "computed",
        "q_total_mpa": None,
    }


def _make_uniform_clay_series() -> dict[str, Any]:
    """Return a 200-row CPTU series of UNIFORM clay-firm qc (Section F).

    Every row carries ``_CLAY_QC_MPA`` (1.5 MPa), which sits mid-band of the
    KLEI-clean NAD class 22 (``NAD_QC_BANDS``, see ``_SAME_CLASS_PAIR_CPT_INDICES``).
    Because the value is the same at every depth, the two KLEI bodies seeded on
    Section F (shallow ~2-3 m, deep ~7-8 m) BOTH classify to class 22 when
    ``subdivide-all-bodies`` reads their median qc — the two same-colour regions
    ``flow_join_body_ui`` joins. The series has full valid-qc coverage, so no band
    ever trips the "needs review" thin-coverage guard.

    Returns
    -------
    dict[str, Any]
        The series dict matching CptSeriesOrm column names (without cpt_id).
    """
    depths = [round((i + 1) * _DEPTH_STEP, 4) for i in range(_N_ROWS)]
    qc = [_CLAY_QC_MPA] * _N_ROWS
    # fs from a clay-typical friction ratio (~5 %), matching the soft-clay branch
    # of ``_make_series``; u2 hydrostatic below a 1 m water table.
    fs = [round(max(0.010, _CLAY_QC_MPA * 0.05), 4)] * _N_ROWS
    u2 = [round(max(0.0, (d - 1.0) * 0.01), 4) for d in depths]
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
        # Dedicated pre-seeded scenario CPTs carry no series (crossing +
        # per-instance + facies — see _SERIESLESS_CPT_INDICES). Section F's CPTs
        # carry a UNIFORM CLAY series so subdivide classifies its two disjoint
        # KLEI bodies to one NAD class (_SAME_CLASS_PAIR_CPT_INDICES); every other
        # column gets the realistic three-layer profile.
        is_seriesless = i in _SERIESLESS_CPT_INDICES
        if is_seriesless:
            series = _empty_series()
        elif i in _SAME_CLASS_PAIR_CPT_INDICES:
            series = _make_uniform_clay_series()
        else:
            series = _make_series(i)
        n_rows = 0 if is_seriesless else _N_ROWS
        # Every CPT is pushed the same depth. A series-less CPT has no ROWS, but it
        # was still pushed — the two are different facts, and conflating them wrote
        # ``max_depth_m = 0.0``, which is not "unknown" to anything downstream.
        # The litho mirror trigger derives the deepest layer's base as
        # ``GREATEST(top + 0.001, COALESCE(next_top, borehole.total_depth_m,
        # cpt.max_depth_m, top + 1.0))``, and COALESCE skips NULL but not zero — so
        # every series-less column's deepest litho layer collapsed to ONE MILLIMETRE.
        # Sub-pixel at any zoom, and the partition engine emits nothing for it, which
        # is what made ``flow_per_instance_body`` fail (filed against the partition
        # engine for six days) and what left Section D's right-hand gap unfilled.
        max_depth = _N_ROWS * _DEPTH_STEP
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
                "max_depth_m": max_depth,
                "n_rows": n_rows,
                "series": series,
            }
        )

    # --- Borehole --------------------------------------------------------------
    # One borehole on Section B's transect (see _BOREHOLE_OFFSET). No drill
    # segments / field logs / observations / samples: the packing preview reads
    # the borehole's LITHO layers (seeded in _seed_action_scenarios_async) and
    # its XY + collar elevation, nothing else. ``project_id`` / ``test_id`` are
    # distinct from every CPT's and from the per-spec seed boreholes
    # (BH-E2E-STRAT, BH-FLOW-S) so the source-dedup unique key never collides.
    borehole_id = _uid("borehole-0")
    bh_dx, bh_dy = _BOREHOLE_OFFSET
    boreholes: list[dict[str, Any]] = [
        {
            "id": borehole_id,
            "name": "BH-E2E-01",
            "project_id": "E2E-BH",
            "test_id": "bh-01",
            "location_x": _SITE_X + bh_dx,
            "location_y": _SITE_Y + bh_dy,
            "elevation_m": 3.6,  # between CPT-4 (3.7) and CPT-5 (3.5)
            "epsg": _EPSG,
            "z_epsg": _VERTICAL_EPSG,
            "elevation_source": "surveyed",
            "original_elevation_m": None,
            "original_z_epsg": None,
            "original_elevation_source": None,
            "start_date": "2026-01-01",
            "drill_method": "spoelboring",
            "borehole_type": "geotechnisch",
            "purpose": None,
            "municipality": None,
            "executor": "Smoke B.V.",
            "total_depth_m": _BOREHOLE_TOTAL_DEPTH_M,
            "water_table_depth_m": 1.0,
            "n_drill_segments": 0,
            "n_field_log_intervals": 0,
            "drill_segments": [],
            "field_log_intervals": [],
            "observations": [],
            "samples": [],
        }
    ]

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
        "parent_model_id": None,
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
        "parent_model_id": geo_model_id,
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
        {
            "id": _uid("section-d"),
            "app_project_id": project_id,
            "name": "Section D (E2E)",
            "description": "Fourth transect — pre-seeded two-instance bodies (per-instance)",
            "start_x": _SITE_X - 100.0,
            "start_y": _SITE_Y + 900.0,
            "end_x": _SITE_X + 400.0,
            "end_y": _SITE_Y + 900.0,
            "epsg": _EPSG,
            "projection_buffer_m": 200.0,
            "vertical_exaggeration": 5.0,
            "excluded_borehole_ids": [],
            "excluded_cpt_ids": [],
            "min_depth_m": None,
            "max_depth_m": None,
            "display_order": 3,
            "view_state": {},
            "seeded_formation_contact_ids": [],
        },
        {
            "id": _uid("section-e"),
            "app_project_id": project_id,
            "name": "Section E (E2E)",
            "description": (
                "Fifth transect — pre-seeded facies competition: ZAND (CPTs 11/12)"
                " and VEEN (CPT 13) both above a shared KLEI body"
            ),
            "start_x": _SITE_X - 100.0,
            "start_y": _SITE_Y + 1200.0,
            "end_x": _SITE_X + 400.0,
            "end_y": _SITE_Y + 1200.0,
            "epsg": _EPSG,
            "projection_buffer_m": 200.0,
            "vertical_exaggeration": 5.0,
            "excluded_borehole_ids": [],
            "excluded_cpt_ids": [],
            "min_depth_m": None,
            "max_depth_m": None,
            "display_order": 4,
            "view_state": {},
            "seeded_formation_contact_ids": [],
        },
        {
            "id": _uid("section-f"),
            "app_project_id": project_id,
            "name": "Section F (E2E)",
            "description": (
                "Sixth transect — two disjoint same-class KLEI bodies (shallow +"
                " deep) for the Join verb (flow_join_body_ui)"
            ),
            "start_x": _SITE_X - 100.0,
            "start_y": _SITE_Y + 1500.0,
            "end_x": _SITE_X + 400.0,
            "end_y": _SITE_Y + 1500.0,
            "epsg": _EPSG,
            "projection_buffer_m": 200.0,
            "vertical_exaggeration": 5.0,
            "excluded_borehole_ids": [],
            "excluded_cpt_ids": [],
            "min_depth_m": None,
            "max_depth_m": None,
            "display_order": 5,
            "view_state": {},
            "seeded_formation_contact_ids": [],
        },
    ]

    # --- Assemble bundle -------------------------------------------------------
    return {
        "format_version": 3,
        "project": project,
        "cpts": cpts,
        "boreholes": boreholes,
        "geological_formations": geological_formations,
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
      * Section B (CPTs 3/4/5 + BH-E2E-01): committed litho contacts + a
        bilateral body (source CPT-4 cap@2 / body@4 / base@6, single targets @3
        on CPT-3/5, four approved edges) → body + contact action specs. The
        borehole carries the SAME two units, correlated to CPT-5, so it joins
        both resolver bodies — the precondition for the borehole packing
        preview (see ``_BOREHOLE_OFFSET``).
      * Section C (CPTs 6/7): an interfingered ZAND/KLEI crossing (no edges —
        the auto-lens spec runs auto-correlate to surface the lens diamond).
    """
    from uuid import UUID

    from sqlalchemy import select
    from uuid6 import uuid7

    # Register every ORM table in the metadata so FK targets (project,
    # geological_model, …) resolve in this direct-session path. Previously these
    # were pulled in transitively via the now-deleted DetectBodies import.
    import groundmodel.infrastructure.db.models  # noqa: F401
    from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
    from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
    from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
    from groundmodel.infrastructure.db.models.geological_formation_orm import (
        GeologicalFormationOrm,
    )
    from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
        LithoContactCorrelationEdgeOrm,
    )

    # ``project`` is the one body-FK target not re-exported by the models package
    # __init__; import it explicitly so the metadata can resolve body.app_project_id.
    from groundmodel.infrastructure.db.models.project_orm import ProjectOrm  # noqa: F401
    from groundmodel.infrastructure.db.session import AsyncSessionFactory

    pid = UUID(project_id)
    mid = UUID(_uid("litho-model"))
    parent = UUID(_uid("formation-0"))  # Quaternary geological formation
    sec_b = UUID(_uid("section-b"))
    sec_c = UUID(_uid("section-c"))
    sec_d = UUID(_uid("section-d"))
    sec_e = UUID(_uid("section-e"))
    sec_f = UUID(_uid("section-f"))
    cpt3, cpt4, cpt5 = UUID(_uid("cpt-3")), UUID(_uid("cpt-4")), UUID(_uid("cpt-5"))
    cpt6, cpt7 = UUID(_uid("cpt-6")), UUID(_uid("cpt-7"))
    cpt8, cpt9, cpt10 = UUID(_uid("cpt-8")), UUID(_uid("cpt-9")), UUID(_uid("cpt-10"))
    cpt11, cpt12, cpt13 = UUID(_uid("cpt-11")), UUID(_uid("cpt-12")), UUID(_uid("cpt-13"))
    cpt14, cpt15, cpt16 = UUID(_uid("cpt-14")), UUID(_uid("cpt-15")), UUID(_uid("cpt-16"))
    bh0 = UUID(_uid("borehole-0"))

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

        def contact(
            f: GeologicalFormationOrm,
            anchor: UUID,
            depth: float,
            *,
            kind: str = "cpt",
        ) -> FormationContactOrm:
            """Seed one litho contact on a CPT (default) or a borehole column.

            ``formation_contact`` uses an XOR anchor — exactly one of
            ``cpt_id`` / ``borehole_id`` is set — so the anchor column is
            selected by *kind* rather than by a second near-identical helper.
            """
            c = FormationContactOrm(
                id=uuid7(),
                model_id=mid,
                formation_id=f.id,
                cpt_id=anchor if kind == "cpt" else None,
                borehole_id=anchor if kind == "borehole" else None,
                depth_top_m=depth,
                source="manual_pick",
                confidence="medium",
            )
            s.add(c)
            return c

        def edge(ca: FormationContactOrm, cb: FormationContactOrm, *, section_id: UUID) -> None:
            """Insert an approved correlation edge stamped to the given section."""
            a, b = (ca.id, cb.id) if ca.id < cb.id else (cb.id, ca.id)
            s.add(
                LithoContactCorrelationEdgeOrm(
                    id=uuid7(),
                    model_id=mid,
                    layer_a_id=a,
                    layer_b_id=b,
                    source="manual",
                    user_approved=True,
                    section_id=section_id,
                )
            )

        # --- Body scenario (Section B) ---
        # New body model: ``ResolveLithoInstances`` creates ONE body per
        # connected component of accepted layers, and the body's representative
        # formation = the SHALLOWEST member layer's formation (resolve_litho_
        # instances._key). So for the body wedge to render as a KLEI body sourced
        # at CPT-4, the KLEI body-top contact MUST be SHALLOWER than its bilateral
        # ZAND targets — otherwise a deeper-than-target KLEI gets buried as a
        # member of a ZAND-representative body (which the detector then frames on
        # the wrong column / no source member on Section B → "body-extent-fill not
        # found"). This mirrors the working Section D per-instance topology: KLEI
        # top @2 m closes bilaterally to ZAND targets @3 m on CPT-3 + CPT-5, with
        # the body framed by (KLEI@2, ZAND@4) on the source column CPT-4.
        #   CPT-4 (source): KLEI@2 (body top) / ZAND@4 (body base)
        #   CPT-3 (left target):  ZAND@3
        #   CPT-5 (right target): ZAND@3
        # The KLEI body's top (@2) is shallower than the targets (@3) so the
        # connected component {KLEI@2, ZAND@4, ZAND@3-L, ZAND@3-R} resolves to a
        # KLEI representative sourced at CPT-4 — exactly the body the action specs
        # right-click on Section B.
        # Partition model: the resolver makes ONE body per connected component of
        # SAME-lithology correlated layers (it DROPS cross-litho edges). A KLEI
        # body spanning Section B = a KLEI unit on CPT-3/4/5 with the KLEI tops
        # correlated KLEI↔KLEI (ZAND bases likewise). PartitionFillOverlay renders
        # it as the ``partition-region-*`` the body-action specs right-click.
        f_body = form("KLEI body (action seed)", "KLEI", 30, "#c2a0d8")
        f_base = form("ZAND base cap (action seed)", "ZAND", 31, "#f5c842")
        await s.flush()
        bk3 = contact(f_body, cpt3, 2.0)
        bk4 = contact(f_body, cpt4, 2.0)
        bk5 = contact(f_body, cpt5, 2.0)
        bz3 = contact(f_base, cpt3, 5.0)
        bz4 = contact(f_base, cpt4, 5.0)
        bz5 = contact(f_base, cpt5, 5.0)
        # The borehole repeats CPT-5's column at the east end of the transect.
        # Correlating it to CPT-5 (NOT to a distant column) keeps the edges
        # between adjacent columns, which is what the resolver and the section
        # renderer both expect.
        bbk = contact(f_body, bh0, 2.0, kind="borehole")
        bbz = contact(f_base, bh0, 5.0, kind="borehole")
        await s.flush()
        edge(bk3, bk4, section_id=sec_b)
        edge(bk4, bk5, section_id=sec_b)
        edge(bk5, bbk, section_id=sec_b)
        edge(bz3, bz4, section_id=sec_b)
        edge(bz4, bz5, section_id=sec_b)
        edge(bz5, bbz, section_id=sec_b)
        body_contact_ids = [bk3.id, bk4.id, bk5.id, bz3.id, bz4.id, bz5.id, bbk.id, bbz.id]

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

        # --- Per-instance scenario (Section D) — partition model -------------
        # Two KLEI units (shallow + deep) on CPT-8/9/10, each correlated SAME-
        # lithology ACROSS the three columns. The resolver makes one body per
        # connected component: the shallow KLEI tops form one (QC1), the deep KLEI
        # tops a separate one (QC2) — no edge links shallow↔deep, so the resolver
        # keeps them distinct. CPT-8's KLEI contacts are SHALLOWER than the
        # neighbours' (2 m / 7 m vs 3 m / 8 m) so each body's source_investigation_id
        # resolves to CPT-8 — and there are NO ZAND separators, which would spawn
        # extra source-CPT-8 singleton bodies. The deep body is framed from its OWN
        # member layer — it must NOT jump up to the shallow occurrence (Bug C).
        pi_klei_top = form("KLEI inst top (per-instance)", "KLEI", 50, "#c2a0d8")
        pi_klei_deep = form("KLEI inst deep (per-instance)", "KLEI", 52, "#c2a0d8")
        await s.flush()
        # CPT-8 (source) carries the two KLEI levels shallower than the neighbours;
        # CPT-9 / CPT-10 carry the matching levels one metre deeper.
        d_klei_shallow = contact(pi_klei_top, cpt8, 2.0)
        d_klei_deep = contact(pi_klei_deep, cpt8, 7.0)
        d_left_shallow = contact(pi_klei_top, cpt9, 3.0)
        d_left_deep = contact(pi_klei_deep, cpt9, 8.0)
        d_right_shallow = contact(pi_klei_top, cpt10, 3.0)
        d_right_deep = contact(pi_klei_deep, cpt10, 8.0)
        await s.flush()
        # Same-litho correlation of each KLEI level across the three columns.
        edge(d_klei_shallow, d_left_shallow, section_id=sec_d)
        edge(d_klei_shallow, d_right_shallow, section_id=sec_d)
        edge(d_klei_deep, d_left_deep, section_id=sec_d)
        edge(d_klei_deep, d_right_deep, section_id=sec_d)
        per_instance_contact_ids = [
            d_klei_shallow.id,
            d_klei_deep.id,
            d_left_shallow.id,
            d_left_deep.id,
            d_right_shallow.id,
            d_right_deep.id,
        ]
        await s.flush()

        # --- Facies competition scenario (Section E) --------------------------
        # Topology that exercises ``assemble_facies_competitors`` in
        # ``build_body_solids``:  a shared KLEI (clay) body spans all three CPTs
        # (11/12/13) and has TWO distinct competitors directly above it:
        #
        # (only the ``depth_top_m`` contacts below are stored; each unit's base
        # is the next contact's top — or the CPT depth for the deepest unit — and
        # is NOT stored):
        #
        #   CPT-11: ZAND top@1 m  |  KLEI top@4 m
        #   CPT-12: ZAND top@1 m  |  KLEI top@4 m
        #   CPT-13: VEEN top@1 m  |  KLEI top@4 m
        #
        # Edges:
        #   ZAND  CPT-11 ↔ ZAND  CPT-12  (same litho → one ZAND body)
        #   KLEI  CPT-11 ↔ KLEI  CPT-12  \
        #   KLEI  CPT-12 ↔ KLEI  CPT-13  / → one KLEI body spanning all 3 CPTs
        #   VEEN  CPT-13  (no VEEN neighbour — single-column VEEN body)
        #
        # Result: KLEI body has {ZAND, VEEN} as distinct upper neighbours
        # → ``len(ups) >= 2`` → facies-competitor path fires.
        f_facies_klei = form("KLEI facies (facies seed)", "KLEI", 60, "#c2a0d8")
        f_facies_zand = form("ZAND facies (facies seed)", "ZAND", 61, "#f5c842")
        f_facies_veen = form("VEEN facies (facies seed)", "VEEN", 62, "#6b4a2a")
        await s.flush()
        ek11 = contact(f_facies_klei, cpt11, 4.0)
        ek12 = contact(f_facies_klei, cpt12, 4.0)
        ek13 = contact(f_facies_klei, cpt13, 4.0)
        ez11 = contact(f_facies_zand, cpt11, 1.0)
        ez12 = contact(f_facies_zand, cpt12, 1.0)
        ev13 = contact(f_facies_veen, cpt13, 1.0)
        await s.flush()
        # ZAND–ZAND correlation (same litho, CPT-11 ↔ CPT-12)
        edge(ez11, ez12, section_id=sec_e)
        # KLEI–KLEI correlations spanning all three CPTs
        edge(ek11, ek12, section_id=sec_e)
        edge(ek12, ek13, section_id=sec_e)
        # VEEN has no same-litho neighbour — single-CPT body, still above KLEI
        facies_contact_ids = [
            ek11.id,
            ek12.id,
            ek13.id,
            ez11.id,
            ez12.id,
            ev13.id,
        ]
        await s.flush()

        # --- Same-class Join scenario (Section F) — two disjoint KLEI bodies ----
        # The Join spec (flow_join_body_ui) needs TWO geometrically DISJOINT bodies
        # of the SAME NAD class on one section (two same-colour regions of
        # DIFFERENT bodies). Two KLEI levels (shallow + deep) correlated SAME-litho
        # across CPTs 14/15/16, with NO shallow<->deep edge, and — the load-bearing
        # difference from the per-instance topology (Section D) — a ZAND separator
        # band WEDGED BETWEEN them so the two KLEI bands are geometrically
        # NON-ADJACENT.
        #
        # WHY the separator is mandatory, not cosmetic: litho is gap-free (the
        # FC->LL contiguity trigger derives each layer's base as the NEXT contact's
        # top), so WITHOUT a band between them the shallow KLEI's base would land
        # exactly on the deep KLEI's top — the two bands would TOUCH. The geotech
        # body resolver unions same-litho + same-packing bands that are
        # geometrically adjacent (``BodyGeometryFactOrm`` written by RecomputeBodies;
        # owner 2026-08-19: "if a lens is touching a body with same litho and packing
        # ... it becomes one body"). Touching KLEI-22 over KLEI-22 therefore MERGE
        # into a single body on the debounced recompute — leaving nothing to join
        # (the failure this fixture was red on: one body, no same-class pair). The
        # ZAND band (different soil -> the one-lithology guard drops any union) keeps
        # them two distinct bodies that the engineer's "these ARE the same body" can
        # legally join.
        #
        # These CPTs carry a UNIFORM CLAY qc series (_make_uniform_clay_series), so
        # both KLEI bands classify to KLEI class 22 (qc 1.5 in NAD_QC_BANDS band
        # [1.0, 2.0)) — same class, same fill colour, a legal Join — while the ZAND
        # separator classifies to ZAND class 5 (qc 1.5 in the ZAND [2.0, 4.0) band),
        # a different class + colour that both separates and reads as a distinct
        # region. CPT-14 (source) carries the levels shallower than the neighbours
        # so each body's source_investigation_id resolves to CPT-14.
        jf_klei_shallow = form("KLEI join shallow (same-class)", "KLEI", 70, "#c2a0d8")
        jf_zand_sep = form("ZAND join separator (same-class)", "ZAND", 71, "#f5c842")
        jf_klei_deep = form("KLEI join deep (same-class)", "KLEI", 72, "#c2a0d8")
        await s.flush()
        # shallow KLEI [2,4] / ZAND [4,7] / deep KLEI [7,10] on CPT-14; the
        # neighbours run one metre deeper (shallow [3,5] / ZAND [5,8] / deep
        # [8,10]) so CPT-14 stays the shallowest source column.
        f_shallow_c = contact(jf_klei_shallow, cpt14, 2.0)
        f_sep_c = contact(jf_zand_sep, cpt14, 4.0)
        f_deep_c = contact(jf_klei_deep, cpt14, 7.0)
        f_shallow_l = contact(jf_klei_shallow, cpt15, 3.0)
        f_sep_l = contact(jf_zand_sep, cpt15, 5.0)
        f_deep_l = contact(jf_klei_deep, cpt15, 8.0)
        f_shallow_r = contact(jf_klei_shallow, cpt16, 3.0)
        f_sep_r = contact(jf_zand_sep, cpt16, 5.0)
        f_deep_r = contact(jf_klei_deep, cpt16, 8.0)
        await s.flush()
        # Same-litho correlation of each level across the three columns; NO edge
        # links the shallow level to the deep one, and the ZAND band between them
        # keeps the two KLEI bands from ever touching, so they stay two bodies.
        edge(f_shallow_c, f_shallow_l, section_id=sec_f)
        edge(f_shallow_c, f_shallow_r, section_id=sec_f)
        edge(f_sep_c, f_sep_l, section_id=sec_f)
        edge(f_sep_c, f_sep_r, section_id=sec_f)
        edge(f_deep_c, f_deep_l, section_id=sec_f)
        edge(f_deep_c, f_deep_r, section_id=sec_f)
        same_class_contact_ids = [
            f_shallow_c.id,
            f_sep_c.id,
            f_deep_c.id,
            f_shallow_l.id,
            f_sep_l.id,
            f_deep_l.id,
            f_shallow_r.id,
            f_sep_r.id,
            f_deep_r.id,
        ]
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
        sd = (
            await s.execute(select(CrossSectionOrm).where(CrossSectionOrm.id == sec_d))
        ).scalar_one()
        sd.seeded_formation_contact_ids = list(
            set(sd.seeded_formation_contact_ids or []) | set(per_instance_contact_ids)
        )
        se = (
            await s.execute(select(CrossSectionOrm).where(CrossSectionOrm.id == sec_e))
        ).scalar_one()
        se.seeded_formation_contact_ids = list(
            set(se.seeded_formation_contact_ids or []) | set(facies_contact_ids)
        )
        sf = (
            await s.execute(select(CrossSectionOrm).where(CrossSectionOrm.id == sec_f))
        ).scalar_one()
        sf.seeded_formation_contact_ids = list(
            set(sf.seeded_formation_contact_ids or []) | set(same_class_contact_ids)
        )
        await s.commit()

        # Resolve instance ordinals + connected-component bodies. The partition
        # fill renders body shape from membership — there is no separate detector.
        # The crossing (Section C) has no edges → no body forms there.
        await ResolveLithoInstances(s).execute(model_id=mid)
        await s.commit()
        print(
            "[fixture] action scenarios seeded — resolver bodies on Section B "
            "(KLEI across CPT-3/4/5 + BH-E2E-01) + Section D (per-instance QC1/QC2) + "
            "Section E (KLEI with ZAND+VEEN facies competitors) + Section F "
            "(two disjoint same-class KLEI bodies for Join); crossing on Section C",
            file=sys.stderr,
        )


def _seed_geotech_model(api_base: str, project_id: str) -> None:
    """Seed the geotechnical model through the REAL pipeline verbs (never hand-rows).

    Mirrors the engineer's own flow, exactly as the toolbar fires it:

    1. ``POST .../models/{litho}/geotech/subdivide-all-bodies`` — pipeline
       steps 1+2 in one press: find-or-creates the geotech model
       (``kind='geotechnical'``, parent = the litho model), writes accepted
       NAD packing bands (``litho_layer`` rows carrying ``body_id`` after the
       resolver runs inside the verb) for every qc-bearing column, and
       derives packing ties from the litho model's approved edges
       (restatements of the fixture's manual litho ties are born accepted
       per ruling A; genuinely new pairs arrive pending).
    2. ``POST .../models/{geotech}/contact-correlations/accept`` — pipeline
       step 3, model-wide: promotes every pending proposal and re-runs the
       resolver, so the seeded state carries ONLY accepted ties.

    The function then VERIFIES the invariant the Cesium fence specs stand on
    — at least one approved geotech correlation edge and at least one
    accepted band — and exits loudly when the pipeline produced neither
    (a silent half-seed would surface later as an unexplained
    ``unit-fence-empty`` in ``flow_unit_statistics``).

    Determinism: the verbs are pure functions of the seeded litho state +
    the deterministic qc series, so the CONTENT (classes, depths, tie
    topology) is byte-stable across seeds; only the uuid7 row ids differ.

    Parameters
    ----------
    api_base : str
        Base URL of the FastAPI backend (no trailing slash).
    project_id : str
        UUID of the fixture project (hex-string).

    Raises
    ------
    SystemExit
        On any non-200 verb response or when the verification fails.
    """
    litho_model_id = _uid("litho-model")
    geology_base = f"{api_base}/projects/{project_id}/geology"

    # Own client: the subdivision classifies every column in one pass, which
    # can outlast the 30 s the restore client uses.
    with httpx.Client(timeout=120.0) as client:
        resp = client.post(
            f"{geology_base}/models/{litho_model_id}/geotech/subdivide-all-bodies",
            json={"litho_model_id": litho_model_id},
        )
        if resp.status_code != 200:
            print(
                f"ERROR: subdivide-all-bodies returned HTTP {resp.status_code}.\n"
                f"Body: {resp.text[:500]}",
                file=sys.stderr,
            )
            sys.exit(4)
        outcome = resp.json()
        geotech_model_id = outcome["geotech_model_id"]
        print(
            f"[fixture] geotech subdivide ok — model {geotech_model_id}: "
            f"{outcome['layer_count']} bands, {outcome['body_count']} bodies, "
            f"{outcome['proposed_tie_count']} ties proposed",
            file=sys.stderr,
        )

        resp = client.post(
            f"{geology_base}/models/{geotech_model_id}/contact-correlations/accept",
            json={},
        )
        if resp.status_code != 200:
            print(
                f"ERROR: geotech accept returned HTTP {resp.status_code}.\nBody: {resp.text[:500]}",
                file=sys.stderr,
            )
            sys.exit(4)
        accepted = resp.json()

        # Verify the fence precondition instead of assuming it: the cutout and
        # the fence diagram draw ONLY approved edges over accepted bands.
        edges = client.get(f"{geology_base}/models/{geotech_model_id}/contact-correlations").json()
        approved_count = sum(1 for e in edges if e.get("user_approved"))
        layers = client.get(f"{geology_base}/models/{geotech_model_id}/layers").json()
        accepted_bands = sum(1 for layer in layers if layer.get("status") == "accepted")
        if approved_count == 0 or accepted_bands == 0:
            print(
                "ERROR: geotech seeding left no fence-capable state "
                f"(approved edges={approved_count}, accepted bands={accepted_bands}). "
                "The Cesium visual specs need >=1 of each — inspect the "
                "subdivide/accept responses above.",
                file=sys.stderr,
            )
            sys.exit(5)
        print(
            f"[fixture] geotech model seeded — {accepted_bands} accepted bands, "
            f"{approved_count} approved edges "
            f"(accept verb promoted {accepted['edges_accepted']})",
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

    # Seed the geotechnical model through the real pipeline verbs (E1) — after
    # the action scenarios so the resolver bodies + approved litho edges the
    # subdivider reads already exist.
    print(f"[fixture] Seeding geotech model for project {project_id} …", file=sys.stderr)
    _seed_geotech_model(api_base, project_id)

    # Last line on stdout: bare project UUID for shell capture
    print(project_id)


if __name__ == "__main__":
    main()
