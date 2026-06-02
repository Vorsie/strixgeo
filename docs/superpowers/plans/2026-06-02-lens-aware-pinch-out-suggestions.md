# Lens-Aware Pinch-Out Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `SuggestBodyPinchOuts` from proposing pinch-outs for the host
halves of an enclosed lens — when a thin unit is bracketed by the same
formation above and below (e.g. SAND·SILT·SAND), suggest only the enclosed
lens, not the two host halves.

**Architecture:** A new pure domain helper, `classify_enclosed_lenses`,
classifies each unit of an investigation's depth-sorted contact stack as a
lens, a host-half, or neither — from the formation-id sequence alone.
`SuggestBodyPinchOuts.execute` calls it once per investigation and skips
host-half units in its existing emit loop. No schema, API, migration, or
frontend change — the verb simply returns fewer candidates, so fewer ghosts
render.

**Tech Stack:** Python 3.11, SQLAlchemy async, pytest / pytest-asyncio, UV.
Spec: `docs/superpowers/specs/2026-06-02-lens-aware-pinch-out-suggestions-design.md`.

---

## File Structure

- **Create** `src/groundmodel/domain/services/classify_enclosed_lenses.py`
  — pure function + result dataclass. No DB, no logging, no framework imports.
- **Create** `tests/unit/domain/services/test_classify_enclosed_lenses.py`
  — unit tests for the pure helper.
- **Modify** `src/groundmodel/application/suggest_body_pinch_outs.py`
  — import the helper; classify once per investigation; skip host-half units.
- **Modify** `tests/integration/application/test_suggest_body_pinch_outs.py`
  — add the lens-sandwich integration test.
- **Modify** `CLAUDE.md` — one-line note under the body-with-extent paragraph.

---

## Task 1: Pure helper `classify_enclosed_lenses` + unit tests

**Files:**
- Create: `src/groundmodel/domain/services/classify_enclosed_lenses.py`
- Test: `tests/unit/domain/services/test_classify_enclosed_lenses.py`

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/domain/services/test_classify_enclosed_lenses.py`:

```python
"""Unit tests for classify_enclosed_lenses.

A contact stack is a depth-sorted list of formation ids (one per contact).
The helper marks which units between contacts are enclosed lenses and which
are the host halves wrapping them.  Pure function — no DB, no I/O.
"""

from __future__ import annotations

from uuid import UUID

from groundmodel.domain.services.classify_enclosed_lenses import (
    classify_enclosed_lenses,
)


def _fid(n: int) -> UUID:
    """Deterministic stand-in formation id."""
    return UUID(int=n)


SAND = _fid(1)
SILT = _fid(2)
CLAY = _fid(3)


def test_single_lens_sand_silt_sand_clay() -> None:
    """SAND·SILT·SAND·CLAY: silt (unit 1) is a lens; both sands (0, 2) are
    host halves; the deepest clay frames no unit."""
    result = classify_enclosed_lenses([SAND, SILT, SAND, CLAY])
    assert result.lens_units == {1}
    assert result.host_half_units == {0, 2}


def test_lens_with_host_to_bottom() -> None:
    """SAND·SILT·SAND with the lower sand as the deepest contact: silt is
    still a lens; only the upper sand (0) is a framed host-half — the lower
    sand frames no unit (no contact below it)."""
    result = classify_enclosed_lenses([SAND, SILT, SAND])
    assert result.lens_units == {1}
    assert result.host_half_units == {0}


def test_clay_lens_host_to_bottom() -> None:
    """CLAY·SAND·CLAY (clay to the bottom): the sand is a lens-in-clay;
    upper clay (0) is the only framed host-half."""
    result = classify_enclosed_lenses([CLAY, SAND, CLAY])
    assert result.lens_units == {1}
    assert result.host_half_units == {0}


def test_stacked_lenses_sand_matrix() -> None:
    """SAND·SILT·SAND·SILT·SAND·CLAY: both silts are lenses; the three sands
    are host halves.  Sand recurs (count 3 > silt 2) so it is the matrix —
    the middle sand is NOT mis-classified as a lens-in-silt."""
    result = classify_enclosed_lenses([SAND, SILT, SAND, SILT, SAND, CLAY])
    assert result.lens_units == {1, 3}
    assert result.host_half_units == {0, 2, 4}


