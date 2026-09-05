groundmodel.application.geotech_band_edit_helpers
=================================================

.. CG-PAGE source=src/groundmodel/application/geotech_band_edit_helpers.py complete=true

*Source file:* ``src/groundmodel/application/geotech_band_edit_helpers.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-70

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 1-70
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the shared module for hand-editing packing bands
(split, merge, move): the loader that reads one column's state, and the rules
that decide what happens to that column's correlation edges. The read-only
preview and both commit use cases pull from here.

**Why it is here.** The preview and the two commits read the SAME column state
and apply the SAME edge rule, so it lives once rather than three times (extract
on the second copy). Column scoping is the owner's ruling 4 ("recalculation is
local") expressed in code: the loader filters every query by the edited band's
own anchor, so no other column can be read — and therefore none re-derived — by a
hand edit. That same anchor decides whether the gesture is allowed at all (ruling
A: a band on a borehole has no cone resistance, so both gestures are refused
there). Locking is deliberately NOT taken here — the docstring explains the
calling use case takes the body-partition advisory lock once before its own first
write, and the read-only preview shares this loader, so a lock at this depth would
either guard nothing or stall a live drag behind an in-flight body recompute.

.. CG-EXPLANATION-END id=module-header

Class ``GeotechColumnContext``
------------------------------

.. CG-BLOCK id=class:GeotechColumnContext lines=71-138

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 71-138
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeotechColumnContext

**What this does.** A frozen dataclass carrying everything a hand edit needs about
ONE column: the project, model and investigation ids, whether the anchor is a CPT,
the accepted bands and their database rows, the parent litho unit's soil and
admixtures, the CPT depth-and-qc series, the minimum thickness, the qc statistic,
the litho and geological parents, and the LIVE geological contacts.

**Why it is here.** It is the single loaded state the preview and both commits
share. The statistic is read from the model itself, so a hand edit and its preview
can never disagree with the build (ruling 6). The live geological contacts are
carried because a band's build-time geological stamp goes stale the moment the
engineer moves a geological contact on its own axis, and a stale stamp once walled
his merges forever (dogfeed 2026-08-12); where the live list exists it is
authoritative.

.. CG-EXPLANATION-END id=class:GeotechColumnContext

Function ``def pre_edit_class_snapshot``
----------------------------------------

.. CG-BLOCK id=function:pre_edit_class_snapshot lines=139-158

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 139-158
   :lineno-match:

.. CG-EXPLANATION-START id=function:pre_edit_class_snapshot

**What this does.** Returns the column's pre-edit map of band id to NAD class,
taken from the already-loaded context.

**Why it is here.** Every band-edit verb hands the edge revalidation the same
pre-edit baseline; taking it from the loaded bands avoids four copies of the same
comprehension. It is the transition baseline that keeps a born-cross-class
restatement from being flagged the first time any band on its column is touched.

.. CG-EXPLANATION-END id=function:pre_edit_class_snapshot

Class ``GeotechBandEditResult``
-------------------------------

.. CG-BLOCK id=class:GeotechBandEditResult lines=159-207

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 159-207
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeotechBandEditResult

**What this does.** A frozen dataclass describing the outcome of a committed split
or merge: the model and column, the realised plan, the resulting, created and
deleted band rows, and several edge lists — every edge deleted, the subset the
engineer had accepted, the flagged ties, and the ties whose flag self-healed.

**Why it is here.** The deleted-accepted subset is reported apart from the rest
because the two mean opposite things to the engineer: a withdrawn proposal is the
machine changing its mind, while a deleted accepted tie is his own correlation
going away, and the interface must never describe one as the other (flag-not-drop).
The plan is returned so the interface can show the realised consequence without a
second round-trip.

.. CG-EXPLANATION-END id=class:GeotechBandEditResult

Class ``EdgeRef`` — header
--------------------------

.. CG-BLOCK id=class:EdgeRef lines=208-248

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 208-248
   :lineno-match:

.. CG-EXPLANATION-START id=class:EdgeRef

**What this does.** A frozen dataclass reducing a correlation edge to what the
review rules need: the row, its section, its two endpoints and their two sides,
whether it is approved, and its review flag.

**Why it is here.** The section and the sides are part of the tie's identity, not
decoration — the database uniqueness triple leads with the section and includes
both sides, so the same two bands legitimately carry one tie per section and a
top-to-top tie alongside a base-to-base tie. ``user_approved`` and the sides are
deliberately NOT given defaults, so a loader that forgot to select them fails
loudly rather than silently treating accepted work as droppable machine claims.

.. CG-EXPLANATION-END id=class:EdgeRef

Method ``EdgeRef``. ``def side_of``
-----------------------------------

.. CG-BLOCK id=method:EdgeRef.side_of lines=249-252

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 249-252
   :lineno-match:

.. CG-EXPLANATION-START id=method:EdgeRef.side_of

**What this does.** Returns which surface (top or base) of a given endpoint this
tie joins.

**Why it is here.** A small convenience so the transfer and review rules read
either endpoint's side without repeating the a/b check.

.. CG-EXPLANATION-END id=method:EdgeRef.side_of

Method ``EdgeRef``. ``def partner_side``
----------------------------------------

.. CG-BLOCK id=method:EdgeRef.partner_side lines=253-256

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 253-256
   :lineno-match:

.. CG-EXPLANATION-START id=method:EdgeRef.partner_side

**What this does.** Returns the side of the OTHER endpoint.

**Why it is here.** When an anchor band moves, the partner's side must stay put;
this reads it so the move can keep it fixed.

.. CG-EXPLANATION-END id=method:EdgeRef.partner_side

Method ``EdgeRef``. ``def partner_of``
--------------------------------------

.. CG-BLOCK id=method:EdgeRef.partner_of lines=257-261

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 257-261
   :lineno-match:

.. CG-EXPLANATION-START id=method:EdgeRef.partner_of

**What this does.** Returns the endpoint that is not the given one.

**Why it is here.** The transfer walks from the absorbed band to its partner; this
names the partner.

.. CG-EXPLANATION-END id=method:EdgeRef.partner_of

Function ``def require_cpt_anchor``
-----------------------------------

.. CG-BLOCK id=function:require_cpt_anchor lines=262-307

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 262-307
   :lineno-match:

.. CG-EXPLANATION-START id=function:require_cpt_anchor

**What this does.** Refuses a hand edit whose band hangs off a borehole, raising an
error that names the cause and the way around it.

**Why it is here.** Ruling A (2026-08-01): a borehole records no cone resistance,
and every rule below this one assumes there is qc to re-derive a class from.
Letting the gesture through would replace the class "divide boreholes" extrapolated
from the surrounding CPTs with a class-less skeleton — destroying information rather
than changing it. The test is the BAND's own anchor — a database-enforced XOR, CPT
or borehole, never both — not the column's neighbourhood, so a borehole standing
near a CPT is still a borehole. It refuses here, not only in the interface, so the
API cannot be driven around the gesture surface; and both the preview and the
commits call it, so a preview never says yes to an edit the commit refuses.

.. CG-EXPLANATION-END id=function:require_cpt_anchor

Class ``EdgeActions``
---------------------

.. CG-BLOCK id=class:EdgeActions lines=308-334

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 308-334
   :lineno-match:

.. CG-EXPLANATION-START id=class:EdgeActions

**What this does.** A frozen dataclass listing what a class re-derivation does to
the affected edges: pending mismatches to delete, accepted mismatches to flag
``class_changed``, and restored matches to clear.

**Why it is here.** It encodes flag-not-drop: a pending proposal may be withdrawn
(the build will regenerate it), but an accepted tie is never deleted by a machine
decision — it is flagged for the engineer to confirm or delete (owner ruling
2026-08-07). Only ``class_changed`` clears on a restored match; ``ambiguous_band``
names an anchor-identity doubt a class match does not resolve.

