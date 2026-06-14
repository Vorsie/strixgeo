"""Stage 6 of the implicit stratigraphic field builder: carve enclosed lenses.

This runs AFTER Stage-5 body assembly
(:func:`~groundmodel.domain.services.strat_field.body_assembly.assemble_bodies`):
it takes the assembled matrix body meshes as input and carves each enclosed lens
into its host.

Stage 1 (``stratigraphic_order``) orders only the conformable MATRIX backbone; an
enclosed minority (the KLEI / SILT / KLEI over-merge signature on ``test.strix``)
is classified as a :class:`~groundmodel.domain.services.strat_field.lens_types.Lens`
and excluded from the single global iso-order, because a single scalar field has one
iso-order and a true enclosed lens has no place in it.  This module puts the lens
BACK: it carves each lens into its matrix host so the lens sits VERTICALLY ENCLOSED
inside the host (KLEI above the lens, then the lens, then KLEI below it, at a column
through the lens), with host + lens TILING — no overlap, no gap — and every emitted
mesh a closed manifold.

Mechanism — the two-prism cavity (WHY)
--------------------------------------
The naive "remove the lens cells from the host's present mask" opens a FULL-THICKNESS
vertical shaft through the whole host band at the lens footprint: the host would then
be ABSENT above and below the lens there, which is NOT "KLEI / SILT / KLEI" and fails
the column-diff invariant.  Instead, over the lens footprint we split the host into
TWO height-field prisms straddling the lens, reusing the existing watertight prism
emitter (:func:`~groundmodel.domain.services.strat_field.body_assembly.emit_prism_bodies`):

For a lens with top surface ``z_lt(x, y)`` and base surface ``z_lb(x, y)`` over its
footprint, enclosed in a host spanning ``host_top(x, y) .. host_base(x, y)``:

* **host-upper-plus-outer** — ONE prism: top = ``host_top`` everywhere; base =
  ``z_lt`` at lens-footprint nodes, ``host_base`` elsewhere.  This is "host above the
  lens" continuously merged with "host everywhere outside the lens footprint" — a
  single connected, single-valued height-field prism.  Keeps the host ``body_id`` +
  lithology.
* **host-lower** — a SECOND prism over the lens footprint only: top = ``z_lb``,
  base = ``host_base``.  ("host below the lens.")  SAME host ``body_id`` + lithology.
* **lens** — a prism over the lens footprint only: top = ``z_lt``, base = ``z_lb``.
  ``body_id = f"lens:{host_body_id}:{lens_body_id[-6:]}"``, lens lithology.

Why this is correct: a vertical ray at a lens column hits, across all meshes, the
intervals ``(z_lt, host_top)`` [host], ``(z_lb, z_lt)`` [lens], ``(host_base, z_lb)``
[host] → top→bottom HOST / LENS / HOST.  The two host pieces share a ``body_id``,
which the overlap invariant explicitly permits (intervals from the SAME body may
stack), and the column-diff keeps them as two non-adjacent HOST entries with LENS
between → it matches the authored KLEI/SILT/KLEI.  Each prism is built by the
watertight cell-complex emitter, so each is a closed manifold and adjacent prisms
share node heights exactly (no overlap, no gap).

Recursion (lens-in-lens, ``nesting_depth`` ≥ 2)
-----------------------------------------------
Lenses are processed in ASCENDING ``nesting_depth`` (shallowest first) — a depth-1
SILT must be carved into the matrix before the depth-2 ZAND can carve the SILT prism,
so the dependency is parent-before-child.  A lens-in-lens then carves its cavity out
of its (already-emitted) enclosing LENS prism, not the matrix.  A depth-2 lens (ZAND
in SILT) splits the SILT lens prism into SILT-upper / SILT-lower around the ZAND,
exactly as the host split above.  The enclosing lens prism is found by its
emitted ``body_id`` (the ``lens:{host}:{tail}`` scheme), so the wiring (Task 5) must
set a depth-2 lens's ``host_body_id`` to its parent lens's EMITTED id.

This module is purely functional compute — no I/O, no logging, no framework
dependencies.  It depends only on NumPy and the body-assembly prism emitter.

What it does NOT do
-------------------
* It does not FIT a sub-field for the lens — the matrix field has no iso for an
  enclosed lens.  The lens vertical extent (``z_top`` / ``z_base`` height arrays +
  footprint over the shared grid) is an INPUT: a :class:`LensCarveInput` per lens.
  Task 5 (the wiring) populates those surfaces from the lens's real picks; this
  module is a pure geometry assembler that takes them as given.
* It does not handle a lens that TOUCHES the host's vertical or lateral boundary
  (a non-strictly-interior lens).  A clean enclosure requires the lens to be
  strictly interior (``z_lb`` > ``host_base`` and ``z_lt`` < ``host_top`` at every
  lens node, and the lens footprint surrounded by host cells).  A boundary-touching
  lens is the messy interfingering case and is out of scope here.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from groundmodel.domain.services.strat_field.body_assembly import emit_prism_bodies
from groundmodel.domain.value_objects.litho_body_mesh import LithoBodyMesh

# Strict-interior margin (metres) the carve keeps between a lens surface and the
# host boundary it would otherwise touch / cross.  The lens surfaces come from the
# lens's OWN picks resampled over the shared grid (Task 5a), so near the footprint
# edge the RBF can extrapolate a lens top ABOVE the host top or a base BELOW the
# host base — which would build an inverted / zero-thickness host slab (the
# upper-plus-outer base above its own top) and break the watertight tiling.  The
# carve clamps each lens surface to ``host_top - margin`` / ``host_base + margin``
# and DROPS any cover node whose clamped thickness falls below the margin, so the
# lens stays strictly interior and both host pieces stay non-degenerate.  10 cm is
# well below contact resolution yet comfortably above the emitter's 1 mm
# minimum-band threshold, so a clamped-but-kept node always emits a real slab.
_LENS_INTERIOR_MARGIN_M: float = 0.10


@dataclass(frozen=True)
class LensCarveInput:
    """One enclosed lens's geometry, ready to carve into its host prism.

    A pure value object (no I/O, no logging).  The lens vertical extent is given
    as two single-valued height fields over the SHARED build grid plus a node
    footprint mask, because the matrix potential field carries no iso for an
    enclosed lens — the surfaces come from the lens's own picks (populated by the
    wiring stage), not from the field.

    ``frozen=True`` only prevents rebinding the attributes; it does NOT make the
    ``np.ndarray`` fields (``z_top`` / ``z_base`` / ``footprint``) deeply immutable
    — their contents are mutable and the instance is therefore not hashable.  Treat
    it as a frozen *handle* to array data, not a hashable value key, matching the
    :class:`~groundmodel.domain.services.strat_field.strat_types.ContactSurface`
    convention for value objects that carry large array/mesh geometry.

    Parameters
    ----------
    host_body_id : str
        The ``body_id`` of the prism this lens is carved OUT of.  For a depth-1
        lens this is the matrix host body's id; for a depth-2 lens (lens-in-lens)
        it is the ENCLOSING lens prism's EMITTED id
        (``f"lens:{matrix_host}:{tail}"``).
    host_formation_id : str
        The host prism's lithology (stamped on both carved host pieces).
    lens_body_id : str
        The lens body's own resolver ``instance_key``.  Only its last six
        characters feed the emitted lens id; carried whole for traceability.
    lens_formation_id : str
        The lens lithology (drives the lens prism's colour).
    z_top : numpy.ndarray
        ``(nx, ny)`` top-surface elevation of the lens over the shared grid.
        Only the values at ``footprint`` nodes are used.
    z_base : numpy.ndarray
        ``(nx, ny)`` base-surface elevation of the lens over the shared grid.
        Must be strictly below ``z_top`` (and strictly inside the host) at every
        footprint node for a clean enclosure.
    footprint : numpy.ndarray
        ``(nx, ny)`` bool node mask: the lens is present where True.  A grid CELL
        is treated as lens-covered only when all four of its corner nodes are in
        the footprint (matching the all-corners-inside cell rule of the emitter).
    nesting_depth : int
        ``1`` for a lens directly inside a matrix body, ``2`` for a lens inside a
        lens, and so on.  Drives the carve order: lenses are carved in ASCENDING
        nesting_depth (shallowest first), so a parent lens prism exists before its
        child carves it.  Always ``>= 1``.
    """

    host_body_id: str
    host_formation_id: str
    lens_body_id: str
    lens_formation_id: str
    z_top: np.ndarray
    z_base: np.ndarray
    footprint: np.ndarray
    nesting_depth: int

    @property
    def emitted_body_id(self) -> str:
        """str: The deterministic ``body_id`` stamped on this lens's emitted prism."""
        return f"lens:{self.host_body_id}:{self.lens_body_id[-6:]}"


@dataclass
class _Prism:
    """A mutable single-valued height-field prism in the carve working set.

    Internal representation: the carver works on height fields (``top`` / ``bottom``
    arrays + a node ``footprint``) so a host split is pure array math; meshes are
    emitted once at the end via the shared prism emitter.  A host may be carved
    multiple times (a host with several lenses, or a lens carved by an inner lens),
    so this is the single object whose ``top`` / ``bottom`` / ``footprint`` get
    rewritten in place across carves.

    Parameters
    ----------
    body_id : str
        The prism's emitted body id (host pieces keep the host id; a lens prism
        uses the ``lens:{host}:{tail}`` id).
    formation_id : str
        The prism's lithology.
    top, bottom : numpy.ndarray
        ``(nx, ny)`` per-node top / base elevations; ``NaN`` where absent.
    footprint : numpy.ndarray
        ``(nx, ny)`` bool node mask of where this prism exists.
    """

    body_id: str
    formation_id: str
    top: np.ndarray
    bottom: np.ndarray
    footprint: np.ndarray


def carve_lenses(
    lenses: Sequence[LensCarveInput],
    matrix_meshes: list[LithoBodyMesh],
    gx: np.ndarray,
    gy: np.ndarray,
    node_inside: np.ndarray,
) -> list[LithoBodyMesh]:
    """Carve each enclosed lens into its host prism, returning watertight meshes.

    Reconstructs each matrix mesh's single-valued top / base height fields from its
    geometry (one prism per ``body_id``), carves the lenses shallowest-nesting-first
    (a lens-in-lens carves its enclosing lens prism, not the matrix, so the parent
    must be carved before the child), then emits
    every resulting prism — carved host pieces + lens prisms — with the shared
    watertight emitter over the SAME grid the matrix meshes were built on.

    The returned list contains: the un-touched matrix meshes (those no lens
    carved), the carved host pieces (host-upper-plus-outer + host-lower per
    carved host, each keeping the host ``body_id`` so they may legally stack),
    and one lens prism per lens.

    Parameters
    ----------
    lenses : Sequence[LensCarveInput]
        The enclosed lenses to carve, each with its top/base surfaces + footprint
        over the shared grid.  Order does not matter — the carver sorts by
        ascending ``nesting_depth`` (then by ``emitted_body_id``) for a
        deterministic shallowest-first carve (parent lens before child lens).
    matrix_meshes : list[LithoBodyMesh]
        The assembled matrix body meshes (the Stage-5 output, from
        :func:`~groundmodel.domain.services.strat_field.body_assembly.assemble_bodies`).
        Each is a single-valued prism over the shared grid; its top/base fields
        are reconstructed by vertical ray-cast at every grid node.
    gx, gy : numpy.ndarray
        The shared grid node coordinates — MUST be the same grid the matrix meshes
        were assembled on (rebuild via
        :func:`~groundmodel.domain.services.strat_field.body_assembly.build_shared_grid`
        with the identical domain + spacing) so the lens prisms weld to the host.
    node_inside : numpy.ndarray
        ``(nx, ny)`` inside-polygon mask for the shared grid.

    Returns
    -------
    list[LithoBodyMesh]
        Watertight meshes: untouched matrix bodies + carved host pieces + lens
        prisms, in a deterministic order (untouched matrix bodies in input order,
        then per-carved-host the upper-plus-outer piece, the lower piece, and the
        lens prism, in shallowest-first carve order).

    Raises
    ------
    ValueError
        When a lens names a ``host_body_id`` that is not present in the working
        set (an un-carvable lens — the host mesh was never emitted, or a depth-2
        lens's parent lens id is wrong).
    """
    nx, ny = len(gx), len(gy)

    # ------------------------------------------------------------------
    # Step 1: reconstruct each matrix mesh as a height-field prism.
    #
    # A matrix mesh is a single-valued prism, so a vertical ray at each grid node
    # hits it in exactly one (base, top) interval (or none, outside the body
    # footprint).  Recovering top/base/footprint as arrays lets the carve be pure
    # array math regardless of whether the host is a matrix band or a prior lens.
    # ------------------------------------------------------------------
    prisms: list[_Prism] = []
    prism_by_body_id: dict[str, _Prism] = {}
    for mesh in matrix_meshes:
        top, bottom, footprint = _prism_height_fields(mesh, gx, gy)
        prism = _Prism(
            body_id=mesh.body_id,
            formation_id=mesh.formation_id,
            top=top,
            bottom=bottom,
            footprint=footprint,
        )
        prisms.append(prism)
        # A matrix split would yield duplicate body_ids (``id#0``/``id#1``); the
        # mesh ids already carry that suffix, so each mesh maps to a distinct key.
        prism_by_body_id[mesh.body_id] = prism

    # ------------------------------------------------------------------
    # Step 2: carve each lens, SHALLOWEST nesting first.
    #
    # A lens-in-lens carves its cavity out of its enclosing LENS prism, so that
    # parent lens prism must already be in the working set when the child carves
    # it.  The parent is the SHALLOWER lens (a depth-1 SILT must be carved into the
    # matrix before the depth-2 ZAND can carve the SILT), so we process ascending
    # nesting depth.  (The plan's "deepest first" framing assumed a carve directly
    # on the innermost region; with a prism-by-body-id working set the dependency
    # runs parent-before-child, i.e. shallowest first.)  Within a nesting level the
    # order is by emitted id for determinism.
    # ------------------------------------------------------------------
    ordered = sorted(lenses, key=lambda lc: (lc.nesting_depth, lc.emitted_body_id))
    for lens in ordered:
        host = prism_by_body_id.get(lens.host_body_id)
        if host is None:
            raise ValueError(
                f"lens {lens.emitted_body_id!r} names host body "
                f"{lens.host_body_id!r}, which is not in the carve working set "
                f"(present: {sorted(prism_by_body_id)!r})"
            )
        lens_prism, host_lower = _carve_one(lens, host, nx, ny)
        # host-lower keeps the host body_id; it does NOT replace the host in the
        # lookup (the host object — now the upper-plus-outer piece — must stay the
        # carve target for any further lens on the same host).  The lens prism IS
        # added to the lookup so a deeper lens can carve it.
        prisms.append(host_lower)
        prisms.append(lens_prism)
        prism_by_body_id[lens_prism.body_id] = lens_prism

    # ------------------------------------------------------------------
    # Step 3: emit every prism with the shared watertight emitter.
    # ------------------------------------------------------------------
    out: list[LithoBodyMesh] = []
    for prism in prisms:
        out.extend(
            emit_prism_bodies(
                top=prism.top,
                bottom=prism.bottom,
                formation_id=prism.formation_id,
                body_id=prism.body_id,
                gx=gx,
                gy=gy,
                node_inside=node_inside,
            )
        )
    return out


def merge_meshes_by_body_id(meshes: Sequence[LithoBodyMesh]) -> list[LithoBodyMesh]:
    """Concatenate every mesh sharing a ``body_id`` into ONE :class:`LithoBodyMesh`.

    The carve emits TWO host pieces (host-upper-plus-outer + host-lower) under the
    SAME ``body_id`` so the column reads HOST / LENS / HOST.  Persistence keys ONE
    row per ``body_id`` (``litho_body_solid`` has ``UNIQUE(model_id, body_id)``), so
    two meshes with one id would UPSERT to the same row and the second silently
    overwrites the first — a lost host piece.  This merges them into a single mesh
    of two disjoint closed components: vertices are concatenated and the second
    mesh's triangle indices are offset by the first's vertex count.

    A merged mesh of disjoint closed components is still valid for every downstream
    consumer: ``assert_closed_manifold`` checks edge multiplicity (each component is
    closed independently, so every edge still has multiplicity 2), and the
    ray-cast / ``vertical_ray_intervals`` returns one interval per component.

    Parameters
    ----------
    meshes : Sequence of LithoBodyMesh
        The meshes to merge (e.g. ``carve_lenses`` output).  Order within a
        ``body_id`` group is preserved (the carve order: upper-plus-outer, lower).

    Returns
    -------
    list of LithoBodyMesh
        One mesh per distinct ``body_id``, in ascending ``body_id`` order
        (deterministic).  A single-mesh group passes through unchanged (same
        geometry, ``is_flagged`` preserved).  ``formation_id`` is taken from the
        first mesh in the group; ``is_flagged`` is the OR over the group (a flagged
        piece keeps the merged body flagged), though carved bodies are never
        flagged.

    Raises
    ------
    ValueError
        When two meshes sharing a ``body_id`` disagree on ``formation_id`` (a
        carve bug — host pieces must keep the host lithology).
    """
    grouped: dict[str, list[LithoBodyMesh]] = {}
    for mesh in meshes:
        grouped.setdefault(mesh.body_id, []).append(mesh)

    out: list[LithoBodyMesh] = []
    for body_id in sorted(grouped):
        group = grouped[body_id]
        if len(group) == 1:
            out.append(group[0])
            continue

        formation_id = group[0].formation_id
        vertices: list[tuple[float, float, float]] = []
        triangles: list[tuple[int, int, int]] = []
        is_flagged = False
        for mesh in group:
            if mesh.formation_id != formation_id:
                raise ValueError(
                    f"meshes sharing body_id {body_id!r} disagree on formation_id "
                    f"({formation_id!r} vs {mesh.formation_id!r}) — a carve bug"
                )
            offset = len(vertices)
            vertices.extend(mesh.vertices)
            triangles.extend((a + offset, b + offset, c + offset) for a, b, c in mesh.triangles)
            is_flagged = is_flagged or mesh.is_flagged
        out.append(
            LithoBodyMesh(
                body_id=body_id,
                formation_id=formation_id,
                vertices=vertices,
                triangles=triangles,
                is_flagged=is_flagged,
            )
        )
    return out


def _carve_one(lens: LensCarveInput, host: _Prism, nx: int, ny: int) -> tuple[_Prism, _Prism]:
    """Carve one lens out of ``host`` in place; return the lens + host-lower prisms.

    Rewrites ``host`` into the host-upper-plus-outer piece by pulling its base UP
    to the lens top (``z_lt``) at the lens footprint (its base stays the host base
    elsewhere, and its top is unchanged).  Builds the host-lower piece (a second
    prism with the SAME ``body_id``, over the lens footprint, top = ``z_lb``, base
    = the host's original base) and the lens prism (top = ``z_lt``, base =
    ``z_lb``).

    The two host pieces share ``body_id``, which the overlap invariant permits
    (intervals from the same body may stack), so the column at the lens reads
    HOST (above) / LENS / HOST (below) — vertical enclosure.

    Parameters
    ----------
    lens : LensCarveInput
        The lens being carved (supplies ``z_top`` / ``z_base`` / ``footprint``).
    host : _Prism
        The host prism, MUTATED in place into the host-upper-plus-outer piece.
        It stays the carve target for any further lens on the same host.
    nx, ny : int
        Grid node dimensions (for the lens / host-lower arrays).

    Returns
    -------
    (_Prism, _Prism)
        ``(lens_prism, host_lower)`` — the lens prism and the host-lower piece.
        The caller appends both to the working set (and registers the lens prism
        in the body-id lookup so a deeper lens can carve it).
    """
    # Lens-covered nodes within the host's own footprint.  A lens node outside the
    # host footprint is ignored (a strictly-interior lens never does this, but the
    # mask guards against a slightly-overhanging input).
    cover = lens.footprint & host.footprint
    host_base_at_carve = host.bottom.copy()  # snapshot before the host mutates

    # --- strict-interior clamp -------------------------------------------------
    # The lens surfaces are resampled from the lens's OWN picks (Task 5a), NOT
    # clamped to the host, so near the footprint edge the RBF can push z_top above
    # the host top or z_base below the host base — which would build an inverted /
    # zero-thickness host slab and break the watertight tiling.  Clamp each lens
    # surface to stay ``margin`` inside the host, then DROP any cover node whose
    # clamped lens thickness collapses below ``margin`` (an edge node where the lens
    # genuinely pinches out — keeping it would emit a degenerate slab).  The clamp
    # reads the host's CURRENT top + its base snapshot (the same surfaces the carve
    # reconstructs), so it composes with a multi-lens / lens-in-lens host correctly.
    margin = _LENS_INTERIOR_MARGIN_M
    z_top = lens.z_top.copy()
    z_base = lens.z_base.copy()
    z_top[cover] = np.minimum(z_top[cover], host.top[cover] - margin)
    z_base[cover] = np.maximum(z_base[cover], host_base_at_carve[cover] + margin)
    # Drop cover nodes whose clamped slab is too thin to enclose (lens pinch-out at
    # the footprint edge).  A dropped node is host-only there → the host band stays
    # continuous, the lens simply does not reach that node.
    cover = cover & (z_top - z_base > margin)

    # --- host-upper-plus-outer: raise the host base to z_lt over the lens -------
    # Base = z_lt at lens nodes, host_base elsewhere.  Top unchanged.  This single
    # array stays a connected single-valued prism: outside the lens it is the full
    # host band; over the lens it is just the slab above the lens top.
    new_host_base = host.bottom.copy()
    new_host_base[cover] = z_top[cover]
    host.bottom = new_host_base
    # host.footprint is unchanged — the piece still spans the whole host extent;
    # only its base dropped to the lens top over the cavity.

    # --- host-lower: a second prism (same body_id) under the lens --------------
    # Top = z_lb, base = the host's ORIGINAL base, over the lens footprint only.
    # NaN elsewhere so the emitter omits every non-lens node.
    lower_top = np.full((nx, ny), np.nan)
    lower_base = np.full((nx, ny), np.nan)
    lower_top[cover] = z_base[cover]
    lower_base[cover] = host_base_at_carve[cover]
    host_lower = _Prism(
        body_id=host.body_id,
        formation_id=host.formation_id,
        top=lower_top,
        bottom=lower_base,
        footprint=cover.copy(),
    )

    # --- lens prism ------------------------------------------------------------
    lens_top = np.full((nx, ny), np.nan)
    lens_base = np.full((nx, ny), np.nan)
    lens_top[cover] = z_top[cover]
    lens_base[cover] = z_base[cover]
    lens_prism = _Prism(
        body_id=lens.emitted_body_id,
        formation_id=lens.lens_formation_id,
        top=lens_top,
        bottom=lens_base,
        footprint=cover.copy(),
    )
    return lens_prism, host_lower


def _prism_height_fields(
    mesh: LithoBodyMesh,
    gx: np.ndarray,
    gy: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Reconstruct a single-valued prism's top/base/footprint from its mesh.

    Vertical-ray-casts the mesh at every grid node; a single-valued prism yields
    at most one solid ``(base, top)`` interval per node.  Where the ray hits, the
    node's top / base / footprint are recorded; elsewhere they are ``NaN`` /
    ``False``.  When a ray finds more than one interval (a multi-component matrix
    body sampled where two components overlap in xy — not expected for a
    single-valued band, but guarded), the OUTERMOST envelope (min base, max top)
    is taken so the reconstructed prism still brackets the body there.

    Parameters
    ----------
    mesh : LithoBodyMesh
        The matrix body mesh (a single-valued prism over the grid).
    gx, gy : numpy.ndarray
        The shared grid node coordinates.

    Returns
    -------
    (numpy.ndarray, numpy.ndarray, numpy.ndarray)
        ``top``, ``bottom`` (``(nx, ny)`` floats, ``NaN`` off-footprint) and
        ``footprint`` (``(nx, ny)`` bool).
    """
    nx, ny = len(gx), len(gy)
    top = np.full((nx, ny), np.nan)
    bottom = np.full((nx, ny), np.nan)
    footprint = np.zeros((nx, ny), dtype=bool)

    # O(nx * ny * triangles) per mesh — acceptable for on-click Build at the grid
    # sizes benchmarked in CLAUDE.local.md; profile if Build exceeds ~30 s on real
    # data.  Task 5 may thread the height arrays directly from assemble_bodies instead.
    for i in range(nx):
        for j in range(ny):
            intervals = _ray_intervals(mesh.vertices, mesh.triangles, float(gx[i]), float(gy[j]))
            if not intervals:
                continue
            # Outer envelope over any intervals found (single-valued → exactly one).
            base = min(b for b, _ in intervals)
            t = max(t for _, t in intervals)
            top[i, j] = t
            bottom[i, j] = base
            footprint[i, j] = True
    return top, bottom, footprint


def _ray_intervals(
    vertices: Sequence[tuple[float, float, float]],
    triangles: Sequence[tuple[int, int, int]],
    x: float,
    y: float,
) -> list[tuple[float, float]]:
    """Return the solid ``(base, top)`` intervals of a mesh along the +z line at ``(x, y)``.

    A self-contained even-odd vertical ray cast (the same primitive the test
    invariants use): collect the interpolated z of every triangle whose 2-D
    footprint contains ``(x, y)``, deduplicate near-coincident crossings (a shared
    horizontal edge is hit by both its triangles), sort, and pair odd-even into
    solid intervals.  Kept private to this module rather than importing the
    test-only invariant helper, so the production carve does not depend on a test
    module.

    Parameters
    ----------
    vertices : Sequence[tuple[float, float, float]]
        Mesh vertices ``(x, y, z)``.
    triangles : Sequence[tuple[int, int, int]]
        Triangle index triples.
    x, y : float
        Map-plane query coordinates.

    Returns
    -------
    list[tuple[float, float]]
        ``(base, top)`` intervals (base below top); empty when the ray misses the
        mesh footprint.
    """
    tol = 1e-6
    zs: list[float] = []
    for a, b, c in triangles:
        ax, ay, az = vertices[a]
        bx, by, bz = vertices[b]
        cx, cy, cz = vertices[c]
        denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(denom) < 1e-15:
            continue  # vertical / zero-area triangle contributes no crossing
        la = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denom
        lb = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denom
        lc = 1.0 - la - lb
        eps = 1e-12
        if la < -eps or lb < -eps or lc < -eps:
            continue
        zs.append(la * az + lb * bz + lc * cz)

    if not zs:
        return []

    zs.sort()
    deduped: list[float] = [zs[0]]
    for z in zs[1:]:
        if abs(z - deduped[-1]) > tol:
            deduped.append(z)

    intervals: list[tuple[float, float]] = []
    for k in range(0, len(deduped) - 1, 2):
        base, t = deduped[k], deduped[k + 1]
        if t - base > tol:
            intervals.append((base, t))
    return intervals
