"""The application/router boundary contract for every file-download export.

Every export endpoint runs an exporter, gets serialised ``bytes`` back, and
has to hand the client three things: the payload, a proposed download
filename, and a media type. Before this module each of the six export
handlers (section DXF / Plaxis 2D / D-Stability / D-Sheet, model Plaxis 3D /
fence DXF) repeated the same tail — sanitise the name into a filename stem,
append the format suffix, and build a ``Response`` with the identical
``Content-Disposition`` header — across two routers (debt #110).

``ExportArtifact`` is the small, framework-free value the application layer
returns and the API layer turns into a ``fastapi.Response``. Packaging the
bytes + filename + media type here (rather than in the router) keeps the
filename-safety rule in ONE place and honours the layer direction: the
application layer never imports a response class, so this stays testable
without FastAPI and reusable by any non-HTTP caller that ever needs an
export (a CLI batch, say).
"""

from __future__ import annotations

from dataclasses import dataclass


def safe_filename_stem(name: str, fallback: str) -> str:
    """Sanitise a user-supplied name into a safe filename stem.

    Strips characters that cause problems in filenames or
    ``Content-Disposition`` headers (forward slashes, control chars,
    double-quotes, etc.), replacing them with underscores. Falls back to
    ``fallback`` when nothing safe remains. Single source of truth for
    download-filename safety across the export endpoints.

    Parameters
    ----------
    name : str
        Raw name (project name, section name, ...).
    fallback : str
        Stem to use when the sanitised result is empty (e.g. ``"project"``
        or ``"section"``).

    Returns
    -------
    str
        Alphanumeric + ``-_`` + space filename stem, stripped of
        leading/trailing spaces.
    """
    return (
        "".join(c if c.isalnum() or c in ("-", "_", " ") else "_" for c in name).strip() or fallback
    )


@dataclass(frozen=True)
class ExportArtifact:
    """A finished export ready to be handed to the client as a download.

    Carries the exporter's serialised bytes plus the two facts a download
    response needs: the proposed filename and its media type. The API layer
    converts this into a ``fastapi.Response``; the application layer never
    imports a response class, so this DTO is the boundary between them.

    Attributes
    ----------
    content : bytes
        The serialised export payload.
    filename : str
        Proposed download filename (stem + format suffix), already
        sanitised for a ``Content-Disposition`` header.
    media_type : str
        The response ``Content-Type`` (e.g. ``"application/dxf"``).
    """

    content: bytes
    filename: str
    media_type: str

    @classmethod
    def build(
        cls,
        *,
        content: bytes,
        name: str,
        fallback: str,
        suffix: str,
        media_type: str,
    ) -> ExportArtifact:
        """Package exporter output into a download artefact.

        Combines the two per-route steps every export handler shared: build
        the safe filename (``<sanitised name><suffix>``) and pair it with the
        payload and media type. The route-specific differences — which name
        to use, its fallback, the format suffix and the media type — are the
        parameters (debt #110).

        Parameters
        ----------
        content : bytes
            The exporter's serialised output.
        name : str
            Raw name to derive the filename from (section or project name).
        fallback : str
            Filename stem used when ``name`` sanitises to empty (e.g.
            ``"section"`` or ``"project"``).
        suffix : str
            Format suffix appended to the stem, including any separator —
            e.g. ``".dxf"``, ``"_plaxis3d.py"``, ``"_fence.dxf"``.
        media_type : str
            The response ``Content-Type``.

        Returns
        -------
        ExportArtifact
            The packaged artefact, ready for the API layer to serve.
        """
        filename = f"{safe_filename_stem(name, fallback)}{suffix}"
        return cls(content=content, filename=filename, media_type=media_type)
