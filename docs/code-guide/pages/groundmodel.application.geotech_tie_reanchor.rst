groundmodel.application.geotech_tie_reanchor
============================================

.. CG-PAGE source=src/groundmodel/application/geotech_tie_reanchor.py complete=true

*Source file:* ``src/groundmodel/application/geotech_tie_reanchor.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-130

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 1-130
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the module that carries accepted geotech ties across a
re-subdivide, and defines the tokens for why a tie was lost, why a carried tie
needs review, and which kind of column an endpoint sits on.

**Why it is here.** The docstring lays out the whole problem. A correlation edge
stores two band ROW IDS, not "the dense sand at 3 m joins the dense sand at 3 m".
A re-subdivide throws every band away and rebuilds it with a fresh id, and both
endpoint links are ``ON DELETE CASCADE``, so the database removes the edge as a
silent side effect of the layer wipe — it never passes through application code,
so no ``WHERE`` clause can spare it. The fix is to CAPTURE the accepted ties
before the wipe and re-anchor them after, matched by a three-tier rule: same
column, same depth interval, same class (the band came back untouched — carried
clean); failing that, the single same-class band overlapping where the old band
was (a dragged boundary — carried clean); failing that, whichever band covers most
of the old spot (carried, but FLAGGED for the engineer to confirm or delete). Tier
2 was added after tier 1 alone dropped 13 accepted ties; tier 3 because the owner
ruled *"i don't want accepted edges to just disappear without any user explicitly
deleting it."* Depths are compared in whole millimetres — the grain the database
itself stores intervals at, not a geological tolerance. Only accepted ties are
carried: an unaccepted tie is "dirty" and regenerating it is the whole point of a
build.

.. CG-EXPLANATION-END id=module-header

Function ``def depth_to_mm``
----------------------------

.. CG-BLOCK id=function:depth_to_mm lines=131-153

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 131-153
   :lineno-match:

.. CG-EXPLANATION-START id=function:depth_to_mm

**What this does.** Converts a stored depth in metres to whole millimetres.

**Why it is here.** Millimetres are the finest grain the database distinguishes
intervals at — its no-overlap constraint rounds depths to three decimals — so
keying on millimetres compares intervals exactly the way the database stores them.
The docstring stresses this is NOT a tolerance: a centimetre difference still reads
as a different interval.

.. CG-EXPLANATION-END id=function:depth_to_mm

Class ``BandIdentity``
----------------------

.. CG-BLOCK id=class:BandIdentity lines=154-183

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 154-183
   :lineno-match:

.. CG-EXPLANATION-START id=class:BandIdentity

**What this does.** A frozen dataclass holding the owner's three-part identity of a
packing band: which column it sits on, its top and base in millimetres, and its
NAD class. Two bands are the same band only when all three match.

**Why it is here.** This is the exact identity the tier-1 match keys on. A class of
``None`` — a skeleton band, no qc resolved — matches only another ``None``: under
the exact rule ``None`` is a class value like any other.

.. CG-EXPLANATION-END id=class:BandIdentity

Class ``CapturedTie``
---------------------

.. CG-BLOCK id=class:CapturedTie lines=184-224

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 184-224
   :lineno-match:

.. CG-EXPLANATION-START id=class:CapturedTie

**What this does.** A frozen dataclass recording one accepted tie before the reset
destroys its endpoints — the old edge id (for logging), the section, the two sides,
the provenance token, both bands' three-part identities, and each end's anchor kind.

**Why it is here.** The endpoints must be read BEFORE the wipe, because afterwards
the band rows are gone and their column, depth and class can no longer be read.
Provenance is kept verbatim so a hand-made tie still reads ``manual`` when it is
re-created.

.. CG-EXPLANATION-END id=class:CapturedTie

Class ``RebuiltBand``
---------------------

.. CG-BLOCK id=class:RebuiltBand lines=225-240

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 225-240
   :lineno-match:

.. CG-EXPLANATION-START id=class:RebuiltBand

**What this does.** A frozen dataclass pairing a freshly-materialised band's
three-part identity with its new layer id.

**Why it is here.** This is what a captured tie is matched against; the new layer id
is what an accepted tie is re-pointed at.

.. CG-EXPLANATION-END id=class:RebuiltBand

Function ``def rebuilt_bands_from_layer_index``
-----------------------------------------------

