groundmodel.application.geotech_edge_derivation
===============================================

.. CG-PAGE source=src/groundmodel/application/geotech_edge_derivation.py complete=true

*Source file:* ``src/groundmodel/application/geotech_edge_derivation.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-112

.. literalinclude:: ../../../src/groundmodel/application/geotech_edge_derivation.py
   :language: python
   :lines: 1-112
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the shared module that turns approved LITHO
correlations into geotech (packing) correlations. It gathers imports for the
pure alignment, bridging and crossing services and the database edge and layer
rows, and defines two tuning constants: a 1 mm depth tolerance (the litho unit
and its sub-bands are stored separately, so a band can round a hair past the
unit edge) and an extent-gap slack that limits how far a class match may dip
across a gap and still be proposed.

**Why it is here.** A "correlation" (or "tie") is the line joining a band on one
column to a band on the next; both geotech presses need to derive these the same
way, so the logic lives in one place (extract on the second copy). The docstring
records the design: given a litho edge — a correlated litho-unit pair traced
across two columns — it collects each column's packing sub-bands inside that
unit, aligns the two stacks, and emits one geotech edge per aligned pair, plus
side-preserving restatements of the litho ties. Two rules are stated up front:
section membership is a REQUIRED input, so only ties whose both columns the
section actually draws are used (owner 2026-08-25); and approval follows ruling A
— an edge that RESTATES a litho tie is born accepted, every other pair is a
pending proposal — with the ``'auto'`` source stamp on all of them, so hand work
and machine work stay distinguishable whatever their approval state.

.. CG-EXPLANATION-END id=module-header

Class ``EdgeDerivationCounts`` — header
---------------------------------------

.. CG-BLOCK id=class:EdgeDerivationCounts lines=113-160

.. literalinclude:: ../../../src/groundmodel/application/geotech_edge_derivation.py
   :language: python
   :lines: 113-160
   :lineno-match:

.. CG-EXPLANATION-START id=class:EdgeDerivationCounts

**What this does.** A dataclass of per-pass counters: how many edges were emitted
(split into accepted and proposed), and a separate skip count for every reason a
candidate can be declined — no litho depth, no alignment found, an empty band
stack, an already-existing pair, a duplicate row, a crossing, a tombstoned
(engineer-deleted) tie, a repeat below a lens, or a class match whose extents do
not correspond.

**Why it is here.** These back the phase-summary log. The comments explain why
several counts are kept apart rather than lumped: "existing pair" is the
deliberately conservative pair-only suppression, while "duplicate row" is the
database's own unique constraint — every one of those would have been an error
before the fix; and "crossing" means "would have broken the fill on that gap", not
"already there". Each counter's comment cites the owner ruling behind it, so the
log can be read against the specification.

.. CG-EXPLANATION-END id=class:EdgeDerivationCounts

Method ``EdgeDerivationCounts``. ``def add``
--------------------------------------------

.. CG-BLOCK id=method:EdgeDerivationCounts.add lines=161-176

.. literalinclude:: ../../../src/groundmodel/application/geotech_edge_derivation.py
   :language: python
   :lines: 161-176
   :lineno-match:

.. CG-EXPLANATION-START id=method:EdgeDerivationCounts.add

**What this does.** Adds another pass's counters into this one, field by field.

**Why it is here.** A press derives edges section by section; this rolls the
per-section counts up into one total for the run's summary line.

.. CG-EXPLANATION-END id=method:EdgeDerivationCounts.add

Function ``async def load_project_sections``
--------------------------------------------

.. CG-BLOCK id=function:load_project_sections lines=177-205

.. literalinclude:: ../../../src/groundmodel/application/geotech_edge_derivation.py
   :language: python
   :lines: 177-205
   :lineno-match:

.. CG-EXPLANATION-START id=function:load_project_sections

**What this does.** Loads all of a project's cross-sections in a stable display
order.

**Why it is here.** The derivation runs per section, so the caller needs the
section list; ordering by display order then name makes two runs present the
sections the same way.

.. CG-EXPLANATION-END id=function:load_project_sections

Function ``async def load_litho_layer_depths``
----------------------------------------------

.. CG-BLOCK id=function:load_litho_layer_depths lines=206-249

.. literalinclude:: ../../../src/groundmodel/application/geotech_edge_derivation.py
   :language: python
   :lines: 206-249
   :lineno-match:

