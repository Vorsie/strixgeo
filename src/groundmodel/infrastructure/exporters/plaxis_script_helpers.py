"""Shared helpers for the Plaxis 2D and 3D script emitters (debt #110 / #169).

Both ``PlaxisExporter`` (3D) and ``PlaxisSectionExporter`` (2D) emit the
same ``plxscripting`` Python scripts and share four byte-identical building
blocks.  Extracting them here removes the duplication so a Plaxis-API change
(e.g. a renamed property) is fixed in one place, not two.

The helpers are pure functions — no I/O, no logging, no class state — so
they live at module level rather than in a mixin class.

Formation protocol
------------------
Both exporter families receive a list of formation objects that differ in
type (``FormationDisplay`` vs ``SectionFormation``) but share the
attributes these helpers care about: ``.name``, ``.display_order``, and
the three-level unit identifiers ``.nad_class`` /
``.litho_main_soil_code`` / ``.formation_id`` (debt #104).  We use
``typing.Protocol`` to express the structural constraint without
coupling to either concrete type.
"""

from __future__ import annotations

import re
from collections.abc import Hashable, Mapping, Sequence
from typing import Protocol, TypeVar
from uuid import UUID

from groundmodel.infrastructure.exporters.unit_identifier import (
    UnitMappingRow,
    naming_identifier,
)
from groundmodel.infrastructure.exporters.unit_identifier_constants import (
    DUPLICATE_MATERIAL_SUFFIX,
    UNIT_ID_NAME_SEPARATOR,
)

KeyT = TypeVar("KeyT", bound=Hashable)

# Any run of three or more double-quotes can act as a ``"""`` docstring
# delimiter. Matched maximally (``{3,}``) so a longer run is neutralised in
# one pass rather than leaving a residual triple.
_TRIPLE_QUOTE_RUN = re.compile('"{3,}')


def _space_out_quote_run(match: re.Match[str]) -> str:
    """Break a run of double-quotes so no three stay adjacent.

    A run of three double-quotes becomes the same three quotes with a single
    space between each. Every quote is kept (the text stays faithful) but no
    three are contiguous, so the run can never read as a docstring delimiter,
    in a comment OR a docstring.
    """
    return " ".join(match.group(0))


def sanitize_script_text(text: str) -> str:
    """Neutralise user text before it is spliced into a comment or docstring.

    The Plaxis emitters instruct the engineer to run the emitted module
    (``python <this_file>.py``), so any user-controlled string that lands in
    a ``#`` comment or the module docstring is a code-injection surface.
    VALUES are already safe — they go through :func:`py_str` (``repr``) —
    but comment and docstring splices are raw. This is the ONE helper every
    such splice routes through; two attacker moves are closed:

    * **Line breaks** end a ``#`` comment and add lines to the docstring, so
      the injected code would land on its own physical line as executable
      Python. Every Unicode line boundary (``str.splitlines`` recognises the
      full set — ``\\r \\n \\x0b \\x0c \\x1c-\\x1e \\x85 \\u2028 \\u2029``,
      a superset of what the tokenizer treats as a break) is collapsed to a
      single space.
    * **Triple-quote runs** close the docstring, so any run of three or more
      double-quotes is broken with spaces (see :func:`_space_out_quote_run`).
      Done AFTER the line-break collapse, so three quotes split across lines
      cannot re-form into a delimiter once the newlines are gone.

    Text carrying neither is returned unchanged, so an ordinary formation /
    project / section / unit name emits byte-identical output to before this
    guard existed (exports are a contract).

    Parameters
    ----------
    text : str
        Raw user-controlled text (a formation name, project name, section
        name, investigation name, or a pre-rendered docstring line).

    Returns
    -------
    str
        The text with line breaks collapsed to spaces and triple-quote runs
        broken — safe to splice into a comment or docstring.
    """
    collapsed = " ".join(text.splitlines())
    return _TRIPLE_QUOTE_RUN.sub(_space_out_quote_run, collapsed)


