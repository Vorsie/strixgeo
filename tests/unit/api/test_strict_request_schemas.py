"""Every write body the API validates must reject unknown fields (M4 / Codex 6).

Pydantic's default is ``extra="ignore"``: a renamed or mistyped key in a write
body is dropped and the request returns 200 having applied nothing. On this
loopback single-seat API that is pure downside — a client bug that silently
loses the engineer's edit. The fix is one ``StrictRequestModel`` base
(``extra="forbid"`` + ``allow_inf_nan=False``) that every request/write schema
inherits.

Two tests:

* a behavioural pin in the rule's own words — ``PATCH /projects/{id}`` with a
  typo key must answer 422, not a 200 that writes nothing;
* a completeness guard — introspect every request body FastAPI validates and
  assert it (and its nested item models) forbids extras, so a request schema
  added later cannot quietly ship with the lenient default.

The deliberate lenient carve-outs are named in ``_LENIENT_BY_DESIGN`` with the
reason each keeps ``extra="ignore"``.
"""

from __future__ import annotations

import typing

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from pydantic import BaseModel

from groundmodel.api.main import app

# Qualified ``module.ClassName`` of every body schema deliberately left lenient.
#
# * ProjectBundleRequest / StratigraphyLumping — the ``.strix`` restore intake.
#   Tolerating unknown fields is documented forward-compatibility policy
#   (docs/backwards-compat.md, docs/gmproj-format.md): an older bundle carrying
#   a since-renamed top-level key (``litho_lenses`` → ``bodies``) must still
#   open. StratigraphyLumping is that bundle's sub-object, reused verbatim by
#   the staged-lumping write for its DoS ceilings.
# * The gapless-gate schemas — SHARED request+response. GaplessClauseInputSchema
#   is the base class of the response ``GaplessClauseSchema``, and the measure /
#   entry schemas serialise backend-computed geometry measures on the
#   build-report response. ``allow_inf_nan=False`` there could turn a
#   degenerate-but-reportable build into a 500, and ``extra="forbid"`` would
#   propagate to the response report; the report is additive-by-design anyway.
# * LithoLayerSuggestionItem — SHARED request+response. The segmenter's computed
#   ``mean_qc_mpa`` / ``dr_pct`` (unbounded floats) serialise on the
#   litho-suggest response; strictness there risks a 500 on the core litho
#   workflow that no unit test can rule out.
_LENIENT_BY_DESIGN = frozenset(
    {
        "groundmodel.api.schemas.project.project_bundle.ProjectBundleRequest",
        "groundmodel.api.schemas.project.project_bundle.StratigraphyLumping",
        "groundmodel.api.schemas.project.gapless_build_report.GaplessMeasureSchema",
        "groundmodel.api.schemas.project.gapless_build_report.GaplessClauseEntrySchema",
        "groundmodel.api.schemas.project.gapless_build_report.GaplessClauseInputSchema",
        (
            "groundmodel.api.schemas.project.litho_suggestion."
            "litho_layer_suggestion_item.LithoLayerSuggestionItem"
        ),
    }
)


def _qualified(model: type[BaseModel]) -> str:
    """Return ``module.ClassName`` for a model."""
    return f"{model.__module__}.{model.__name__}"


def _iter_types(annotation: object) -> typing.Iterator[object]:
    """Yield an annotation and every type argument nested within it."""
    yield annotation
    for arg in typing.get_args(annotation):
        yield from _iter_types(arg)


def _collect(model: type[BaseModel], into: set[type[BaseModel]]) -> None:
    """Add ``model`` and every Pydantic model reachable through its fields."""
    if model in into:
        return
    into.add(model)
    for field in model.model_fields.values():
        for candidate in _iter_types(field.annotation):
            if isinstance(candidate, type) and issubclass(candidate, BaseModel):
                _collect(candidate, into)


def _request_body_models() -> set[type[BaseModel]]:
    """Return every Pydantic model FastAPI validates as (part of) a request body."""
    models: set[type[BaseModel]] = set()
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        for body_param in route.dependant.body_params:
            for candidate in _iter_types(body_param.field_info.annotation):
                if isinstance(candidate, type) and issubclass(candidate, BaseModel):
                    _collect(candidate, models)
    return models


@pytest.fixture(scope="module")
def client() -> TestClient:
    """One TestClient; ``base_url`` set so TrustedHostMiddleware admits it."""
    return TestClient(app, base_url="http://127.0.0.1")


def test_patch_project_with_a_typo_key_is_a_422_not_a_silent_200(client: TestClient) -> None:
    """A mistyped field name must be refused, not dropped.

    ``default_horizonal_epsg`` (typo for ``default_horizontal_epsg``) used to be
    ignored: the PATCH returned 200 having written nothing, and the caller never
    learned the edit was lost. With the strict base the unknown key is a 422.
    The 422 is raised during body validation, before any DB access, so this is a
    pure unit test.
    """
    response = client.patch(
        "/projects/00000000-0000-0000-0000-000000000000",
        json={"default_horizonal_epsg": 31370},
    )
    assert response.status_code == 422, (
        f"a typo'd write key must be refused, not silently dropped — got {response.status_code}"
    )


def test_every_request_body_forbids_unknown_fields() -> None:
    """Completeness guard: no request/write schema keeps the lenient default.

    Introspects every body FastAPI validates (and every item model nested in
    one). Each must set ``extra="forbid"`` unless it is a documented lenient
    carve-out. A new request schema shipped with the pydantic default fails here.
    """
    offenders = []
    for model in _request_body_models():
        qualified = _qualified(model)
        if qualified in _LENIENT_BY_DESIGN:
            continue
        if model.model_config.get("extra") != "forbid":
            offenders.append(qualified)
    assert not offenders, (
        "these request/write schemas still accept unknown fields — re-base them "
        "on StrictRequestModel (or add to _LENIENT_BY_DESIGN with a reason):\n  "
        + "\n  ".join(sorted(offenders))
    )


def test_strict_request_bodies_also_reject_non_finite_floats() -> None:
    """The same base that forbids extras must also reject NaN/±inf floats (L7 / Codex 7).

    ``allow_inf_nan=False`` rides on ``StrictRequestModel``, so every strict body
    schema rejects a non-finite float on any of its coordinate/depth/value
    fields. Checking it here proves the base — not a bare ``extra="forbid"`` —
    is what every non-lenient schema inherited.
    """
    not_finite_guarded = []
    for model in _request_body_models():
        if _qualified(model) in _LENIENT_BY_DESIGN:
            continue
        if model.model_config.get("allow_inf_nan") is not False:
            not_finite_guarded.append(_qualified(model))
    assert not not_finite_guarded, (
        "these strict schemas do not reject non-finite floats — they should "
        "inherit StrictRequestModel, not just set extra='forbid':\n  "
        + "\n  ".join(sorted(not_finite_guarded))
    )