def test_minority_is_lens_silt_matrix() -> None:
    """SILT·SAND·SILT·SAND·SILT·CLAY: sand is the minority (count 2 < silt 3)
    so the sands (1, 3) are lenses in the silt matrix."""
    result = classify_enclosed_lenses([SILT, SAND, SILT, SAND, SILT, CLAY])
    assert result.lens_units == {1, 3}
    assert result.host_half_units == {0, 2, 4}


def test_tie_counts_not_a_lens() -> None:
    """SAND·SILT·SAND·SILT·CLAY: sand count 2 equals silt count 2 → the
    matrix is ambiguous → nothing is flagged (conservative)."""
    result = classify_enclosed_lenses([SAND, SILT, SAND, SILT, CLAY])
    assert result.lens_units == set()
    assert result.host_half_units == set()


def test_no_lens_when_all_neighbours_distinct() -> None:
    """CLAY·SAND·SILT·CLAY: every interior unit has distinct neighbours →
    no lens."""
    result = classify_enclosed_lenses([CLAY, SAND, SILT, CLAY])
    assert result.lens_units == set()
    assert result.host_half_units == set()


def test_short_stacks_have_no_lens() -> None:
    """One or two contacts cannot frame an interior (enclosed) unit."""
    assert classify_enclosed_lenses([]).lens_units == set()
    assert classify_enclosed_lenses([SAND]).lens_units == set()
    assert classify_enclosed_lenses([SAND, SILT]).lens_units == set()
    assert classify_enclosed_lenses([SAND, SILT]).host_half_units == set()


