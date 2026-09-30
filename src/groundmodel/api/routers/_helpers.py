"""Shared route-handler helpers.

Module is private (``_``-prefixed) to mark "only routers import from
here" — the helpers shouldn't leak into application or domain layers.

The dominant pattern these helpers replace is the project-scope
guard: fetch a row, confirm it belongs to the project named in the
URL, 404 otherwise. Before this module the same four-line block lived
verbatim in 14 places across the geology / cross-section / review
routers (per the Maintenance Rules: "extract on the second copy" —
14 copies was well past that trigger).
"""

from __future__ import annotations

import tempfile
from collections.abc import Awaitable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, TypeVar
from uuid import UUID

from fastapi import HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import ARRAY, Text, case, cast, func, text, update
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.export_artifact import ExportArtifact
from groundmodel.shared.constants.db_constraints import LITHO_LAYER_NO_OVERLAP_CONSTRAINT
from groundmodel.shared.exceptions import ParseError

T = TypeVar("T")


async def apply_view_state_patch(
    session: AsyncSession,
    model: Any,
    row_id: UUID,
    patch: dict[str, Any],
) -> None:
    """Shallow-merge ``patch`` into a row's ``view_state`` inside ONE statement.

    WHY NOT the Python merge: reading the bag, merging in Python and writing the
    whole column back is a lost-update race. Two concurrent PATCHes on the same
    row read the SAME snapshot and the second COMMIT silently drops the first
    caller's key — an engineer's toggle, or the project row's ``save_anchor``,
    disappears with no error anywhere (the same class of bug debt #208 fixed on
    the section seeded-set).

    Doing the merge as a single ``UPDATE`` closes it without any lock: under
    READ COMMITTED an ``UPDATE`` that meets a concurrently-updated row waits for
    the other transaction and then re-evaluates its SET expression against the
    NEW row version, so ``view_state || patch`` composes instead of clobbering.
    An explicit advisory lock would also work but it forces the request's
    transaction open across the whole handler, which deadlocks against the
    integration suite's TRUNCATE — a lock-free statement has no such surface.

    Merge semantics are the same on every view-state surface (project-level,
    section-level, future investigation-level): each top-level key in ``patch``
    overwrites its namesake, a ``None`` value REMOVES the key, siblings are
    untouched. Nested values are deliberately NOT deep-merged — deep merge has
    surprising semantics around array fields (replace? append? dedup?) that the
    API cannot decide for callers, so a caller changing a nested field patches
    the whole subtree.

    Parameters
    ----------
    session : AsyncSession
        Session to execute in. The caller commits.
    model : Any
        ORM class carrying ``id`` and a JSONB ``view_state`` column.
    row_id : UUID
        Primary key of the row to patch.
    patch : dict[str, Any]
        Top-level keys to merge. An empty dict is a no-op.
    """
    if not patch:
        return
    additions = {key: value for key, value in patch.items() if value is not None}
    removals = [key for key, value in patch.items() if value is None]
    # ``jsonb || jsonb`` is the shallow merge; ``jsonb - text[]`` drops keys.
    #
    # The CASE is load-bearing, not defensive noise: on a non-object left side
    # ``||`` CONCATENATES instead of merging, so a bag holding SQL NULL (the
    # section column's default) or JSON ``null`` would turn into the array
    # ``[null, {...}]`` and every later read would see a list where the code
    # expects a dict. ``jsonb_typeof`` is NULL for SQL NULL, so one test covers
    # both cases plus any junk a legacy row carries.
    current = case(
        (func.jsonb_typeof(model.view_state) == "object", model.view_state),
        else_=text("'{}'::jsonb"),
    )
    merged = current.op("||")(cast(additions, JSONB))
    if removals:
        merged = merged.op("-")(cast(removals, ARRAY(Text)))
    await session.execute(update(model).where(model.id == row_id).values(view_state=merged))


def export_response(artifact: ExportArtifact) -> Response:
    """Turn an application-layer ``ExportArtifact`` into a download response.

    The single place the ``Content-Disposition`` attachment header is built.
    Every export handler ends here (debt #110): the handler runs its exporter
    and packages the bytes with :meth:`ExportArtifact.build`, then hands the
    artefact to this converter. Keeping the header construction in ONE place
    means the six routes cannot drift in how they propose a filename.

    Parameters
    ----------
    artifact : ExportArtifact
        The packaged export — payload, filename and media type — from the
        application layer.

    Returns
    -------
    fastapi.responses.Response
        A raw-bytes response with the ``attachment`` ``Content-Disposition``
        header proposing ``artifact.filename``.
    """
    return Response(
        content=artifact.content,
        media_type=artifact.media_type,
        headers={"Content-Disposition": f'attachment; filename="{artifact.filename}"'},
    )


@contextmanager
def parse_error_as_404() -> Iterator[None]:
    """Map a snapshot builder's ``ParseError`` to an HTTP 404.

    Every export handler that assembles a snapshot resolves ids the caller
    supplied (project / model / section); when one cannot be resolved the
    application-layer builder raises ``ParseError``, and the honest HTTP
    answer is 404 — the typical failure is "this id does not exist in this
    project". This wraps the ``await`` of any such builder so the two routers
    map the failure the same way (debt #110). The awaited call goes inside the
    ``with`` body; a ``ParseError`` raised there propagates through here.

    Yields
    ------
    None
        Control returns to the ``with`` body.

    Raises
    ------
    fastapi.HTTPException
        Status 404 with the ``ParseError`` message as the detail.
    """
    try:
        yield
    except ParseError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


