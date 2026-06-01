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
type (``FormationDisplay`` vs ``SectionFormation``) but share the two
attributes these helpers care about: ``.name: str`` and
``.display_order: int``.  We use ``typing.Protocol`` to express the
structural constraint without coupling to either concrete type.
"""

from __future__ import annotations

from typing import Protocol


class _HasNameAndOrder(Protocol):
    """Structural protocol for objects with a name and a display order.

    Both ``FormationDisplay`` (``GroundModelSnapshot``) and
    ``SectionFormation`` (``SectionSnapshot``) satisfy this interface.
    Only the two attributes consumed by the shared helpers need to be
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


# Type alias used in helper signatures.
Formation = _HasNameAndOrder


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


def emit_materials(formations: list[Formation]) -> list[str]:
    """Return one Mohr-Coulomb soilmat block per formation.

    The block is identical for Plaxis 2D and 3D — both create
    ``g_i.soilmat()`` placeholders with only the Identification name
    set (Phase 5 fills in parameters).

    Parameters
    ----------
    formations : list[Formation]
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
    for f in formations:
        var = material_variable_name(f.name)
        lines.append(f"{var} = g_i.soilmat()")
        lines.append(f"{var}.Identification = {py_str(f.name)}")
        # SoilModel = 1 → Mohr-Coulomb in every PLAXIS release we
        # care about (2018+). The numeric enum has been stable.
        lines.append(f"{var}.SoilModel = 1")
        lines.append(f"materials[{py_str(f.name)}] = {var}")
    lines.append("")
    return lines


def emit_global_layers(formations: list[Formation]) -> list[str]:
    """Return the global soil-layer stack — top-down, one per formation.

    Layer index ``i`` in the emitted code corresponds to
    ``formations[i]`` and is used by ``setsoillayerlevel`` per borehole.
    ``formations`` must already be sorted top-down (youngest-first,
    i.e. descending ``display_order``) by the caller.

    Parameters
    ----------
    formations : list[Formation]
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
    for i, f in enumerate(formations):
        mat_var = material_variable_name(f.name)
        # soillayer(0) creates an empty global layer; the new layer
        # appears at the end of g_i.Soillayers. We assign material
        # via the last index regardless of the implementation
        # detail (some Plaxis releases insert-at-zero, others
        # append; either way the bottom of g_i.Soillayers is the
        # newest-added).
        lines.append(f"g_i.soillayer(0)  # layer {i}: {f.name}")
        lines.append(f"g_i.Soillayers[{i}].Soil.Material = {mat_var}")
    lines.append("")
    return lines


def material_variable_name(name: str) -> str:
    """Turn a formation name into a safe lowercase Python identifier.

    Plaxis material identifiers accept spaces and Dutch accents, but the
    emitted Python variable cannot. Maps non-alphanumeric chars to ``_``,
    collapses runs of underscores, and prefixes ``mat_`` so the result is
    unambiguous and readable in the script.

    Parameters
    ----------
    name : str
        Formation display name (e.g. ``"Boom Klei"``).

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
