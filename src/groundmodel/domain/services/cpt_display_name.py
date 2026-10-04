"""The name a CPT is shown under: "<project>-S<number>" for a bare sounding number."""

from __future__ import annotations

from groundmodel.domain.services.cpt_display_name_constants import (
    BARE_SOUNDING_NUMBER,
    GEF_PROJECT_TYPE,
    SOUNDING_SEPARATOR,
)


def _fields_after_gef_type(project_id: str) -> list[str] | None:
    """Return the trimmed comma fields after a leading GEF project type, else None.

    Parameters
    ----------
    project_id : str
        A stored project id, GEF-style ("CPT, 23.15-002[, 1]") or bare.

    Returns
    -------
    list[str] | None
        The fields after the type token ("23.15-002", "1"); None when the id
        carries no type field (a bare number, a DOV id, an empty id).
    """
    fields = [f.strip() for f in project_id.split(",")]
    if len(fields) >= 2 and GEF_PROJECT_TYPE.fullmatch(fields[0]) and fields[1]:
        return fields[1:]
    return None


def normalise_gef_project_id(raw: str) -> str:
    """Return a project id with its GEF project-type field dropped.

    The GEF ``#PROJECTID`` is "type, id[, sub-project]" and is stored as it
    stands ("CPT, 23.15-002"); a PDF-digitised CPT stores the bare project
    number ("23.15-002"). The CPT duplicate key compares both sides through
    this function so the two name one project (owner ruling 2026-10-04,
    "match on the project number"). The stored value is never rewritten.

    Parameters
    ----------
    raw : str
        The stored or incoming project id.

    Returns
    -------
    str
        The id without its leading type token ("CPT, 23.15-002" ->
        "23.15-002"; a sub-project stays: "CPT, 23.15-002, 1" ->
        "23.15-002, 1"); the trimmed input when it carries no type field.
    """
    fields = _fields_after_gef_type(raw)
    if fields is None:
        return raw.strip()
    return ", ".join(fields)


def project_number(project_id: str) -> str:
    """Return the project number of a GEF-style project id.

    Parameters
    ----------
    project_id : str
        The stored project id: a bare number ("23.15-002") or the GEF
        ``#PROJECTID`` value ("CPT, 23.15-002" or "CPT, 23.15-002, 1").

    Returns
    -------
    str
        The project number ("23.15-002"); the stripped id as it is when it
        carries no project-type field; "" for an empty id.
    """
    fields = _fields_after_gef_type(project_id)
    if fields is not None:
        return fields[0]
    return project_id.strip()


def cpt_display_name(project_id: str, test_id: str) -> str:
    """Return the name a CPT is shown under (owner ruling 2026-10-04).

    A sounding numbered on its sheet as a bare number ("110", "28A") is
    shown as "<project>-S<number>" ("23.15-002-S110"), the shape DOV gives
    its soundings, so two campaigns' "110" are told apart. The stored
    project id and test id are never changed: they are the duplicate key a
    later import of the same sounding is matched on.

    Parameters
    ----------
    project_id : str
        The stored (GEF-style) project id; may be empty.
    test_id : str
        The stored test id.

    Returns
    -------
    str
        "<project number>-S<test id>" for a bare sounding number under a
        project; the stripped test id otherwise.
    """
    number = test_id.strip()
    project = project_number(project_id)
    if project and BARE_SOUNDING_NUMBER.fullmatch(number):
        return f"{project}{SOUNDING_SEPARATOR}{number}"
    return number