def require_model_kind(model: Any, expected_kind: str, verb: str) -> None:
    """Raise HTTP 422 unless ``model.kind`` matches ``expected_kind``.

    Wraps the model-kind guard that every litho/geotech verb runs right
    after ``get_in_project_or_404``: reject a model of the wrong kind
    with a structured 422 so callers that accidentally pass e.g. a
    geological ``model_id`` to a litho-only verb get a clear error
    instead of a silent no-op. Before extraction the same block lived
    in 5 places with drifting error codes (``wrong_model_kind``, a
    bare-string detail); the canonical shape is the 4-of-5 majority:
    ``{"code": "invalid_model_kind", "message": ...}``.

    Parameters
    ----------
    model
        Fetched model row; must expose ``id`` and ``kind`` attributes.
    expected_kind
        Required ``kind`` token (e.g. ``"lithostratigraphic"``).
    verb
        Short verb name interpolated into the message so the caller can
        see WHICH operation rejected the model (e.g.
        ``"accept-litho-suggestions"``).

    Raises
    ------
    fastapi.HTTPException
        Status 422 with ``detail={"code": "invalid_model_kind", ...}``
        when the kind does not match.
    """
    if model.kind != expected_kind:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "invalid_model_kind",
                "message": (
                    f"Model {model.id} has kind='{model.kind}'; "
                    f"{verb} requires kind='{expected_kind}'"
                ),
            },
        )


async def get_in_project_or_404(
    fetch: Awaitable[T | None],
    project_id: UUID,
    *,
    detail: str,
    project_attr: str = "app_project_id",
) -> T:
    """Resolve a project-scoped row or raise an HTTP 404.

    Wraps the "fetch + verify scope + 404" trio that every project-
    scoped router uses. The caller passes the repository coroutine
    that fetches the row by id (already constructed, not awaited) and
    the URL's ``project_id``; the helper awaits, scope-checks against
    ``project_attr`` on the row, and either returns the row or raises
    HTTP 404 with the supplied detail.

    Parameters
    ----------
    fetch
        An awaitable that returns the row or ``None`` (typically a
        ``repo.get(some_id)`` call).
    project_id
        UUID from the request URL — every row must claim this id under
        ``project_attr``.
    detail
        Human-readable 404 message (e.g. ``"Cross-section not found"``).
        Surfaced to the API caller verbatim.
    project_attr
        Name of the project-id column on the row. Defaults to the
        codebase-wide convention ``app_project_id``. Override only if
        a specific table breaks the convention.

    Returns
    -------
    T
        The fetched row, guaranteed non-None and scope-matched.

    Raises
    ------
    fastapi.HTTPException
        Status 404 when the row is missing or belongs to a different
        project.
    """
    row = await fetch
    if row is None or getattr(row, project_attr) != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
    return row


def litho_layer_write_conflict(exc: IntegrityError, *, overlap_message: str) -> HTTPException:
    """Turn a litho-layer write ``IntegrityError`` into the answer the client expects.

    Every litho write path that commits accepted layers can trip the deferred
    ``litho_layer_accepted_no_overlap`` exclusion constraint, and each one used
    to build the same 409 body inline — differing only in the remedy sentence.

    The constraint name is checked rather than assumed: an ``IntegrityError``
    that is NOT the overlap rule (a CHECK on depth ordering, a NOT NULL, a bad
    FK) is a rejected write, not a conflict, and answering 409
    ``litho_layer_overlap`` for it would send the engineer looking for an
    overlap that does not exist. Either way the answer names the reason — an
    unmapped violation reaches the client as a 500 with no cause at all.

    Parameters
    ----------
    exc : IntegrityError
        The exception raised by the failing ``commit()``.
    overlap_message : str
        Path-specific remedy shown when the overlap constraint is the cause
        (e.g. which column to clear before retrying).

    Returns
    -------
    fastapi.HTTPException
        409 with ``code='litho_layer_overlap'`` for the exclusion constraint;
        422 with ``code='litho_layer_write_rejected'`` for any other violation.
        The caller raises it (``raise ... from exc``) so the traceback survives.
    """
    orig = str(exc.orig) if exc.orig else str(exc)
    if LITHO_LAYER_NO_OVERLAP_CONSTRAINT in orig:
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "litho_layer_overlap",
                "message": overlap_message,
                "detail": orig[:400],
            },
        )
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={
            "code": "litho_layer_write_rejected",
            "message": (
                "The database rejected these layers. Check the depths and the "
                "investigation they are anchored to."
            ),
            "detail": orig[:400],
        },
    )


async def spool_upload(file: UploadFile, *, suffix: str, max_bytes: int, label: str) -> Path:
    """Stream an upload to a temp file, refusing it past ``max_bytes``.

    Chunked copy with a byte counter so an oversized "lab file" can never be
    slurped into memory (the same guard ``POST /cpt/import`` carries inline,
    debt #39). The caller deletes the returned file when done.

    Parameters
    ----------
    file : UploadFile
        The multipart upload.
    suffix : str
        Temp-file suffix (the upload's extension).
    max_bytes : int
        Largest accepted upload.
    label : str
        What the upload is, for the 413 message (``"Lab file"``).

    Returns
    -------
    pathlib.Path
        The temp file holding the upload.

    Raises
    ------
    fastapi.HTTPException
        413 when the upload exceeds ``max_bytes`` (the partial file is removed).
    """
    received = 0
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp_path = Path(tmp.name)
        while True:
            chunk = await file.read(1024 * 1024)  # 1 MiB
            if not chunk:
                break
            received += len(chunk)
            if received > max_bytes:
                tmp.close()
                tmp_path.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"{label} upload exceeds the {max_bytes // (1024 * 1024)} MiB cap",
                )
            tmp.write(chunk)
    return tmp_path
