"""Behavioural tests for the ``preview`` HTML writer.

The preview module is a pure I/O helper (write a self-contained Three.js
HTML file for local browser inspection).  These tests pin the output
contract without caring about the exact HTML structure.
"""

from __future__ import annotations

from groundmodel.domain.services.strat_field.preview import write_scene_html


def test_write_scene_html_emits_standalone_file(tmp_path):
    """write_scene_html produces a valid HTML file with embedded geometry."""
    out = tmp_path / "scene.html"
    write_scene_html(
        out,
        meshes=[
            {
                "name": "SAND",
                "color": "#fbbf24",
                "vertices": [(0, 0, 0), (1, 0, 0), (0, 1, 0)],
                "triangles": [(0, 1, 2)],
            }
        ],
        points=[{"x": 0.0, "y": 0.0, "z": 0.0, "color": "#000"}],
    )
    html = out.read_text()
    assert "<canvas" in html or "three" in html.lower()
    assert "0.5" not in html  # sanity: real coords embedded, not a placeholder
    # positive check: the fixture's data is actually embedded, not dropped
    assert "fbbf24" in html  # the mesh colour reached the output
    assert "SAND" in html  # the mesh name reached the output
    assert out.stat().st_size > 500