class _HasNameAndOrder(Protocol):
    """Structural protocol for a formation as the shared emitters see it.

    Both ``FormationDisplay`` (``GroundModelSnapshot``) and
    ``SectionFormation`` (``SectionSnapshot``) satisfy this interface.
    Only the attributes consumed by the shared helpers need to be
    present; any extra attributes on the concrete types are ignored.
    """

    @property
    def name(self) -> str:
        """Formation display label."""
        ...

    @property
    def display_order(self) -> int:
        """Stratigraphic-age axis — lower is older."""
        ...

    @property
    def nad_class(self) -> int | None:
        """Belgian NAD packing class on a geotechnical unit, else ``None``."""
        ...

    @property
    def litho_main_soil_code(self) -> str | None:
        """BaseLithology token on a litho / geotech unit, else ``None``."""
        ...

    @property
    def formation_id(self) -> UUID | None:
        """Source ``geological_formation`` row id, when the snapshot carries it."""
        ...


# Type alias used in helper signatures.
Formation = _HasNameAndOrder


def emit_header(
    title: str,
    subject_lines: list[str],
    usage_lines: list[str],
    notes_lines: list[str],
    mapping_table_lines: list[str] | None = None,
) -> list[str]:
    """Return the provenance docstring header for an emitted script.

    Both exporters open the script with the same skeleton — a triple-
    quoted docstring holding a title, a subject/provenance block, a
    USAGE section, an optional UNIT MAPPING TABLE, and a NOTES section.
    The variable content (field lines, product name, per-exporter
    caveats) is supplied by the caller; only the section order +
    fencing lives here.

    Parameters
    ----------
    title : str
        First docstring line, e.g.
        ``"Plaxis 3D geometry import — generated by Strix."``.
    subject_lines : list[str]
        Provenance fields (project / section / CRS / counts /
        timestamp).
    usage_lines : list[str]
        Numbered how-to-run steps.
    notes_lines : list[str]
        Bullet caveats (placeholders, ordering, dropped columns, ...).
    mapping_table_lines : list[str] | None
        Pre-rendered unit mapping table (debt #104) — material -> NAD
        class -> soil -> unit name -> formation id. Placed after USAGE
        so the engineer meets it right after importing. ``None`` or
        empty emits nothing, which is what a geological-model export
        does: it has no identifiers to map, and the emitted script is
        then byte-identical to the pre-#104 output.

    Returns
    -------
    list[str]
        Lines ready to splice into the emitted script.
    """
    # Every line the caller supplies is user-reachable (project / section
    # name in the subject block, formation display name in the mapping
    # table) and lands inside the ``"""`` docstring, so each is routed
    # through the ONE sanitiser. The static chrome ("USAGE", "-----",
    # "NOTES") and the fences are ours, not user text, so they are not.
    header = [f'"""{sanitize_script_text(title)}', ""]
    header.extend(sanitize_script_text(line) for line in subject_lines)
    header.extend(["", "USAGE", "-----"])
    header.extend(sanitize_script_text(line) for line in usage_lines)
    if mapping_table_lines:
        header.append("")
        header.extend(sanitize_script_text(line) for line in mapping_table_lines)
    header.extend(["", "NOTES", "-----"])
    header.extend(sanitize_script_text(line) for line in notes_lines)
    header.extend(['"""', ""])
    return header


