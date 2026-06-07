# Cross-lithology surface ties — design (Thread B)

**Date:** 2026-06-07
**Status:** approved (brainstorming → writing-plans)
**Surface:** litho cross-section correlation gesture + edge rendering
**Origin:** dogfeed — "sometimes I want to correlate *top is the same as next
test* or *bottom is the same*, but I can't"

---

## Context

A litho contact-correlation edge (`litho_contact_correlation_edge`) connects two
`formation_contact` rows. Today `CorrelateLithoContacts` step 4b **rejects** an
edge whose endpoints have different `litho_main_soil_code` (a SILT↔ZAND 422).
That guard was added 2026-06-05 because a cross-lithology edge "groups nothing
yet still renders as a stray ribbon (the black diagonal)".

The owner needs the opposite: to assert that a boundary is **one continuous
surface across adjacent tests even when the material differs** — a sand top that
correlates to a clay top (a facies change), pinning just that surface. The model
has no concept of a boundary tie decoupled from same-lithology body membership,
so the gesture is blocked.

Brainstorming settled the semantics: a cross-lithology tie means **A — a surface
line only** (not a facies band, not a body). Below the tied surface the
auto-partition handles the differing units as before. Ties are **pairwise**
(this test ↔ the next).

## Why this is safe + contained

1. **The resolver already drops cross-lithology edges** from body formation
   (`resolve_litho_instances.py:221`, `if a.litho_main_soil_code !=
   b.litho_main_soil_code: continue`). A tie can never create a mixed-lithology
   body.
2. **Auto-correlate only proposes same-lithology edges** (it groups by
   `litho_main_soil_code`). A cross-lithology tie is therefore *always* a
   deliberate manual gesture — never auto-generated noise.
3. **"Surface tie vs body correlation" is derivable** from the endpoints'
   lithology — no new column, no new gesture, no migration (owner choice
   2026-06-07).

## Approach (owner-approved)

**Derived classification, line-only rendering.**

- **Creation:** remove the same-lithology guard (step 4b) in
  `CorrelateLithoContacts`. All other guards (self-loop, same-investigation,
  model/project scope) stay. A cross-lithology edge persists with
  `user_approved=True` (manual) like any other.
- **Classification (derived):** an edge is a **surface tie** iff its two endpoint
  contacts resolve to formations of different `litho_main_soil_code`; otherwise a
  **body correlation** (unchanged). Computed at render time from the
  contact→formation→litho lookup the overlay already has.
- **Rendering:** `CorrelationEdgesOverlay` draws a surface tie as the **clean
  point-to-point connecting line only** (the existing emerald `CONTACT_EDGE`
  line for approved, amber-dashed for pending). For a tie it **suppresses** the
  filled seam **ribbon** and the `#N` body **chip** (there is no body). A body
  correlation keeps today's line + ribbon + chip. This is precisely the "line vs
  band" distinction the owner picked, and it removes the "black diagonal"
  stray-ribbon the original guard was protecting against.
- **Gesture:** the contact-correlate mode already arms a clicked contact and
  fires an edge to the next clicked contact. With the guard gone, cross-lithology
  pairs just work. "Top" vs "bottom" is simply *which contact the user clicks*
  (a contact tops a unit; the unit's bottom is the next contact down) — no new
  gesture. Optional polish: tint the armed line to telegraph "surface tie" when
  the pending pair is cross-lithology (defer unless it reads ambiguously).

### Approaches considered + rejected

- **Explicit `is_surface_tie` column + separate gesture/mode.** More explicit
  and queryable, but a schema change + migration + extra UI for a distinction
  that is fully derivable today. Rejected (owner chose derived).
- **Render ties identically to body correlations (line + ribbon).** Simpler but
  reintroduces the stray-ribbon "black diagonal". Rejected.
- **Facies band (option B) / horizon (section-wide).** A cross-litho tie that
  fills a graded band, or a surface spanning many tests at once. Deferred —
  the owner chose the line-only, pairwise meaning. Note: option-C ("band when
  both top + bottom of a pair are tied") stays a clean future extension because
  the data (two ties on the same unit pair) is already expressible.

## Components / files

- `application/correlate_litho_contacts.py` — delete step 4b (the
  `_litho_code` comparison + raise). Keep `_litho_code` only if still used;
  otherwise remove it too.
- `components/sections/CorrelationEdgesOverlay.tsx` — add the per-edge
  tie-vs-body classification (endpoint lithology compare) and branch the render:
  surface tie → line only (no ribbon, no chip).
- Gesture: no code change expected (guard removal unblocks it); verify in the
  canvas/overlay correlate path.

## Testing

- **Invert** `tests/integration/api/test_litho_contact_correlations.py::
  test_cross_lithology_correlation_is_422` → cross-lithology now returns **201**
  and creates an edge. Add an assertion that after the edge,
  `ResolveLithoInstances` still produces **no shared body** across the two
  endpoints (the units keep distinct `body_id`s) — the safety invariant.
- **Overlay unit test** (`CorrelationEdgesOverlay.test.tsx`): a cross-lithology
  edge renders the connecting **line** but **no seam ribbon / no body chip**; a
  same-lithology edge still renders the ribbon. (TDD: assert testids/elements.)
- **Gesture** (if a code touch is needed): correlating two cross-lithology
  contacts fires the create call (no client-side block).

## Non-goals

- No facies-band fill, no colour-gradient body (option B/C) — deferred.
- No schema change, no new column, no migration.
- No section-wide horizon entity — ties stay pairwise.
- Thread A (auto-partition geometry: halfway pinch + too-shallow carry-through)
  is separate and comes after B.

## Open questions

- Does the armed-correlation visual need a distinct "tie" tint while dragging a
  cross-lithology pair, or is the post-commit line enough? Decide during
  implementation from how it reads; default to no extra tint (YAGNI).