def test_determinism() -> None:
    """Same input → same output (sets compare equal regardless of order)."""
    stack = [SAND, SILT, SAND, SILT, SAND, CLAY]
    first = classify_enclosed_lenses(stack)
    second = classify_enclosed_lenses(stack)
    assert first == second
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/unit/domain/services/test_classify_enclosed_lenses.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named
'groundmodel.domain.services.classify_enclosed_lenses'`.

- [ ] **Step 3: Write the helper**

Create `src/groundmodel/domain/services/classify_enclosed_lenses.py`:

```python
"""Pure domain helper — classify enclosed lens units on a contact stack.

A lithostratigraphic contact stack is the depth-sorted list of contact
"tops" on one investigation.  Between consecutive contacts lies a *unit*:
unit ``i`` spans contact ``i`` (its top) down to contact ``i+1`` (its base).
The deepest contact has no base contact below it and so frames no unit.

An *enclosed lens* is a thin unit whose formation differs from the formation
of the contact directly above AND directly below it, where those bracketing
contacts share the SAME formation (e.g. SAND · SILT · SAND, both sands one
formation row).  Geologically the bracketing formation is one continuous
host wrapping the lens; the lens is the thing that pinches out laterally.

This module answers, from a formation-id sequence alone, which unit indices
are enclosed lenses and which are the host halves wrapping them.  It is a
PURE function — no I/O, no DB, no logging — so it is unit-testable in
isolation and callable from any layer without violating the clean-
architecture dependency rule.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class EnclosedLensClassification:
    """Result of :func:`classify_enclosed_lenses`.

    Attributes
    ----------
    lens_units : set[int]
        Unit indices that are enclosed lenses — bracketed above and below
        by the same (different-from-self) formation, where the lens
        formation is the minority of the bracket pair.
    host_half_units : set[int]
        Unit indices that are the bracketing host of some enclosed lens
        (the unit directly above or below a lens, sharing the host
        formation).  These are interior to one continuous host body and
        must NOT be suggested as independent pinch-outs.
    """

    lens_units: set[int]
    host_half_units: set[int]


def classify_enclosed_lenses(
    formation_ids: list[UUID],
) -> EnclosedLensClassification:
    """Classify enclosed-lens and host-half units on a contact stack.

    Parameters
    ----------
    formation_ids : list[UUID]
        Formation id of each contact on one investigation, ordered by
        ``depth_top_m`` ascending.  Entry ``k`` is the top of unit ``k``;
        the LAST entry frames no unit (no base contact below it).

    Returns
    -------
    EnclosedLensClassification
        ``lens_units`` and ``host_half_units`` as sets of unit indices in
        ``range(len(formation_ids) - 1)``.  Both are empty when the stack
        has fewer than three contacts or contains no qualifying bracket.

    Notes
    -----
    With ``n`` contacts there are ``U = n - 1`` units.  ``count(F)`` is the
    number of contacts whose formation is ``F`` (over all ``n`` contacts).
    Unit ``i`` is an enclosed lens iff ``1 <= i <= U-1`` AND
    ``formation_ids[i-1] == formation_ids[i+1] != formation_ids[i]`` AND
    ``count(formation_ids[i]) < count(formation_ids[i-1])`` (the lens is the
    minority; the recurring formation is the host/matrix).  A true count
    tie is not a lens.  The lower host half ``i+1`` is recorded only when it
    is itself a framed unit (``i+1 < U``); otherwise it is the deepest
    contact and frames no unit.
    """
    n = len(formation_ids)
    unit_count = n - 1  # the last contact frames no unit
    lens_units: set[int] = set()
    host_half_units: set[int] = set()
    if unit_count < 2:
        # Need at least three contacts (two units) for an interior unit.
        return EnclosedLensClassification(lens_units, host_half_units)

    # Count over ALL contacts so a host that runs to the bottom of the hole
    # (its deepest occurrence frames no unit) still counts toward "matrix".
    counts = Counter(formation_ids)

    # Unit i is framed by contacts i, i+1.  A lens needs a contact directly
    # above (i-1 >= 0) and directly below (i+1 <= n-1), i.e. 1 <= i <= n-2,
    # which is 1 <= i <= unit_count-1 → range(1, unit_count).
    for i in range(1, unit_count):
        above_fid = formation_ids[i - 1]
        lens_fid = formation_ids[i]
        below_fid = formation_ids[i + 1]
        if (
            above_fid == below_fid
            and above_fid != lens_fid
            and counts[lens_fid] < counts[above_fid]
        ):
            lens_units.add(i)
            host_half_units.add(i - 1)  # upper host half — always a framed unit
            if i + 1 < unit_count:
                # Lower host half is a framed unit only when a contact exists
                # below it; otherwise it is the deepest contact (no unit).
                host_half_units.add(i + 1)

    return EnclosedLensClassification(
        lens_units=lens_units,
        host_half_units=host_half_units,
    )
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run pytest tests/unit/domain/services/test_classify_enclosed_lenses.py -v`
Expected: PASS — all nine tests green.

- [ ] **Step 5: Format and lint both new files**

Run:
```
uv run ruff format src/groundmodel/domain/services/classify_enclosed_lenses.py tests/unit/domain/services/test_classify_enclosed_lenses.py
uv run ruff check --fix src/groundmodel/domain/services/classify_enclosed_lenses.py tests/unit/domain/services/test_classify_enclosed_lenses.py
```
Expected: no remaining lint errors.

- [ ] **Step 6: Commit (one file per commit)**

```bash
git add src/groundmodel/domain/services/classify_enclosed_lenses.py
git commit -m "feat(litho): pure helper to classify enclosed-lens units on a contact stack"
git add tests/unit/domain/services/test_classify_enclosed_lenses.py
git commit -m "test(litho): unit tests for classify_enclosed_lenses"
```

---

## Task 2: Wire the helper into `SuggestBodyPinchOuts`

**Files:**
- Modify: `src/groundmodel/application/suggest_body_pinch_outs.py`
  (import near the top; classification + skip in `execute`, the loop around
  lines 256-366)
- Test: `tests/integration/application/test_suggest_body_pinch_outs.py`
  (add one test function at the end)

- [ ] **Step 1: Write the failing integration test**

Append this test function to the end of
`tests/integration/application/test_suggest_body_pinch_outs.py` (the file's
`_borehole`, `_geo_model`, `_litho_model`, `_geo_parent`, `_formation`,
`_contact`, and `project` fixture/helpers are already defined there):

```python
# ---------------------------------------------------------------------------
# Test 6: enclosed lens (SAND·SILT·SAND) → only the silt is suggested
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_enclosed_lens_suppresses_host_half_candidates(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """A source stack of SAND·SILT·SAND·CLAY where both sands share one
    formation must suggest a pinch-out for the silt lens ONLY — never for
    the upper or lower sand half (they are one continuous host wrapping the
    lens).

    Topology on bh_source (depth → formation):
      2.0  c_sand_top  (f_sand)   ┐ upper sand  (host half — suppressed)
      4.0  c_silt      (f_silt)   ┤ SILT lens   (suggested)
      6.0  c_sand_low  (f_sand)   ┤ lower sand  (host half — suppressed)
      10.0 c_clay      (f_clay)   ┘ base
    bh_left / bh_right each carry one (uncorrelated) contact so the silt
    has a neighbour on each side.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-SBPO-t6")
    # Both sand halves reference ONE formation row (same find-or-create key).
    f_sand = _formation(project, parent, name="ZAND-SBPO-t6", soil_code="ZAND", ordinal=0)
    f_silt = _formation(project, parent, name="SILT-SBPO-t6", soil_code="SILT", ordinal=1)
    f_clay = _formation(project, parent, name="KLEI-SBPO-t6", soil_code="KLEI", ordinal=2)
    f_flank = _formation(project, parent, name="VEEN-SBPO-t6", soil_code="VEEN", ordinal=3)
    db_session.add_all([geo, litho, parent, f_sand, f_silt, f_clay, f_flank])
    await db_session.flush()

    bh_left = _borehole(project.id, suffix="T6-L", x=170000.0)
    bh_source = _borehole(project.id, suffix="T6-S", x=170500.0)
    bh_right = _borehole(project.id, suffix="T6-R", x=171000.0)
    db_session.add_all([bh_left, bh_source, bh_right])
    await db_session.flush()

    c_sand_top = _contact(litho, f_sand, bh_source, depth=2.0)
    c_silt = _contact(litho, f_silt, bh_source, depth=4.0)
    c_sand_low = _contact(litho, f_sand, bh_source, depth=6.0)
    c_clay = _contact(litho, f_clay, bh_source, depth=10.0)
    c_left = _contact(litho, f_flank, bh_left, depth=3.0)
    c_right = _contact(litho, f_flank, bh_right, depth=3.0)
    db_session.add_all([c_sand_top, c_silt, c_sand_low, c_clay, c_left, c_right])
    await db_session.commit()

    candidates = await SuggestBodyPinchOuts(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )

    source_candidates = [c for c in candidates if c.source_investigation_id == bh_source.id]

    # Every emitted candidate is for the SILT lens unit (its top contact is
    # c_silt); the two sand halves are suppressed.
    above_ids = {c.above_contact_id for c in source_candidates}
    assert above_ids == {c_silt.id}, (
        f"Expected only the silt unit suggested, got above-contacts: {above_ids}"
    )
    assert c_sand_top.id not in above_ids
    assert c_sand_low.id not in above_ids
    # The silt lens still emits (it is the real pinch-out), and its base is
    # the lower sand's top contact.
    assert len(source_candidates) >= 1
    assert all(c.below_contact_id == c_sand_low.id for c in source_candidates)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `.\scripts\run-integration-tests.ps1 tests/integration/application/test_suggest_body_pinch_outs.py::test_enclosed_lens_suppresses_host_half_candidates`