def emit_borehole_layer_levels(
    bh_var: str,
    keys_top_down: Sequence[KeyT],
    depth_top_by_key: Mapping[KeyT, float],
    surface_z: float,
    bottom_z: float,
) -> list[str]:
    """Return the per-layer ``setsoillayerlevel`` block for one borehole.

    Implements the shared inherit cascade: walk the global formation
    order top-down and compute each formation's top level at this
    borehole —

    * present at this column → ``surface_z - depth_top``;
    * absent → inherit the top level of the next-deeper PRESENT
      formation (zero-thickness layer; Plaxis handles natively);
    * absent with no deeper present formation → collapse to
      ``bottom_z`` (the column bottom).

    The cascade is filled by a bottom-up scan; the emit loop then tags
    absent formations with a ``# absent — zero thickness`` comment.
    Previously duplicated between the 2D and 3D exporters (keyed by
    formation name vs formation UUID — hence the generic key type).

    N layers, N+1 boundaries
    ------------------------
    A PLAXIS borehole with ``N`` soil layers has ``N + 1`` level
    boundaries: index ``0`` is the top of layer 0, index ``i`` is the
    base of layer ``i-1`` / top of layer ``i``, and index ``N`` is the
    base of the deepest layer — the bottom of the model.  Emitting only
    indices ``0..N-1`` left that last boundary at whatever PLAXIS
    defaults it to, so the deepest unit (usually the founding layer)
    did not run to the depth the investigation actually reached (audit
    2026-08-02).  The final line is clamped with ``min(...)`` so a
    column whose ``bottom_z`` was derived from a shallower recorded
    total depth than its deepest contact collapses to a zero-thickness
    deepest layer instead of an inverted one.

    Parameters
    ----------
    bh_var : str
        Script-side borehole variable name (e.g. ``"bh_0"``).
    keys_top_down : Sequence
        Formation keys in top-down (youngest-first) order.
    depth_top_by_key : Mapping
        ``key -> depth_top_m`` for formations present at this column.
    surface_z : float
        Absolute surface level of the column.
    bottom_z : float
        Absolute column bottom — the collapse target for trailing
        absent formations.

    Returns
    -------
    list[str]
        One ``g_i.setsoillayerlevel(...)`` line per formation, plus a
        final line for the base of the deepest layer. Empty when
        ``keys_top_down`` is empty (a borehole with no layers has no
        boundaries at all).
    """
    if not keys_top_down:
        return []

    top_levels: list[float] = [bottom_z] * len(keys_top_down)
    running_next = bottom_z
    for idx in range(len(keys_top_down) - 1, -1, -1):
        key = keys_top_down[idx]
        if key in depth_top_by_key:
            z = surface_z - depth_top_by_key[key]
            top_levels[idx] = z
            running_next = z
        else:
            top_levels[idx] = running_next

    lines: list[str] = []
    for idx, key in enumerate(keys_top_down):
        tag = "" if key in depth_top_by_key else "  # absent — zero thickness"
        lines.append(f"g_i.setsoillayerlevel({bh_var}, {idx}, {top_levels[idx]!r}){tag}")

    # Boundary N — the base of the deepest layer. ``min`` guards the case
    # where bottom_z (recorded total depth) is shallower than the deepest
    # contact's top: the deepest layer then collapses to zero thickness
    # rather than inverting.
    base_z = min(bottom_z, top_levels[-1])
    lines.append(
        f"g_i.setsoillayerlevel({bh_var}, {len(keys_top_down)}, {base_z!r})  # column bottom"
    )
    return lines


def emit_imports_and_connect() -> list[str]:
    """Return the plxscripting import + remote-server connection block.

    The block is identical for Plaxis 2D and 3D — both use the same
    ``plxscripting.easy.new_server`` call with HOST/PORT/PASSWORD
    placeholders the engineer fills in before running the script.

    Returns
    -------
    list[str]
        Lines ready to splice into the emitted script.
    """
    return [
        "from plxscripting.easy import new_server",
        "",
        'HOST = "localhost"',
        "PORT = 10000",
        'PASSWORD = ""  # set this to the password configured in PLAXIS',
        "",
        "s_i, g_i = new_server(HOST, PORT, password=PASSWORD)",
        "g_i.new()",
        "",
    ]


def emit_materials(formations: Sequence[Formation]) -> list[str]:
    """Return one Mohr-Coulomb soilmat block per formation.

    The block is identical for Plaxis 2D and 3D — both create
    ``g_i.soilmat()`` placeholders with only the Identification name
    set (Phase 5 fills in parameters).

    A unit carrying a NAD packing class is identified as
    ``"NAD-06_ZAND - <unit name>"`` so the engineer can map the Plaxis
    material onto a material definition without leaving the material
    list (debt #104); every other level keeps the bare display name.
    Names come from ``material_names`` so two units sharing a class and
    a soil never collapse onto one Python variable or one PLAXIS
    identification.

    Parameters
    ----------
    formations : Sequence[Formation]
        Formations in the order the caller wants them emitted.
        Sorting is the caller's responsibility; this helper emits
        them verbatim.

    Returns
    -------
    list[str]
        Lines ready to splice into the emitted script.
    """
    lines = [
        "# ---- Soil materials (Mohr-Coulomb placeholders) ----",
        "materials = {}",
    ]
    for var, identification in material_names(formations):
        lines.append(f"{var} = g_i.soilmat()")
        lines.append(f"{var}.Identification = {py_str(identification)}")
        # SoilModel = 1 → Mohr-Coulomb in every PLAXIS release we
        # care about (2018+). The numeric enum has been stable.
        lines.append(f"{var}.SoilModel = 1")
        lines.append(f"materials[{py_str(identification)}] = {var}")
    lines.append("")
    return lines


