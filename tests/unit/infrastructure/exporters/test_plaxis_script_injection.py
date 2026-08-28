"""Security pins: a hostile unit / project / section name must not become
code in an emitted Plaxis script.

The Plaxis exporters emit a runnable ``plxscripting`` Python script whose
header instructs the engineer to ``python <this_file>.py``. Every value
the script assigns is ``repr``-escaped (safe), but user-controlled names
were spliced RAW into two script positions that are not data:

* a ``#`` comment — ``# layer 0: <formation name>`` (the global-layer
  stack) and ``# <investigation name> @ along=...`` (the 2D borehole
  line). A NEWLINE in the name ends the comment and drops whatever
  follows onto its own line as executable Python.
* the module ``\"\"\"`` docstring — the title, the provenance subject
  block (project / section name) and the unit mapping table (formation
  display name). A ``\"\"\"`` in the name closes the docstring and turns
  the lines beneath it into code.

A crafted ``.strix`` carries such a name (the restore path applies no
per-character validation), the victim runs a Plaxis export, and the
emitted script executes the attacker's Python as the victim.

These tests phrase the contract in the vulnerability's own terms: the
emitted script must stay valid Python AND must never carry the attacker's
``import os`` as an executable statement, for a name containing either a
newline or a triple-quote, at every splice site.
"""

from __future__ import annotations

import ast
from uuid import UUID, uuid4

from groundmodel.application.ground_model_snapshot import (
    FormationDisplay,
    GroundModelSnapshot,
    LayerGeometry,
)
from groundmodel.application.section_snapshot import (
    SectionFormation,
    SectionFormationContact,
    SectionInvestigationProjection,
    SectionSnapshot,
)
from groundmodel.infrastructure.exporters.plaxis_exporter import PlaxisExporter
from groundmodel.infrastructure.exporters.plaxis_section_exporter import (
    PlaxisSectionExporter,
)

PROJECT_ID = UUID("00000000-0000-0000-0000-000000000001")
SECTION_ID = UUID("00000000-0000-0000-0000-000000000002")

# The two hostile shapes named in the vulnerability. ``NEWLINE`` ends a
# ``#`` comment; ``TRIPLE_QUOTE`` closes the ``\"\"\"`` docstring.
NEWLINE_PAYLOAD = "A\nimport os"
TRIPLE_QUOTE_PAYLOAD = 'A"""'
# A single crafted name that BOTH closes the docstring and executes code,
# then reopens a docstring to swallow the provenance lines that follow —
# the clean arbitrary-code-execution demonstration.
DOCSTRING_ACE_PAYLOAD = 'A"""\nimport os\n"""'


# ---------------------------------------------------------------------------
# The contract, phrased once
# ---------------------------------------------------------------------------


def _assert_no_injected_code(script: str) -> None:
    """The attacker text must stay inert docstring / comment content.

    Two failure shapes prove the escape:

    * the script no longer parses — a name closing the ``\"\"\"``
      docstring turns the provenance lines below it into code, raising a
      ``SyntaxError``;
    * the script parses but carries ``import os`` as a real module-level
      statement — a name whose newline ended a ``#`` comment dropped it
      onto its own line.

    A clean script's only import is ``from plxscripting.easy import
    new_server`` (an ``ImportFrom``), so any ``Import`` of ``os`` is
    attacker-planted.
    """
    try:
        module = ast.parse(script)
    except SyntaxError as exc:  # pragma: no cover - message is the evidence
        raise AssertionError(
            "attacker text escaped its docstring/comment and broke the "
            f"emitted script into invalid Python (SyntaxError: {exc}):\n{script}"
        ) from exc
    imported = {
        alias.name
        for node in ast.walk(module)
        if isinstance(node, ast.Import)
        for alias in node.names
    }
    assert "os" not in imported, (
        f"attacker's `import os` reached an executable position in the emitted script:\n{script}"
    )


# ---------------------------------------------------------------------------
# Snapshot builders (identifier-carrying so the mapping table is emitted)
# ---------------------------------------------------------------------------


def _snapshot_3d(formation_name: str, *, project_name: str = "Proj") -> GroundModelSnapshot:
    return GroundModelSnapshot(
        project_id=PROJECT_ID,
        project_name=project_name,
        crs_epsg=31370,
        layers=[
            LayerGeometry(
                formation_name=formation_name,
                formation_code=None,
                top_depth_m=0.0,
                base_depth_m=5.0,
                location_x=0.0,
                location_y=0.0,
                surface_elevation_m=5.0,
            )
        ],
        formations=[
            FormationDisplay(
                name=formation_name,
                code=None,
                display_order=0,
                color="#ccc",
                # Classified so the unit reaches the docstring mapping table.
                nad_class=6,
                litho_main_soil_code="ZAND",
                formation_id=uuid4(),
            )
        ],
    )


def _snapshot_2d(
    *,
    formation_name: str = "Boom",
    investigation_name: str = "CPT-1",
    project_name: str = "Proj",
    section_name: str = "Section A",
) -> SectionSnapshot:
    fid = uuid4()
    iid = uuid4()
    return SectionSnapshot(
        project_id=PROJECT_ID,
        project_name=project_name,
        section_id=SECTION_ID,
        section_name=section_name,
        section_length_m=100.0,
        crs_epsg=31370,
        vertical_datum_label="m TAW",
        investigations=[
            SectionInvestigationProjection(
                investigation_id=iid,
                kind="cpt",
                name=investigation_name,
                along_distance_m=0.0,
                surface_elevation_m=5.0,
                total_depth_m=20.0,
            )
        ],
        formations=[
            SectionFormation(
                formation_id=fid,
                name=formation_name,
                code=None,
                color="#ccc",
                display_order=0,
                nad_class=6,
                litho_main_soil_code="ZAND",
            )
        ],
        contacts=[
            SectionFormationContact(
                contact_id=uuid4(),
                formation_id=fid,
                investigation_id=iid,
                along_distance_m=0.0,
                depth_m=2.0,
                level_m=3.0,
            )
        ],
    )


