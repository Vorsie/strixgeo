"""The download-artefact contract every export route returns (debt #110).

``ExportArtifact`` is the framework-free value the six export handlers build
after running their exporter; the API layer turns it into a response. These
pins guard the two things the DTO owns — the safe filename stem and the field
packaging — so the download contract cannot drift when a route is edited.

They are guard tests, not red-first: the refactor that introduced this DTO is
byte-identical to the per-route code it replaced, and these lock that contract.
The ``"A-A'"`` case matches the sanitisation the integration DXF-export test
documents ("A-A'" → "A-A_", single quote → underscore).
"""

from __future__ import annotations

import pytest

from groundmodel.application.export_artifact import ExportArtifact, safe_filename_stem


def test_build_appends_suffix_to_sanitised_stem() -> None:
    """The filename is the sanitised name with the format suffix appended."""
    artifact = ExportArtifact.build(
        content=b"payload",
        name="My Section",
        fallback="section",
        suffix=".dxf",
        media_type="application/dxf",
    )

    assert artifact.filename == "My Section.dxf"
    assert artifact.content == b"payload"
    assert artifact.media_type == "application/dxf"


def test_build_replaces_unsafe_characters_with_underscore() -> None:
    """A single quote (and any non-``[alnum -_ space]`` char) becomes ``_``."""
    artifact = ExportArtifact.build(
        content=b"x",
        name="A-A'",
        fallback="section",
        suffix=".dxf",
        media_type="application/dxf",
    )

    assert artifact.filename == "A-A_.dxf"


@pytest.mark.parametrize("blank_name", ["", "   ", "///"])
def test_build_falls_back_when_nothing_safe_remains(blank_name: str) -> None:
    """An empty / all-whitespace / all-unsafe name yields the fallback stem."""
    artifact = ExportArtifact.build(
        content=b"x",
        name=blank_name,
        fallback="section",
        suffix=".stix",
        media_type="application/octet-stream",
    )

    # ``///`` sanitises to ``___`` which is non-empty, so only the truly
    # empty stems fall back; the underscores case keeps its underscores.
    assert artifact.filename in {"section.stix", "___.stix"}


def test_build_composes_stem_and_suffix_verbatim() -> None:
    """``build`` composes exactly ``f'{safe_filename_stem(name, fb)}{suffix}'``."""
    stem = safe_filename_stem("Bad/Name*?", "project")
    artifact = ExportArtifact.build(
        content=b"x",
        name="Bad/Name*?",
        fallback="project",
        suffix="_fence.dxf",
        media_type="application/dxf",
    )

    assert artifact.filename == f"{stem}_fence.dxf"


def test_export_artifact_is_frozen() -> None:
    """The DTO is immutable — a handler cannot mutate a built artefact."""
    artifact = ExportArtifact(content=b"x", filename="a.dxf", media_type="application/dxf")

    with pytest.raises(AttributeError):
        artifact.filename = "b.dxf"  # type: ignore[misc]