Expected: FAIL — `above_ids` contains `c_sand_top.id` and `c_sand_low.id`
in addition to `c_silt.id` (the current code suggests all three).

- [ ] **Step 3: Add the import**

In `src/groundmodel/application/suggest_body_pinch_outs.py`, add the import
alongside the other domain/infra imports (after the
`from groundmodel.application.scope_guard import load_scoped_or_raise` line):

```python
from groundmodel.domain.services.classify_enclosed_lenses import (
    classify_enclosed_lenses,
)
```

- [ ] **Step 4: Classify per investigation + skip host-half units**

In `execute`, the per-investigation loop currently reads (around lines
261-269):

```python
        for inv_id, entries in stacks.items():
            # In section mode, a source that isn't on this section has no
            # along-position — skip it (its candidates wouldn't render anyway).
            if inv_id not in position:
                continue
            src_pos = position[inv_id]
            for i in range(len(entries) - 1):
                _, above_id, above_formation = entries[i]
                _, below_id, _below_formation = entries[i + 1]
```

Replace that span with (adds the classification and the host-half skip;
`entries` items are `(depth, contact_id, formation_id)` tuples, so the
formation id is element `[2]`):

```python
        for inv_id, entries in stacks.items():
            # In section mode, a source that isn't on this section has no
            # along-position — skip it (its candidates wouldn't render anyway).
            if inv_id not in position:
                continue
            src_pos = position[inv_id]

            # Lens-aware suppression: a thin unit bracketed by the SAME
            # formation above and below (e.g. SAND·SILT·SAND, both sands one
            # formation row) is an enclosed lens — the bracketing formation is
            # one continuous host wrapping it.  The lens itself stays a normal
            # candidate (it is the real pinch-out); the host halves must NOT be
            # suggested as independent pinch-outs.  See spec
            # docs/superpowers/specs/2026-06-02-lens-aware-pinch-out-suggestions-design.md.
            host_half_units = classify_enclosed_lenses(
                [entry[2] for entry in entries]
            ).host_half_units

            for i in range(len(entries) - 1):
                if i in host_half_units:
                    # Interior to a continuous host wrapping a lens — the host
                    # is presumptively continuous here, not a pinch-out. Skip.
                    continue
                _, above_id, above_formation = entries[i]
                _, below_id, _below_formation = entries[i + 1]
```