def _decode(payload: bytes) -> str:
    return payload.decode("utf-8")


# ---------------------------------------------------------------------------
# 3D exporter — formation name, project name
# ---------------------------------------------------------------------------


def test_3d_formation_name_newline_does_not_break_out_of_comment() -> None:
    """A formation named with a newline lands in ``# layer 0: <name>`` — the
    newline must not push ``import os`` onto its own line as code."""
    script = _decode(PlaxisExporter().export(_snapshot_3d(NEWLINE_PAYLOAD)))
    _assert_no_injected_code(script)


def test_3d_formation_name_triple_quote_does_not_close_docstring() -> None:
    """A classified formation's name reaches the docstring mapping table; a
    ``\"\"\"`` in it must not close the provenance docstring."""
    script = _decode(PlaxisExporter().export(_snapshot_3d(TRIPLE_QUOTE_PAYLOAD)))
    _assert_no_injected_code(script)


def test_3d_project_name_newline_stays_inert() -> None:
    """A project name only reaches the docstring; a bare newline there is
    inert (guard), but the sanitiser collapses it anyway."""
    script = _decode(PlaxisExporter().export(_snapshot_3d("Boom", project_name=NEWLINE_PAYLOAD)))
    _assert_no_injected_code(script)


def test_3d_project_name_triple_quote_does_not_close_docstring() -> None:
    """A project name carrying ``\"\"\"`` closes the provenance docstring and
    turns the fields below it into code."""
    script = _decode(
        PlaxisExporter().export(_snapshot_3d("Boom", project_name=TRIPLE_QUOTE_PAYLOAD))
    )
    _assert_no_injected_code(script)


def test_3d_project_name_docstring_ace_is_neutralised() -> None:
    """The clean ACE: a project name that closes the docstring, runs
    ``import os``, then reopens a docstring to swallow the rest."""
    script = _decode(
        PlaxisExporter().export(_snapshot_3d("Boom", project_name=DOCSTRING_ACE_PAYLOAD))
    )
    _assert_no_injected_code(script)


# ---------------------------------------------------------------------------
# 2D section exporter — formation, investigation, project, section names
# ---------------------------------------------------------------------------


def test_2d_investigation_name_newline_does_not_break_out_of_comment() -> None:
    """The 2D borehole line comments its investigation name — a newline must
    not drop ``import os`` onto its own line as code."""
    script = _decode(
        PlaxisSectionExporter().export(_snapshot_2d(investigation_name=NEWLINE_PAYLOAD))
    )
    _assert_no_injected_code(script)


def test_2d_formation_name_triple_quote_does_not_close_docstring() -> None:
    """A classified formation's display name reaches the 2D docstring mapping
    table; a ``\"\"\"`` must not close it."""
    script = _decode(
        PlaxisSectionExporter().export(_snapshot_2d(formation_name=TRIPLE_QUOTE_PAYLOAD))
    )
    _assert_no_injected_code(script)


def test_2d_project_name_triple_quote_does_not_close_docstring() -> None:
    """A project name carrying ``\"\"\"`` closes the 2D provenance docstring."""
    script = _decode(
        PlaxisSectionExporter().export(_snapshot_2d(project_name=TRIPLE_QUOTE_PAYLOAD))
    )
    _assert_no_injected_code(script)


def test_2d_section_name_triple_quote_does_not_close_docstring() -> None:
    """A section name carrying ``\"\"\"`` closes the 2D provenance docstring."""
    script = _decode(
        PlaxisSectionExporter().export(_snapshot_2d(section_name=TRIPLE_QUOTE_PAYLOAD))
    )
    _assert_no_injected_code(script)


def test_2d_section_name_docstring_ace_is_neutralised() -> None:
    """The clean ACE via a section name (close docstring, run code, reopen)."""
    script = _decode(
        PlaxisSectionExporter().export(_snapshot_2d(section_name=DOCSTRING_ACE_PAYLOAD))
    )
    _assert_no_injected_code(script)


# ---------------------------------------------------------------------------
# Contract guard: ordinary names emit byte-identical output (no over-sanitise)
# ---------------------------------------------------------------------------


def test_ordinary_names_are_untouched_3d() -> None:
    """A name with no control character and no quote run must pass through
    unchanged — the emitted script keeps the exact strings the pre-fix code
    produced (export is a contract)."""
    script = _decode(PlaxisExporter().export(_snapshot_3d("Boom Klei")))
    # The comment, the material identification and the mapping table all read
    # the name verbatim.
    assert "# layer 0: Boom Klei" in script
    assert "'NAD-06_ZAND - Boom Klei'" in script
    assert "NAD-06_ZAND - Boom Klei" in script


def test_ordinary_names_are_untouched_2d() -> None:
    """The 2D borehole comment keeps an ordinary investigation name verbatim."""
    script = _decode(PlaxisSectionExporter().export(_snapshot_2d(investigation_name="CPT-17")))
    assert "# CPT-17 @ along=0.000 m" in script
