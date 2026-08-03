"""HTTP contract for refresh-on-reimport: ``POST /cpt/import`` twice.

The first upload creates the row (201). A second upload of the SAME file does
NOT silently overwrite it: replacing a stored series is irreversible, so the
endpoint answers 409 with the old-vs-new diff and waits for
``confirm_refresh=true`` (``docs/ux.md`` — "Reversible vs irreversible": an
irreversible action gets a confirmation dialog, default-focus Cancel, and an
action-named button). With the confirmation it refreshes in place (200,
``refreshed=true``, same ``cpt_id``).

Two things a confirmation cannot buy: a file that parses to zero rows, and a
file whose fresh parse carries ERROR-level issues. Both are refused with 422
and a named reason — a broken file must never overwrite good data.

Requires Docker DB on localhost:5433 (run via scripts/run-integration-tests.ps1).
"""

from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import make_project

# Minimal complete GEF — PROJECTID + TESTID drive the duplicate identity.
_GEF = (
    "#PROJECTID= REFRESH-PROJ\n"
    "#TESTID= CPT-REFRESH-01\n"
    "#XYID= 32000, 200000.0, 100000.0\n"
    "#ZID= 32001, 5.0\n"
    "#COLUMN= 3\n"
    "#COLUMNINFO= 1, m, depth, 1\n"
    "#COLUMNINFO= 2, MPa, cone resistance, 2\n"
    "#COLUMNINFO= 3, MPa, sleeve friction, 3\n"
    "#EOH=\n"
    "0.20; 1.0; 0.05\n0.40; 1.5; 0.06\n0.60; 2.0; 0.07\n"
)

# Same identity, no data rows at all — the truncated-download shape.
_GEF_NO_ROWS = _GEF.split("#EOH=\n")[0] + "#EOH=\n"

# Same identity, depths that go backwards — DEPTH_NOT_MONOTONIC is an
# ERROR-level parse issue, i.e. a file we must not trust as a replacement.
_GEF_BROKEN = _GEF.split("#EOH=\n")[0] + "#EOH=\n0.60; 2.0; 0.07\n0.20; 1.0; 0.05\n"


async def _import(client: AsyncClient, project_id: str, gef: str, *, confirm: bool | None = None):
    """POST one GEF to ``/cpt/import``.

    Parameters
    ----------
    client : AsyncClient
        Test client.
    project_id : str
        App project scope.
    gef : str
        File content.
    confirm : bool | None, optional
        When given, sent as the ``confirm_refresh`` form field.

    Returns
    -------
    httpx.Response
        The raw response, so each test asserts its own status.
    """
    data = {"project_id": project_id}
    if confirm is not None:
        data["confirm_refresh"] = "true" if confirm else "false"
    return await client.post(
        "/cpt/import",
        files={"file": ("refresh.gef", gef.encode(), "text/plain")},
        data=data,
    )


async def test_reimporting_without_confirmation_asks_first_and_changes_nothing(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """Second upload of the same file → 409 carrying the diff, stored row untouched."""
    project = await make_project(db_session)

    first = await _import(async_client, str(project.id), _GEF)
    assert first.status_code == 201, first.text
    created = first.json()
    assert created["refreshed"] is False
    assert created["name"] == "CPT-REFRESH-01"

    second = await _import(async_client, str(project.id), _GEF)
    assert second.status_code == 409, second.text
    detail = second.json()["detail"]
    assert detail["code"] == "cpt_refresh_confirmation_required"
    assert detail["cpt_id"] == created["cpt_id"]
    assert detail["name"] == "CPT-REFRESH-01"
    # The dialog decides on numbers, not on a filename.
    assert detail["old_max_depth_m"] == 0.60
    assert detail["new_max_depth_m"] == 0.60
    assert detail["old_n_rows"] == 3
    assert detail["new_n_rows"] == 3
    assert detail["n_errors"] == 0


async def test_reimporting_with_confirmation_refreshes_in_place(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """``confirm_refresh=true`` → 200 + refreshed=true + same cpt_id."""
    project = await make_project(db_session)

    first = await _import(async_client, str(project.id), _GEF)
    assert first.status_code == 201, first.text
    created = first.json()

    second = await _import(async_client, str(project.id), _GEF, confirm=True)
    assert second.status_code == 200, second.text
    refreshed = second.json()
    assert refreshed["refreshed"] is True
    assert refreshed["cpt_id"] == created["cpt_id"]


async def test_a_file_that_parses_to_zero_rows_never_replaces_stored_data(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """An empty file cannot overwrite a stored series, even WITH confirmation.

    On the GEF path the refusal lands one layer earlier than the refresh guard:
    ``GEFParser`` raises ``ParseError`` ("contains no data rows") and the router
    answers 400, so the import never reaches ``_refresh``. That is a stronger
    protection than the guard, not a weaker one — what this test pins is the
    OUTCOME the rule cares about: the stored measurements survive. The
    persist-level ``no_rows`` guard still matters for callers that hand
    ``persist()`` an already-parsed result (the DOV importers), and is covered
    in ``tests/unit/application/test_import_cpt_refresh_guard.py``.
    """
    project = await make_project(db_session)

    first = await _import(async_client, str(project.id), _GEF)
    assert first.status_code == 201, first.text
    cpt_id = first.json()["cpt_id"]

    refused = await _import(async_client, str(project.id), _GEF_NO_ROWS, confirm=True)
    assert refused.status_code == 400, refused.text
    assert "no data rows" in refused.text

    # The stored series is exactly what the good file wrote.
    plot = await async_client.get(f"/cpt/{cpt_id}/plot?project_id={project.id}")
    assert plot.status_code == 200, plot.text
    assert plot.json()["depths_m"] == [0.20, 0.40, 0.60]


async def test_a_file_with_parse_errors_never_replaces_stored_data(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """An ERROR-level parse is refused with 422 even WITH confirmation."""
    project = await make_project(db_session)

    first = await _import(async_client, str(project.id), _GEF)
    assert first.status_code == 201, first.text
    cpt_id = first.json()["cpt_id"]

    refused = await _import(async_client, str(project.id), _GEF_BROKEN, confirm=True)
    assert refused.status_code == 422, refused.text
    detail = refused.json()["detail"]
    assert detail["code"] == "cpt_refresh_refused"
    assert detail["reason"] == "parse_errors"

    plot = await async_client.get(f"/cpt/{cpt_id}/plot?project_id={project.id}")
    assert plot.status_code == 200, plot.text
    assert plot.json()["depths_m"] == [0.20, 0.40, 0.60]