- [ ] **Step 5: Run the integration test to verify it passes**

Run: `.\scripts\run-integration-tests.ps1 tests/integration/application/test_suggest_body_pinch_outs.py`
Expected: PASS — the new test plus all five pre-existing tests
(no-correlations, bilateral closure, claimed-left, leftmost-edge,
no-persistence) stay green (the existing topologies have no same-formation
bracket, so nothing is suppressed).

- [ ] **Step 6: Run the unit suite for regressions**

Run: `uv run pytest tests/unit -q`
Expected: PASS — no regressions (the change is additive and import-only at
module load).

- [ ] **Step 7: Format and lint**

Run:
```
uv run ruff format src/groundmodel/application/suggest_body_pinch_outs.py tests/integration/application/test_suggest_body_pinch_outs.py
uv run ruff check --fix src/groundmodel/application/suggest_body_pinch_outs.py tests/integration/application/test_suggest_body_pinch_outs.py
```
Expected: no remaining lint errors.

- [ ] **Step 8: Commit (one file per commit)**

```bash
git add src/groundmodel/application/suggest_body_pinch_outs.py
git commit -m "feat(litho): suppress host-half pinch-out suggestions for enclosed lenses"
git add tests/integration/application/test_suggest_body_pinch_outs.py
git commit -m "test(litho): SuggestBodyPinchOuts suggests only the lens in a SAND·SILT·SAND stack"
```

---

## Task 3: Dogfeed verification + docs

**Files:**
- Modify: `CLAUDE.md` (one line in the body-with-extent refactor paragraph)

- [ ] **Step 1: Confirm the full backend gate is green**

Run:
```
uv run pytest tests/unit -q
.\scripts\run-integration-tests.ps1 tests/integration/application/test_suggest_body_pinch_outs.py
```
Expected: PASS on both. Record the pass counts.

- [ ] **Step 2: Manual dogfeed on the screenshot project**

Open the dev desktop app (close any running e2e backend first — both use
:8765). Open the project from the dogfeed (the one with the
SAND·SILT·SAND stack from the 2026-06-02 screenshot). Run the
**"Suggest pinch-outs"** toolbar verb on that section.

Expected: exactly one ghost wedge over the silt unit at the right test;
**no** ghost over the upper or lower sand. Confirm with the owner that the
result matches "one sand layer, one pinched-out silt lens."

If extra ghosts still appear over a sand half, the two sand intervals are
NOT sharing one `formation_id` (different admixture signature or a
straddle-split parent). That is correct-by-design (Decision §3.2) — verify
the two sand units' composition in the inspector before treating it as a
bug.

- [ ] **Step 3: Add the CLAUDE.md note**

In `CLAUDE.md`, find the body-with-extent refactor paragraph (it begins
**"body-with-extent refactor (2026-05-31..."**) and append this sentence at
the end of that paragraph:

```
Lens-aware suggest (2026-06-02): ``SuggestBodyPinchOuts`` now suppresses
the host-half candidates of an enclosed lens — a thin unit bracketed by the
same ``formation_id`` above and below (e.g. SAND·SILT·SAND) suggests only
the lens, not the two host halves (pure helper
``domain/services/classify_enclosed_lenses.py``; exact same-formation
bracket + recurring-formation-is-matrix tiebreak). Continuity stays
emergent from correlations; body-level admixture editing deferred to the
geotech stage. Spec:
``docs/superpowers/specs/2026-06-02-lens-aware-pinch-out-suggestions-design.md``.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note lens-aware pinch-out suggestions in body-with-extent section"
```

---

## Notes for the implementer

- **No frontend change.** The verb returns fewer `PinchOutCandidate`s;
  `BodyExtentOverlay` renders whatever comes back, so fewer ghosts appear
  automatically. Do not touch the renderer.
- **No API/schema/migration change.** The suggester is read-only and the
  candidate shape is unchanged.
- **Integration tests must use the wrapper script**
  (`.\scripts\run-integration-tests.ps1`), never bare
  `uv run pytest tests/integration` — the wrapper points `DATABASE_URL` at
  the sibling `groundmodel_integration` DB; the bare command would wipe the
  dev DB.
- **Section mode is unaffected.** `classify_enclosed_lenses` runs per
  investigation regardless of whether `section_id` was passed, so the
  suppression works in both the section and UUID-fallback paths.