def emit_global_layers(formations: Sequence[Formation]) -> list[str]:
    """Return the global soil-layer stack — top-down, one per formation.

    Layer index ``i`` in the emitted code corresponds to
    ``formations[i]`` and is used by ``setsoillayerlevel`` per borehole.
    ``formations`` must already be sorted top-down (youngest-first,
    i.e. descending ``display_order``) by the caller.

    Parameters
    ----------
    formations : Sequence[Formation]
        Formations already sorted youngest-first (highest
        ``display_order`` first).

    Returns
    -------
    list[str]
        Lines ready to splice into the emitted script.
    """
    lines = [
        "# ---- Global soil layer stack (top-down: youngest first) ----",
        "# Layer index i below corresponds to formations[i] in the",
        "# stratigraphic order Strix exported. Plaxis layer 0 is the",
        "# topmost (youngest) formation in the soil column.",
    ]
    variables = [variable for variable, _ in material_names(formations)]
    for i, (f, mat_var) in enumerate(zip(formations, variables, strict=True)):
        # soillayer(0) creates an empty global layer; the new layer
        # appears at the end of g_i.Soillayers. We assign material
        # via the last index regardless of the implementation
        # detail (some Plaxis releases insert-at-zero, others
        # append; either way the bottom of g_i.Soillayers is the
        # newest-added).
        # ``f.name`` is user text spliced into a ``#`` comment — a newline
        # in it would end the comment and drop the rest onto its own line as
        # code. Route it through the shared sanitiser.
        lines.append(f"g_i.soillayer(0)  # layer {i}: {sanitize_script_text(f.name)}")
        lines.append(f"g_i.Soillayers[{i}].Soil.Material = {mat_var}")
    lines.append("")
    return lines


def material_identification(formation: Formation) -> str:
    """Return the PLAXIS ``Identification`` string for one unit.

    A unit that carries a NAD packing class leads with its machine
    identifier so the material list in PLAXIS is directly mappable:
    ``"NAD-06_ZAND - Zand van Diest (NAD 6)"``. Every other level —
    geological formations, litho units, unclassified geotech skeleton
    bands — keeps the bare display name, byte-identical to the pre-#104
    output; their identifiers travel through the mapping table instead.

    Parameters
    ----------
    formation : Formation
        The unit being emitted.

    Returns
    -------
    str
        The identification string to assign in the emitted script.
    """
    identifier = naming_identifier(
        nad_class=formation.nad_class,
        litho_main_soil_code=formation.litho_main_soil_code,
    )
    if identifier is None:
        return formation.name
    return f"{identifier}{UNIT_ID_NAME_SEPARATOR}{formation.name}"


