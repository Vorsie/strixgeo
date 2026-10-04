"""The name a CPT is shown under: "<project>-S<number>" for a bare sounding number."""

from __future__ import annotations

from groundmodel.domain.services.cpt_display_name_constants import (
    BARE_SOUNDING_NUMBER,
    GEF_PROJECT_TYPE,
    SOUNDING_SEPARATOR,
)


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
    fields = [f.strip() for f in project_id.split(",")]
    if len(fields) >= 2 and GEF_PROJECT_TYPE.fullmatch(fields[0]) and fields[1]:
        return fields[1]
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