.. CG-EXPLANATION-START id=function:load_litho_layer_depths

**What this does.** Loads, for every accepted litho layer, which column it sits on
and its top and base depth, keyed by layer id.

**Why it is here.** This is the map every later step uses to answer "which column
is this tie endpoint on, and over what depth window does its litho unit run?" It
can be scoped to a set of investigations or loaded for the whole model.

.. CG-EXPLANATION-END id=function:load_litho_layer_depths

Class ``ApprovedLithoEdgeSets``
-------------------------------

.. CG-BLOCK id=class:ApprovedLithoEdgeSets lines=250-280

.. literalinclude:: ../../../src/groundmodel/application/geotech_edge_derivation.py
   :language: python
   :lines: 250-280
   :lineno-match:

.. CG-EXPLANATION-START id=class:ApprovedLithoEdgeSets

**What this does.** A frozen dataclass carrying a section's approved litho edges in
two forms — the canonical layer pairs (sides discarded, which drive the alignment)
and the full sided edges (each with both surfaces named) — plus the list of
columns filtered out because the section does not draw them.

**Why it is here.** The sided form is needed because a litho tie can be a
top-to-top band tie, a base-to-base bottom tie, OR a mixed top-to-base onlap
declaration, and each must restate onto the geotech bands owning the SAME
surfaces. A side-blind loader once silently rewrote a mixed tie as top-to-top — an
approval the engineer never gave (owner 2026-08-14, "litho consistency should be
100%"). The off-section list is carried so every caller can NAME the dropped
columns in its log rather than silently deriving less than the press before.

.. CG-EXPLANATION-END id=class:ApprovedLithoEdgeSets

Function ``async def load_approved_litho_edge_sets``
----------------------------------------------------

.. CG-BLOCK id=function:load_approved_litho_edge_sets lines=281-350

.. literalinclude:: ../../../src/groundmodel/application/geotech_edge_derivation.py
   :language: python
   :lines: 281-350
   :lineno-match:

.. CG-EXPLANATION-START id=function:load_approved_litho_edge_sets

**What this does.** Loads a section's approved litho edges and immediately filters
them to the columns the section actually draws, returning both the pair and sided
forms.

**Why it is here.** The membership filter is applied HERE, once, because all three
geotech writers read their input through this one function and none of them
resolved membership before — gating only one caller would leave the next press to
put the same tie back. Making the membership set a REQUIRED argument is the point:
a future caller cannot forget it (owner 2026-08-25, *"yeah make it section scoped
ofcourse"*).

.. CG-EXPLANATION-END id=function:load_approved_litho_edge_sets

Function ``def _restrict_litho_edges_to_section_members``
---------------------------------------------------------

.. CG-BLOCK id=function:_restrict_litho_edges_to_section_members lines=351-424

.. literalinclude:: ../../../src/groundmodel/application/geotech_edge_derivation.py
   :language: python
   :lines: 351-424
   :lineno-match:

.. CG-EXPLANATION-START id=function:_restrict_litho_edges_to_section_members

**What this does.** Keeps only the litho ties whose BOTH columns the section draws,
and records which off-section columns were dropped.

**Why it is here.** The litho edge table still holds rows written before the
projection filter gained its between-the-endpoints clamp (2026-08-03), when a
column in the corridor but past the end of the line counted as on-section. Without
this filter every such row is re-derived into a geotech proposal on a gap the
engineer cannot see, review or resolve. A tie with one off-section end is dropped
outright rather than bridged across — the column is not on this section, so there
is no gap here to walk, and manufacturing a jump from a distrusted row would invent
geometry. A layer absent from the depth map is *unplaceable* (not off-section) and
passes through untouched, so a diagnosed skip is never traded for a silent one.

.. CG-EXPLANATION-END id=function:_restrict_litho_edges_to_section_members

Function ``async def load_existing_geotech_sided_edges_by_section``
-------------------------------------------------------------------

.. CG-BLOCK id=function:load_existing_geotech_sided_edges_by_section lines=425-451

.. literalinclude:: ../../../src/groundmodel/application/geotech_edge_derivation.py
   :language: python
   :lines: 425-451
   :lineno-match:

.. CG-EXPLANATION-START id=function:load_existing_geotech_sided_edges_by_section

**What this does.** Loads the geotech edges already stored, with their two sides,
grouped by section.

**Why it is here.** Sided restatements dedup on the (pair, sides) identity, not the
pair alone, because a single-band litho unit legitimately carries its top, base and
mixed restatements on the same layer pair — the database unique constraint includes
the sides, so all those rows are legal. Preloading these lets a re-press add only
what is genuinely new.

.. CG-EXPLANATION-END id=function:load_existing_geotech_sided_edges_by_section

Function ``async def load_accepted_geotech_sided_edges_by_section``
-------------------------------------------------------------------

.. CG-BLOCK id=function:load_accepted_geotech_sided_edges_by_section lines=452-477

.. literalinclude:: ../../../src/groundmodel/application/geotech_edge_derivation.py
   :language: python
   :lines: 452-477
   :lineno-match:

.. CG-EXPLANATION-START id=function:load_accepted_geotech_sided_edges_by_section

**What this does.** The same load, but only the APPROVED edges.

**Why it is here.** It seeds the crossing guard, and a crossing is judged against
what actually paints: the renderer feeds the fill only approved edges, so a pending
proposal beside another pending proposal costs nothing until one of them is
accepted.

.. CG-EXPLANATION-END id=function:load_accepted_geotech_sided_edges_by_section

Function ``async def _sided_edges_by_section``
----------------------------------------------

.. CG-BLOCK id=function:_sided_edges_by_section lines=478-498

.. literalinclude:: ../../../src/groundmodel/application/geotech_edge_derivation.py
   :language: python
   :lines: 478-498
   :lineno-match:

.. CG-EXPLANATION-START id=function:_sided_edges_by_section

**What this does.** The shared body of the two loaders above — one query,
canonicalising each edge to (min, max) with its sides carried along, grouped by
section, optionally approved-only.

**Why it is here.** The two public loaders differ only by that one filter, so the
query lives once (extract on the second copy).

.. CG-EXPLANATION-END id=function:_sided_edges_by_section

Function ``async def load_existing_geotech_edge_pairs_by_section``
------------------------------------------------------------------

.. CG-BLOCK id=function:load_existing_geotech_edge_pairs_by_section lines=499-540

.. literalinclude:: ../../../src/groundmodel/application/geotech_edge_derivation.py
   :language: python
   :lines: 499-540
   :lineno-match:

.. CG-EXPLANATION-START id=function:load_existing_geotech_edge_pairs_by_section

**What this does.** Loads the already-stored geotech edge layer-pairs, grouped by
section.

**Why it is here.** Geotech edges are section-scoped, so the dedup must be too: the
same pair (A, B) may legitimately be one edge on section 1 and a distinct edge on
section 2, and a model-global dedup set would let section 1's edge silently
suppress section 2's — a missing band would render there. It preloads each
section's seen-pairs set so a second derivation pass never duplicates an edge the
first pass already emitted on the same section.

.. CG-EXPLANATION-END id=function:load_existing_geotech_edge_pairs_by_section

Function ``async def load_geotech_edges_for_supersession``
----------------------------------------------------------

.. CG-BLOCK id=function:load_geotech_edges_for_supersession lines=541-614

.. literalinclude:: ../../../src/groundmodel/application/geotech_edge_derivation.py
   :language: python
   :lines: 541-614
   :lineno-match:

.. CG-EXPLANATION-START id=function:load_geotech_edges_for_supersession

**What this does.** Loads one section's geotech edges in the shape the jump-tie
supersession needs — each edge's two bands and the column each band sits on.

**Why it is here.** The supersession rule (owner 2026-08-14) says a CPT-to-CPT tie
that jumps over a column is REPLACED by the mediated chain once "Divide boreholes"
fills the borehole between them. To judge that it needs the investigation each band
is on — the key the section's along-position map uses — and the span between the
two, which decides whether the tie jumps anything at all. It is section-scoped
because a chain on another section proves nothing here; an edge whose band vanished
mid-flight is skipped, since it cannot be judged and the foreign-key cascade is
already deleting it.

.. CG-EXPLANATION-END id=function:load_geotech_edges_for_supersession

Function ``def bridge_edges_over_bandless_columns``
---------------------------------------------------

.. CG-BLOCK id=function:bridge_edges_over_bandless_columns lines=615-664

.. literalinclude:: ../../../src/groundmodel/application/geotech_edge_derivation.py
   :language: python
   :lines: 615-664
   :lineno-match:

.. CG-EXPLANATION-START id=function:bridge_edges_over_bandless_columns

**What this does.** Adds the CPT-to-CPT litho pairs that skip over a column
carrying no packing bands, so a section drawn CPT–borehole–CPT proposes the CPT
pair the borehole sat between instead of proposing nothing.

**Why it is here.** It is a thin adapter over the pure bridging rule — it reshapes
the two indexes this module already builds into the rule's inputs (owner ruling
2026-08-04). The result is a superset of the approved edges, so nothing the
engineer approved is ever dropped.

.. CG-EXPLANATION-END id=function:bridge_edges_over_bandless_columns

Function ``def band_at_contact``
--------------------------------

.. CG-BLOCK id=function:band_at_contact lines=665-708

.. literalinclude:: ../../../src/groundmodel/application/geotech_edge_derivation.py
   :language: python
   :lines: 665-708
   :lineno-match:

.. CG-EXPLANATION-START id=function:band_at_contact

**What this does.** Given a column's band stack and a contact depth, returns which
band owns that contact and on which of its surfaces (top or base), or nothing when
the depth is not a contact on that column at all.

**Why it is here.** A tie names a CONTACT — a surface at a depth on a column — and
storing it as (layer, side) is lossy, because a single litho tie records its two
ends differently: one end names the band below the contact (side ``base``), the
other the band above it (side ``top``). The owner's words (2026-08-17): *"Can't
work in x,y,z space without using x,y,z coordinates."* Resolving by band identity
once tied a clay band to a sand band across a contact that is clay-over-sand on
both columns, and produced every crossing on his model. Resolving by depth returns
the band starting at the contact on BOTH columns. A mid-band depth is not a
surface, so it returns nothing rather than inventing one.

.. CG-EXPLANATION-END id=function:band_at_contact

Function ``async def derive_geotech_edges_from_litho``
------------------------------------------------------

.. CG-BLOCK id=function:derive_geotech_edges_from_litho lines=709-1474

.. literalinclude:: ../../../src/groundmodel/application/geotech_edge_derivation.py
   :language: python
   :lines: 709-1474
   :lineno-match:

.. CG-EXPLANATION-START id=function:derive_geotech_edges_from_litho

**What this does.** The heart of the module. For each approved litho edge it finds
the litho unit's depth window on each column, collects the packing sub-bands inside
it, aligns the two stacks, and writes one geotech edge per aligned pair — plus
side-preserving restatements of every non-top-to-top litho tie, and pending
"interior body" proposals for the big same-class bodies the alignment skipped over.
Before it writes any edge it runs three internal gates: a tombstone gate (a tie the
engineer deleted stays deleted, matched by place because band ids die at every
rebuild), a crossing gate (a tie that would cross a tie already standing in the same
gap is refused — a crossing is a hard conflict that breaks the fill there), and a
row-identity gate. It returns the per-reason counts.

**Why it is here.** Nearly every tie ruling in the geotech-stage design note
converges here. A DIRECT litho pair that carries a top-to-top tie FORCES the
topmost band pair regardless of class (owner 2026-08-13 — the tops own the very
surfaces the engineer tied), while a longest-common-subsequence match — the deepest
run of same-class bands that keeps their order — aligns the rest; a bridged jump
pair uses the plain class match, and the litho ties it chains are carried
"packing-agnostic" by the contact walk, so a cross-class chained contact no longer
vanishes. Approval follows ruling A: a restatement of a direct top-to-top litho tie
is born accepted, everything else pending — UNLESS ``born_accepted`` is set, which
only "4 · Divide boreholes" does, because the hops it writes re-express, through the
borehole it has just divided, correlations the engineer already drew, so asking him
to re-accept them would turn one press into press-accept-press. Two dedup sets are
load-bearing and answer different questions: the pair-only set is deliberately
conservative (an existing tie suppresses a top-to-top proposal), while the
row-identity set is the exact (pair, sides) tuple the database's unique constraint
enforces — and when the second arrival at one contact is the engineer's own
restatement, it PROMOTES the standing proposal to accepted so iteration order can
never demote his work. Below-lens repeats, disjoint-extent class matches, and
skeleton (class-less) bands are each withheld, per a cited owner ruling. The whole
section's edges are flushed once at the end so they land together.

.. CG-EXPLANATION-END id=function:derive_geotech_edges_from_litho