.. CG-EXPLANATION-END id=class:EdgeActions

Function ``def edge_review_actions``
------------------------------------

.. CG-BLOCK id=function:edge_review_actions lines=335-414

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 335-414
   :lineno-match:

.. CG-EXPLANATION-START id=function:edge_review_actions

**What this does.** The pure rule that judges each edge against the re-derived
classes and sorts it into delete, flag or clear.

**Why it is here.** Ruling 4 said a connection breaks when the new classes no
longer match; the 2026-08-07 refinement says HOW it breaks depends on who made it
(a pending machine claim is withdrawn, an accepted tie is flagged for the
engineer's own judgement), and the 2026-08-13 refinement flags an accepted tie ONLY
when the edit BROKE a match — a tie whose ends were already mismatched was never a
class claim, so flagging it would bury every cross-class restatement in violet
badges the first time any band is touched. An already-flagged tie is left with the
flag it has, so a later self-heal cannot clear a review the engineer never gave. It
is pure — no session — so the rule is testable on its own.

.. CG-EXPLANATION-END id=function:edge_review_actions

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=415-425

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 415-425
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** Defines ``DEPTH_DECIMALS = 3`` — the millimetre precision every
persisted band depth is rounded to.

**Why it is here.** The database's no-overlap constraint compares depths rounded to
three decimals, so a write at finer precision could slip past the check that keeps
a column gap-free. Every band-edit verb rounds through this one value, because
three copies of the same ``3`` is three chances for one of them to drift.

.. CG-EXPLANATION-END id=module-statements

Function ``def tie_key``
------------------------

.. CG-BLOCK id=function:tie_key lines=426-462

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 426-462
   :lineno-match:

.. CG-EXPLANATION-START id=function:tie_key

**What this does.** Builds the canonical identity of a tie — the section, both
endpoints ordered by id, and both surfaces travelling with their own endpoints.

**Why it is here.** It mirrors the database uniqueness triple exactly, and every
element earns its place. Dropping the surfaces would read a base-to-base tie as a
duplicate of a top-to-top tie between the same bands; dropping the section would
read a tie drawn on one cross-section as a duplicate of one drawn on another — two
ribbons the engineer drew separately, on drawings he views separately — and the
transfer would delete one of them for a collision the database would never have
raised.

.. CG-EXPLANATION-END id=function:tie_key

Class ``ExistingTie``
---------------------

.. CG-BLOCK id=class:ExistingTie lines=463-479

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 463-479
   :lineno-match:

.. CG-EXPLANATION-START id=class:ExistingTie

**What this does.** A frozen dataclass for a tie the survivor already carries: its
row and whether it is approved.

**Why it is here.** When a transferred tie lands on an occupied slot, the approved
flag decides who wins — an accepted occupant makes the incoming tie a true
duplicate (dropped), a pending occupant is displaced (accepted work outranks a
proposal).

.. CG-EXPLANATION-END id=class:ExistingTie

Class ``TransferMove``
----------------------

.. CG-BLOCK id=class:TransferMove lines=480-506

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 480-506
   :lineno-match:

.. CG-EXPLANATION-START id=class:TransferMove

**What this does.** A frozen dataclass for one accepted tie re-anchored from an
absorbed band onto the survivor: the row, its new canonical endpoints, whether the
sides must swap, and which review flag it carries.

**Why it is here.** The two sides must swap when the moved endpoint changes ends,
so each side stays paired with its own endpoint. The review flag is
``class_changed`` when the survivor's class breaks the match, otherwise
``band_absorbed`` — the anchor band was absorbed, but the class match still holds.

.. CG-EXPLANATION-END id=class:TransferMove

Class ``EdgeTransferPlan``
--------------------------

.. CG-BLOCK id=class:EdgeTransferPlan lines=507-533

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 507-533
   :lineno-match:

.. CG-EXPLANATION-START id=class:EdgeTransferPlan

**What this does.** A frozen dataclass with three lists: the accepted ties
re-anchored onto the survivor, the accepted ties that cannot transfer (a self-loop
or a duplicate), and the pending ties on the survivor displaced to make room.

**Why it is here.** A duplicate is the same tie, not lost work, so it and a
self-loop are both deleted and counted; the absorbed band's own pending edges are
in none of the lists, because the row delete's foreign-key cascade takes them
(correct for a machine claim). The displaced list applies flag-not-drop to the
collision itself — the engineer's tie wins the slot and the machine proposal is
withdrawn — and those are deleted BEFORE the moves are written, so the re-point
never races the uniqueness constraint.

.. CG-EXPLANATION-END id=class:EdgeTransferPlan

Function ``def plan_edge_transfer``
-----------------------------------

.. CG-BLOCK id=function:plan_edge_transfer lines=534-640

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 534-640
   :lineno-match:

.. CG-EXPLANATION-START id=function:plan_edge_transfer

**What this does.** The pure decision for every edge on a band about to be
absorbed: skip a pending edge (the cascade takes it), drop a self-loop or a
duplicate, displace a pending occupant of the target slot, and re-anchor each
accepted tie onto the survivor with the right sides and review flag.

**Why it is here.** Before 2026-08-07 the absorbed row's cascade silently deleted
its accepted ties; the owner's ruling closes that — accepted work is re-anchored
onto the survivor and flagged, never silently destroyed. It applies the transition
rule: ``class_changed`` only when the transfer BROKE a match; a tie already
cross-class on the absorbed band (a restatement carries the litho approval, not a
class claim) transfers as the plain ``band_absorbed``. It is pure — the I/O wrapper
applies the plan.

.. CG-EXPLANATION-END id=function:plan_edge_transfer

Function ``async def load_geotech_column_context``
--------------------------------------------------

.. CG-BLOCK id=function:load_geotech_column_context lines=641-809

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 641-809
   :lineno-match:

.. CG-EXPLANATION-START id=function:load_geotech_column_context

**What this does.** Loads the edited band's whole column and nothing beyond it: the
accepted bands and their formations, the parent litho unit's soil and admixtures,
the CPT depth-and-qc series, the minimum thickness, the model's statistic, the
litho and geological parents, and the live geological contacts. It raises when the
band is missing, belongs to another model, or has no anchor.

**Why it is here.** It reads ONLY the edited band's anchor's rows — ruling 4
("recalculation is local") enforced at the query, not by downstream convention, so
no other column can be read or re-derived by a hand edit. The soil code is narrowed
to the closed base-soil set here, so an unrecognised token becomes "cannot answer"
downstream rather than reaching the classifier and raising. The minimum thickness
and the statistic are read through the shared helper and the model, so the preview
warns against the same numbers the build enforces. The two-hop geological-contact
load (geotech to litho to geological model) supplies the LIVE contacts the planners
judge, never the bands' stale build-time stamps.

.. CG-EXPLANATION-END id=function:load_geotech_column_context

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements~2 lines=810-819

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 810-819
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements~2

**What this does.** Defines ``_GEO_COINCIDENT_M`` — the 1.1 mm allowance within
which a geological contact depth and a band depth count as equal.

**Why it is here.** Band depths are millimetre-rounded while geological contacts
keep full floats, so one physical boundary is recorded at two precisions; this
reconciles them, mirroring the same constant in the contact-move writer and in the
renderer.

.. CG-EXPLANATION-END id=module-statements~2

Function ``def live_geo_formation_id_at``
-----------------------------------------

.. CG-BLOCK id=function:live_geo_formation_id_at lines=820-850

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 820-850
   :lineno-match:

.. CG-EXPLANATION-START id=function:live_geo_formation_id_at

**What this does.** Returns the geological formation containing a given depth — the
deepest live contact at or above that depth, within the coincidence allowance — or
nothing above the first contact.

**Why it is here.** It reads the LIVE contacts, not the stored stamp, so a band's
geological label follows the geology as it stands now. ``None`` means the open
shallow band, the same meaning the build gives an unstamped band.

.. CG-EXPLANATION-END id=function:live_geo_formation_id_at

Function ``def geo_parent_for_interval``
----------------------------------------

.. CG-BLOCK id=function:geo_parent_for_interval lines=851-894

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 851-894
   :lineno-match:

.. CG-EXPLANATION-START id=function:geo_parent_for_interval

**What this does.** Returns the geological parent a written band should carry:
from the live contacts when they exist (by the interval's midpoint), else the
build-time stamp.

**Why it is here.** Every band-edit writer calls this, so a hand edit heals a stale
stamp on touch instead of copying it forward. A band may STRADDLE a geological
contact since the owner dropped the geological wall (2026-08-26), so the parent is
taken by thickness-weighted majority — the formation containing the midpoint (the
A2 precedent), an exact tie resolving downward because a geological contact is a top
and the deeper unit owns the ground from its top down. It is the same rule the
build applies, so a hand edit and a re-subdivide cannot label one band differently.

.. CG-EXPLANATION-END id=function:geo_parent_for_interval

Function ``def _parse_admixtures``
----------------------------------

.. CG-BLOCK id=function:_parse_admixtures lines=895-921

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 895-921
   :lineno-match:

.. CG-EXPLANATION-START id=function:_parse_admixtures

**What this does.** Parses a formation's stored admixture JSON into domain
admixture value objects.

**Why it is here.** The classifier needs the parent unit's admixtures to pick the
clean versus secondary NAD column; the formation carries them copied from its litho
source, so no extra round-trip to the litho row is needed.

.. CG-EXPLANATION-END id=function:_parse_admixtures

Function ``async def load_edges_for_layers``
--------------------------------------------

.. CG-BLOCK id=function:load_edges_for_layers lines=922-976

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 922-976
   :lineno-match:

.. CG-EXPLANATION-START id=function:load_edges_for_layers

**What this does.** Loads every correlation edge with an endpoint on one of the
given layers, reduced to the ``EdgeRef`` shape.

**Why it is here.** The revalidation needs every edge touching an edited band;
scoping the query by model keeps it to the geotech model.

.. CG-EXPLANATION-END id=function:load_edges_for_layers

Function ``async def load_nad_class_by_layer``
----------------------------------------------

.. CG-BLOCK id=function:load_nad_class_by_layer lines=977-1006

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 977-1006
   :lineno-match:

.. CG-EXPLANATION-START id=function:load_nad_class_by_layer

**What this does.** Returns the current NAD class of each given layer, via its
formation.

**Why it is here.** The class lives on the formation, not on the layer row, so the
join is needed; it reads the partner classes the review rule compares an edited
band against.

.. CG-EXPLANATION-END id=function:load_nad_class_by_layer

Function ``async def flag_edges``
---------------------------------

.. CG-BLOCK id=function:flag_edges lines=1007-1033

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 1007-1033
   :lineno-match:

.. CG-EXPLANATION-START id=function:flag_edges

**What this does.** Stamps a review reason on the given edges (does nothing for an
empty list).

**Why it is here.** This is how flag-not-drop persists a flag so it survives the
session that raised it; the caller commits.

.. CG-EXPLANATION-END id=function:flag_edges

Function ``async def clear_edge_flags``
---------------------------------------

.. CG-BLOCK id=function:clear_edge_flags lines=1034-1067

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 1034-1067
   :lineno-match:

.. CG-EXPLANATION-START id=function:clear_edge_flags

**What this does.** Clears the review flag on the given edges, but ONLY where it
currently equals the given reason.

**Why it is here.** The reason filter keeps the clear precise: a class-match
self-heal must never wipe a concurrent flag of a different kind (an
``ambiguous_band`` doubt a restored class match does not answer).

.. CG-EXPLANATION-END id=function:clear_edge_flags

Class ``EdgeRevalidation``
--------------------------

.. CG-BLOCK id=class:EdgeRevalidation lines=1068-1086

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 1068-1086
   :lineno-match:

.. CG-EXPLANATION-START id=class:EdgeRevalidation

**What this does.** A frozen dataclass reporting what one commit's edge
revalidation did: the pending mismatches withdrawn, the accepted mismatches flagged
``class_changed``, and the restored matches whose flag self-healed.

**Why it is here.** So the commit can report each of the three sets to the interface
distinctly.

.. CG-EXPLANATION-END id=class:EdgeRevalidation

Function ``async def revalidate_layer_edges``
---------------------------------------------

.. CG-BLOCK id=function:revalidate_layer_edges lines=1087-1150

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 1087-1150
   :lineno-match:

.. CG-EXPLANATION-START id=function:revalidate_layer_edges

**What this does.** The one revalidation driver every band-edit commit calls: load
the edges touching the edited rows, read the partner classes, run the pure rule, and
apply the deletes, flags and clears.

**Why it is here.** It was hoisted from byte-identical copies that lived in the
split and merge use cases (extract on the second copy — the move and the N-run merge
are callers three and four), and switched from drop-on-mismatch to flag-not-drop on
the way (owner 2026-08-07). It threads the pre-edit baseline through, so a
born-cross-class restatement stays unbadged.

.. CG-EXPLANATION-END id=function:revalidate_layer_edges

Function ``async def transfer_accepted_edges``
----------------------------------------------

.. CG-BLOCK id=function:transfer_accepted_edges lines=1151-1282

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 1151-1282
   :lineno-match:

.. CG-EXPLANATION-START id=function:transfer_accepted_edges

**What this does.** The I/O wrapper that re-anchors an absorbed band's accepted ties
onto the survivor: load the absorbed band's edges and the survivor's existing ties,
run the pure transfer plan, delete the displaced pending occupants first, re-point
and re-flag the moves, then delete the drops.

**Why it is here.** It runs BEFORE the absorbed row is deleted, because the cascade
would otherwise silently destroy accepted work — exactly what the owner's 2026-08-07
ruling forbids; pending edges are deliberately left for the cascade. It keys the
survivor's existing ties by the full, section-included identity, because an earlier
version treated any same-pair edge anywhere in the model as a duplicate and deleted
ties drawn on OTHER sections. The displaced proposals are deleted and flushed before
the re-points, so the write never races the uniqueness constraint.

.. CG-EXPLANATION-END id=function:transfer_accepted_edges

Function ``async def delete_edges``
-----------------------------------

.. CG-BLOCK id=function:delete_edges lines=1283-1307

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 1283-1307
   :lineno-match:

.. CG-EXPLANATION-START id=function:delete_edges

**What this does.** Deletes correlation edges by id (does nothing for an empty
list).

**Why it is here.** The shared deletion used by the revalidation and transfer paths;
the caller commits.

.. CG-EXPLANATION-END id=function:delete_edges

Function ``async def formation_for_class``
------------------------------------------

.. CG-BLOCK id=function:formation_for_class lines=1308-1348

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_helpers.py
   :language: python
   :lines: 1308-1348
   :lineno-match:

.. CG-EXPLANATION-START id=function:formation_for_class

**What this does.** Finds or creates the geotech formation carrying a re-derived
class, by delegating to the build's own find-or-create on the materialiser.

**Why it is here.** Reusing the build's find-or-create means a hand edit lands on
the SAME formation row the build would have produced for that class and parentage —
there is no parallel vocabulary of hand-made formations. It passes fresh empty
caches because a single hand edit does not batch several bands.

.. CG-EXPLANATION-END id=function:formation_for_class