.. CG-BLOCK id=function:rebuilt_bands_from_layer_index lines=241-280

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 241-280
   :lineno-match:

.. CG-EXPLANATION-START id=function:rebuilt_bands_from_layer_index

**What this does.** Turns a rebuild's per-column band index into the list of
``RebuiltBand`` descriptions the re-anchor matches against.

**Why it is here.** Both rebuilds accumulate their new bands in the same index (the
one they also hand to the edge derivation), and this reads only positions 0, 1, 2
and 4 of each entry, so the one helper serves both presses and any extra trailing
element (DivideBoreholes carries a sixth, the resolver's body id) rides along
harmlessly.

.. CG-EXPLANATION-END id=function:rebuilt_bands_from_layer_index

Class ``MatchedTie``
--------------------

.. CG-BLOCK id=class:MatchedTie lines=281-304

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 281-304
   :lineno-match:

.. CG-EXPLANATION-START id=class:MatchedTie

**What this does.** A frozen dataclass pairing a captured tie with the two new layer
ids it will be re-created against, plus an optional review reason.

**Why it is here.** The review reason is ``None`` when both endpoints resolved
cleanly (tiers 1 and 2); otherwise it is the token telling the engineer to confirm
the tie.

.. CG-EXPLANATION-END id=class:MatchedTie

Class ``LostTie`` — header
--------------------------

.. CG-BLOCK id=class:LostTie lines=305-322

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 305-322
   :lineno-match:

.. CG-EXPLANATION-START id=class:LostTie

**What this does.** A frozen dataclass for an accepted tie that could not be
re-anchored, carrying the tie and a per-endpoint reason.

**Why it is here.** A tie is lost only when an endpoint found no band at all; the
two reasons are kept separate because the two endpoints can fail for different
reasons.

.. CG-EXPLANATION-END id=class:LostTie

Method ``LostTie``. ``def reasons``
-----------------------------------

.. CG-BLOCK id=method:LostTie.reasons lines=323-330

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 323-330
   :lineno-match:

.. CG-EXPLANATION-START id=method:LostTie.reasons

**What this does.** Returns the distinct loss reasons this tie carries, in endpoint
order.

**Why it is here.** For the per-reason tally, dropping the duplicate when both ends
failed the same way.

.. CG-EXPLANATION-END id=method:LostTie.reasons

Method ``LostTie``. ``def describe``
------------------------------------

.. CG-BLOCK id=method:LostTie.describe lines=331-340

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 331-340
   :lineno-match:

.. CG-EXPLANATION-START id=method:LostTie.describe

**What this does.** Builds a one-line description naming both endpoints and each
one's verdict.

**Why it is here.** For the WARNING line logged when a tie is lost.

.. CG-EXPLANATION-END id=method:LostTie.describe

Method ``LostTie``. ``def edge_id_str``
---------------------------------------

.. CG-BLOCK id=method:LostTie.edge_id_str lines=341-346

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 341-346
   :lineno-match:

.. CG-EXPLANATION-START id=method:LostTie.edge_id_str

**What this does.** Returns the original edge id as a string.

**Why it is here.** A small convenience for the log lines — the whole id is shown,
never a truncated one (the never-trust-a-truncated-UUID lesson).

.. CG-EXPLANATION-END id=method:LostTie.edge_id_str

Class ``ReanchorPlan`` — header
-------------------------------

.. CG-BLOCK id=class:ReanchorPlan lines=347-379

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 347-379
   :lineno-match:

.. CG-EXPLANATION-START id=class:ReanchorPlan

**What this does.** A dataclass holding the outcome of matching: the matched ties
(with their new ids and review flags), the lost ties, a count of matched ties
dropped as duplicates, and human-readable labels for the lost ones.

**Why it is here.** The duplicate count is the database's uniqueness made visible
instead of raised. The lost-tie labels exist because a bare count is not
actionable: telling the engineer "3 accepted ties could not be kept" without saying
WHICH three leaves the ids only in a renderer console a packaged build does not show
(audit 2026-08-02), so the labels name both columns and both depths.

.. CG-EXPLANATION-END id=class:ReanchorPlan

Method ``ReanchorPlan``. ``def review_reason_counts``
-----------------------------------------------------

.. CG-BLOCK id=method:ReanchorPlan.review_reason_counts lines=380-393

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 380-393
   :lineno-match:

.. CG-EXPLANATION-START id=method:ReanchorPlan.review_reason_counts

**What this does.** Counts the carried ties per review reason, ignoring the clean
ones.

**Why it is here.** Feeds the "N ties need review" warning.

.. CG-EXPLANATION-END id=method:ReanchorPlan.review_reason_counts

Method ``ReanchorPlan``. ``def loss_reason_counts``
---------------------------------------------------

.. CG-BLOCK id=method:ReanchorPlan.loss_reason_counts lines=394-412

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 394-412
   :lineno-match:

.. CG-EXPLANATION-START id=method:ReanchorPlan.loss_reason_counts

**What this does.** Counts the lost ties per reason, counting a tie once under each
reason when its two ends failed differently.

**Why it is here.** The reasons mean different things — a class change, a moved
interval, an absent band — and each is worth seeing.

.. CG-EXPLANATION-END id=method:ReanchorPlan.loss_reason_counts

Function ``def _describe_identity``
-----------------------------------

.. CG-BLOCK id=function:_describe_identity lines=413-421

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 413-421
   :lineno-match:

.. CG-EXPLANATION-START id=function:_describe_identity

**What this does.** Renders a band identity (column, depth range, class) for a log
line.

**Why it is here.** Shared formatting for the developer-facing log.

.. CG-EXPLANATION-END id=function:_describe_identity

Function ``def _label_endpoint``
--------------------------------

.. CG-BLOCK id=function:_label_endpoint lines=422-444

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 422-444
   :lineno-match:

.. CG-EXPLANATION-START id=function:_label_endpoint

**What this does.** Renders one endpoint for the ENGINEER — the investigation's
name plus its depth range — falling back to the raw id when the investigation row
is gone.

**Why it is here.** The engineer needs a readable name, not an id; and a *truncated*
id would be worse than useless, so the whole one is shown (the
never-trust-a-truncated-UUID lesson).

.. CG-EXPLANATION-END id=function:_label_endpoint

Function ``def label_lost_ties``
--------------------------------

.. CG-BLOCK id=function:label_lost_ties lines=445-467

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 445-467
   :lineno-match:

.. CG-EXPLANATION-START id=function:label_lost_ties

**What this does.** Names every lost tie as "column depths to column depths", in
the order they were captured.

**Why it is here.** This is what turns the lost-tie count into something the
engineer can actually find on the section.

.. CG-EXPLANATION-END id=function:label_lost_ties

Function ``def _endpoint_reason``
---------------------------------

.. CG-BLOCK id=function:_endpoint_reason lines=468-532

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 468-532
   :lineno-match:

.. CG-EXPLANATION-START id=function:_endpoint_reason

**What this does.** Diagnoses why an endpoint's band could not be found, once the
exact three-part lookup has missed: a borehole with no band yet (deferred) or
permanently absent, the same interval with a different class (class changed), an
overlapping but differently-bounded band (interval moved), or nothing there at all
(band absent).

**Why it is here.** The reasons drive different messages. A borehole with no band is
a SCHEDULE fact, not lost geology — "subdivide all bodies" fills CPT bands only, and
"divide boreholes" fills the borehole columns afterwards — so it is reported as
deferred UNLESS the caller says the borehole bands are final, which only "divide
boreholes" does, because it IS that later step.

.. CG-EXPLANATION-END id=function:_endpoint_reason

Function ``def overlap_mm``
---------------------------

.. CG-BLOCK id=function:overlap_mm lines=533-557

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 533-557
   :lineno-match:

.. CG-EXPLANATION-START id=function:overlap_mm

**What this does.** Returns how many millimetres of the old interval a rebuilt band
covers, and zero when the two only abut at a shared boundary.

**Why it is here.** Strict overlap drives the tier-2 and tier-3 matching. It is
public so the body-separation re-anchor shares one overlap definition with the tie
re-anchor rather than keeping a second copy.

.. CG-EXPLANATION-END id=function:overlap_mm

Function ``def _follow_moved_band``
-----------------------------------

.. CG-BLOCK id=function:_follow_moved_band lines=558-617

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 558-617
   :lineno-match:

.. CG-EXPLANATION-START id=function:_follow_moved_band

**What this does.** Tiers 2 and 3. After the exact lookup misses, it finds the band
the old one moved into by overlap: exactly one same-class overlapping band is
carried clean (tier 2); several same-class candidates are carried flagged
*ambiguous_band*; no same-class but something overlapping is carried flagged
*class_changed*; nothing overlapping is not carryable here.

**Why it is here.** Dragging a contact resizes an existing band, it does not create
a new one, so an overlapping band is that band moved. Tier 3 honours the owner's
rule that an accepted tie never disappears without an explicit delete: the tie comes
back attached to the band covering most of where it used to be, flagged, for the
engineer to confirm or delete — it deliberately does not pretend to know the
geology. Candidates are broken by shallowest top, so the choice is deterministic
rather than by dictionary order.

.. CG-EXPLANATION-END id=function:_follow_moved_band

Function ``def plan_tie_reanchor``
----------------------------------

.. CG-BLOCK id=function:plan_tie_reanchor lines=618-731

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 618-731
   :lineno-match:

.. CG-EXPLANATION-START id=function:plan_tie_reanchor

**What this does.** The pure planner. For each captured tie it looks each endpoint
up by exact identity, falls back to the moved-band search, and produces either a
matched tie (with the more consequential review reason winning when both ends are
flagged) or a lost tie with per-endpoint reasons; it also refuses a self-loop and
drops a duplicate pair.

**Why it is here.** The exact tier is tried first for every endpoint, so a band that
came back unchanged is never abandoned for a neighbour that merely overlaps it. The
function is pure — no database — which is why it is testable on paper and reused by
both presses. The self-loop and duplicate guards mirror database constraints, so the
write pass that follows never raises.

.. CG-EXPLANATION-END id=function:plan_tie_reanchor

Function ``def _canonical_key``
-------------------------------

.. CG-BLOCK id=function:_canonical_key lines=732-757

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 732-757
   :lineno-match:

.. CG-EXPLANATION-START id=function:_canonical_key

**What this does.** Produces the (section, smaller layer, larger layer, side, side)
key the database uniqueness uses, swapping the two sides along with the two layer
ids.

**Why it is here.** The unique constraint is not symmetric on the raw columns, so
the endpoints are canonicalised to (min, max) — and the sides must travel with their
endpoints, or a top-to-base tie would come back reversed.

.. CG-EXPLANATION-END id=function:_canonical_key

Function ``async def load_band_identities``
-------------------------------------------

.. CG-BLOCK id=function:load_band_identities lines=758-816

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 758-816
   :lineno-match:

.. CG-EXPLANATION-START id=function:load_band_identities

**What this does.** A module-level loader that reads the three-part identity plus
anchor kind of a set of geotech layers, joining each layer to its formation for the
class.

**Why it is here.** The class lives on the band's formation, not on the layer row,
so the join is mandatory. It is shared by the tie re-anchor and the body-separation
re-anchor, so both capture a band's identity the same way.

.. CG-EXPLANATION-END id=function:load_band_identities

Class ``GeotechTieReanchor`` — header
-------------------------------------

.. CG-BLOCK id=class:GeotechTieReanchor lines=817-828

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 817-828
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeotechTieReanchor

**What this does.** The class header: the object that captures accepted ties before
a reset and re-anchors them after it.

**Why it is here.** Its two halves belong to the same transaction — capture runs
before the layer wipe, re-anchor after the rebuild, and the caller commits once — so
a failure leaves neither half applied. It inherits the shared logger.

.. CG-EXPLANATION-END id=class:GeotechTieReanchor

Method ``GeotechTieReanchor``. ``def __init__``
-----------------------------------------------

.. CG-BLOCK id=method:GeotechTieReanchor.__init__ lines=829-833

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 829-833
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeotechTieReanchor.__init__

**What this does.** Stores the session.

**Why it is here.** The caller owns the session and its transaction; this object
just borrows it, which is what lets capture and re-anchor land in one commit.

.. CG-EXPLANATION-END id=method:GeotechTieReanchor.__init__

Method ``GeotechTieReanchor``. ``async def capture``
----------------------------------------------------

.. CG-BLOCK id=method:GeotechTieReanchor.capture lines=834-976

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 834-976
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeotechTieReanchor.capture

**What this does.** Records every accepted tie of a model together with both bands'
identities, optionally restricted to ties touching a given kind of column or a given
set of columns, and skips (with a WARNING) any edge whose endpoint cannot be
resolved.

**Why it is here.** It must run before the reset, or the endpoints are already gone.
Both restrictions answer one question — *is this tie at risk from the rebuild about
to run?* — from the two directions a rebuild can be narrowed: by the KIND of column
it touches (a rebuild deleting only borehole bands leaves a CPT-to-CPT tie's row
untouched) and by WHICH columns (a section-scoped rebuild). Capturing a tie the
rebuild does not touch would both overstate what the verb carried and invite a
duplicate on the way back. One endpoint in scope is enough, because the cascade
destroys the whole edge regardless.

.. CG-EXPLANATION-END id=method:GeotechTieReanchor.capture

Method ``GeotechTieReanchor``. ``async def surviving_bands``
------------------------------------------------------------

.. CG-BLOCK id=method:GeotechTieReanchor.surviving_bands lines=977-1033

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 977-1033
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeotechTieReanchor.surviving_bands

**What this does.** Reads back every band the model still holds after a scoped
delete, as ``RebuiltBand`` descriptions.

**Why it is here.** A section-scoped rebuild deletes only its own columns, so a
carried tie can have one endpoint on a band that was never touched — that band is
absent from the rebuild's in-memory index, and without it the re-anchor would report
a perfectly intact tie as lost. The docstring's warning is load-bearing: call this
BETWEEN the delete and the materialisation, or the rebuild's own fresh rows come
back here as well as in the index, the matcher sees each of them twice, and that
reads as an ambiguous band and flags a tie that is fine.

.. CG-EXPLANATION-END id=method:GeotechTieReanchor.surviving_bands

Method ``GeotechTieReanchor``. ``async def reanchor``
-----------------------------------------------------

.. CG-BLOCK id=method:GeotechTieReanchor.reanchor lines=1034-1157

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 1034-1157
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeotechTieReanchor.reanchor

**What this does.** Runs the pure planner, then writes each matched tie as a fresh
edge with its ORIGINAL source and ``user_approved=True`` (carrying its review flag),
skipping any pair already present; it labels and logs the lost ties and returns the
counts.

**Why it is here.** A tie the engineer accepted comes back accepted, and a flagged
tie is one he is asked to confirm — NOT a proposal. Demoting it to a proposal would
let the next rebuild's dirty-delete pass remove it, which is exactly the silent
disappearance this whole path exists to prevent. It re-reads the existing keys
defensively (nothing should remain after the cascade, but it makes the pass safe to
call from anywhere) and names the lost ties for the engineer — one extra query, and
only when something was actually lost.

.. CG-EXPLANATION-END id=method:GeotechTieReanchor.reanchor

Method ``GeotechTieReanchor``. ``async def _load_investigation_names``
----------------------------------------------------------------------

.. CG-BLOCK id=method:GeotechTieReanchor._load_investigation_names lines=1158-1196

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 1158-1196
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeotechTieReanchor._load_investigation_names

**What this does.** Resolves investigation ids to the names shown on screen, by
querying both the CPT and borehole tables and merging the results.

**Why it is here.** A band's anchor is a CPT or a borehole (a database XOR: exactly
one is set), and the caller has only the stringified id, so both tables are queried;
an id that resolves to neither is simply absent, and the label falls back to the raw
id.

.. CG-EXPLANATION-END id=method:GeotechTieReanchor._load_investigation_names

Method ``GeotechTieReanchor``. ``async def _load_band_identities``
------------------------------------------------------------------

.. CG-BLOCK id=method:GeotechTieReanchor._load_band_identities lines=1197-1217

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 1197-1217
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeotechTieReanchor._load_band_identities

**What this does.** A thin instance wrapper around the module-level
``load_band_identities``.

**Why it is here.** The body-separation re-anchor needs the same query, so the
implementation is shared rather than copied.

.. CG-EXPLANATION-END id=method:GeotechTieReanchor._load_band_identities

Method ``GeotechTieReanchor``. ``async def _load_existing_keys``
----------------------------------------------------------------

.. CG-BLOCK id=method:GeotechTieReanchor._load_existing_keys lines=1218-1247

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_reanchor.py
   :language: python
   :lines: 1218-1247
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeotechTieReanchor._load_existing_keys

**What this does.** Loads the (section, pair, sides) keys already present for the
model, in the same canonical shape the key helper produces.

**Why it is here.** So the write pass never inserts a duplicate the database would
reject.

.. CG-EXPLANATION-END id=method:GeotechTieReanchor._load_existing_keys

