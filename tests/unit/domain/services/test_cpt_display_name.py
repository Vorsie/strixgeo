"""The CPT display name "<project>-S<number>" (owner ruling 2026-10-04).

The owner's words: "the STORED ids stay exactly as the GEF would store them
(project id + test id "110") ... The DISPLAYED name becomes
"<project>-S<number>", e.g. "23.15-002-S110", for a CPT whose test id is a
bare number (digits with an optional letter suffix: 28A, 37b, 153A) and whose
project id is set." DOV CPTs already display as "GEO-25/110-S1" and keep it.
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.cpt_display_name import (
    cpt_display_name,
    normalise_gef_project_id,
)


@pytest.mark.parametrize(
    ("project_id", "test_id", "expected"),
    [
        ("23.15-002", "110", "23.15-002-S110"),
        ("23.15-002", "28A", "23.15-002-S28A"),
        ("23.15-002", "37b", "23.15-002-S37b"),
        ("24.13-005", "153A", "24.13-005-S153A"),
        (" 23.15-002 ", " 110 ", "23.15-002-S110"),
    ],
)
def test_a_bare_sounding_number_under_a_project_reads_project_s_number(
    project_id: str, test_id: str, expected: str
) -> None:
    """A bare number (optional letter suffix) and a project: "<project>-S<number>"."""
    assert cpt_display_name(project_id, test_id) == expected


def test_a_gef_project_id_names_its_project_number_not_its_type() -> None:
    """GEF "#PROJECTID= CPT, 23.15-002": the project number is the part after the type."""
    assert cpt_display_name("CPT, 23.15-002", "110") == "23.15-002-S110"
    assert cpt_display_name("CPT, 23.15-002, 1", "110") == "23.15-002-S110"


@pytest.mark.parametrize(
    ("project_id", "test_id"),
    [
        ("", "110"),  # no project: the bare number stays
        ("GEO-25/110", "GEO-25/110-S1"),  # a DOV id is already a full name
        ("REFRESH-PROJ", "CPT-REFRESH-01"),  # a named test id is a full name
        ("23.15-002", "S110"),  # already lettered: not a bare number
        ("23.15-002", "110AB"),  # two letters: not a sounding suffix
    ],
)
def test_any_other_test_id_is_shown_as_it_is(project_id: str, test_id: str) -> None:
    """Not a bare number, or no project: the test id is the name, unchanged."""
    assert cpt_display_name(project_id, test_id) == test_id.strip()


# --- normalise_gef_project_id ------------------------------------------------
# Owner ruling (2026-10-04): a later GEF import of a PDF-digitised sounding
# must MATCH ON THE PROJECT NUMBER. The GEF stores "#PROJECTID= CPT, 23.15-002"
# with its type field kept, the PDF import stores "23.15-002"; both name the
# same project, so the duplicate key compares them with the type field dropped.


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("CPT, 23.15-002", "23.15-002"),  # the GEF type field is dropped
        ("CPT,23.15-002", "23.15-002"),  # also without the space
        ("GEF, 23.15-002", "23.15-002"),  # any short alphabetic type token
        (" CPT, 23.15-002 ", "23.15-002"),  # the ends are trimmed
        ("23.15-002", "23.15-002"),  # a bare project number is unchanged
        ("GEO-25/110", "GEO-25/110"),  # a DOV id is unchanged
        ("", ""),  # empty stays empty
    ],
)
def test_the_project_number_is_the_project_id_without_its_gef_type(raw: str, expected: str) -> None:
    """GEF "#PROJECTID= type, id": the type is dropped, the id is kept as it is."""
    assert normalise_gef_project_id(raw) == expected


def test_a_gef_sub_project_is_kept_so_two_sub_projects_stay_apart() -> None:
    """Only the type is dropped: "CPT, 23.15-002, 1" and ", 2" are not one project."""
    assert normalise_gef_project_id("CPT, 23.15-002, 1") == "23.15-002, 1"
    assert normalise_gef_project_id("CPT, 23.15-002, 1") != normalise_gef_project_id(
        "CPT, 23.15-002, 2"
    )