def material_names(formations: Sequence[Formation]) -> list[tuple[str, str]]:
    """Return one collision-free ``(variable, identification)`` pair per unit.

    Two units legitimately share a ``(nad_class, soil)`` pair — NAD 6
    sand under two different geological parents is a normal model — and
    two formations can share a display name (the seed-from-stratigraphy
    flow leaves duplicates for the engineer to resolve). Either case
    derived the SAME variable name for two materials, so the second
    ``g_i.soilmat()`` silently overwrote the first and one unit vanished
    from the imported model — and left PLAXIS showing two materials
    under one identification, which is unmappable by hand.

    Repeats therefore get an ordinal on BOTH halves of the pair, in
    emission order, which is deterministic because the callers sort
    their formation list before emitting. The first occurrence keeps the
    bare names, so a model with no duplicates emits byte-identical
    output to before debt #104.

    The DXF exporter disambiguates its layer names with the formation's
    short id instead. The two schemes differ on purpose: a DXF layer
    name must stay under 255 characters and is compared case-folded, an
    ordinal alone would not survive that, whereas a PLAXIS identification
    has neither constraint and reads better with a plain ``#2``. The
    mapping table carries the formation UUID in both artefacts, so the
    ambiguity is always resolvable whichever one reached the engineer.

    Parameters
    ----------
    formations : Sequence[Formation]
        Formations in the order the caller will emit them.

    Returns
    -------
    list[tuple[str, str]]
        ``(python_variable, plaxis_identification)``, positionally
        aligned with ``formations``.
    """
    pairs: list[tuple[str, str]] = []
    used: dict[str, int] = {}
    for f in formations:
        # Derive from the IDENTIFIER when the unit is classified so the
        # variable reads ``mat_nad_06_zand`` rather than repeating the
        # display name; unclassified units keep their pre-#104 variable.
        token = (
            naming_identifier(
                nad_class=f.nad_class,
                litho_main_soil_code=f.litho_main_soil_code,
            )
            or f.name
        )
        variable = material_variable_name(token)
        identification = material_identification(f)
        seen = used.get(variable, 0)
        used[variable] = seen + 1
        if seen:
            ordinal = seen + 1
            variable = f"{variable}_{ordinal}"
            identification = f"{identification}{DUPLICATE_MATERIAL_SUFFIX}{ordinal}"
        pairs.append((variable, identification))
    return pairs


def plaxis_mapping_rows(formations: Sequence[Formation]) -> list[UnitMappingRow]:
    """Build the unit mapping-table rows for an emitted Plaxis script.

    Only units that actually carry an identifier are listed, so a
    geological-model export yields an empty list and emits no table.
    The ``export_label`` quotes the ``Identification`` the script
    ACTUALLY assigns — disambiguating ordinal included — so a row matches
    the PLAXIS material list verbatim.

    Parameters
    ----------
    formations : Sequence[Formation]
        Formations in the order the script emits them (top-down), so
        the table reads in the same order as the material list.

    Returns
    -------
    list[UnitMappingRow]
        One row per identifier-carrying unit.
    """
    identifications = [identification for _, identification in material_names(formations)]
    return [
        UnitMappingRow(
            export_label=identification,
            nad_class=f.nad_class,
            soil_code=f.litho_main_soil_code,
            display_name=f.name,
            formation_id=f.formation_id,
        )
        for f, identification in zip(formations, identifications, strict=True)
        if f.nad_class is not None or f.litho_main_soil_code
    ]


def material_variable_name(name: str) -> str:
    """Turn a material identification into a safe lowercase Python identifier.

    Plaxis material identifiers accept spaces and Dutch accents, but the
    emitted Python variable cannot. Maps non-alphanumeric chars to ``_``,
    collapses runs of underscores, and prefixes ``mat_`` so the result is
    unambiguous and readable in the script.

    Uniqueness is NOT this function's job — two inputs can sanitise to
    the same identifier. Callers go through ``material_names``, which
    resolves repeats.

    Parameters
    ----------
    name : str
        Material identification (e.g. ``"Boom Klei"`` or
        ``"NAD-06_ZAND - Zand van Diest (NAD 6)"``).

    Returns
    -------
    str
        Safe Python identifier (e.g. ``"mat_boom_klei"``).
    """
    safe = "".join(ch if ch.isalnum() else "_" for ch in name)
    # Collapse runs of underscores so "Boom  Klei" → "Boom_Klei",
    # not "Boom__Klei".
    while "__" in safe:
        safe = safe.replace("__", "_")
    safe = safe.strip("_") or "unnamed"
    return f"mat_{safe}".lower()


def py_str(s: str) -> str:
    """Format a Python string literal that survives a round-trip.

    Uses ``repr`` so Unicode (Boom Klei, Diest Zand) survives without
    hand-rolled escaping that would mis-handle non-ASCII characters.

    Parameters
    ----------
    s : str
        The string to represent as a Python literal.

    Returns
    -------
    str
        A Python ``repr``-formatted string literal (e.g. ``"'Boom Klei'"``).
    """
    return repr(s)
