groundmodel.application.correlate_litho_contacts
================================================

.. CG-PAGE source=src/groundmodel/application/correlate_litho_contacts.py complete=true

*Source file:* ``src/groundmodel/application/correlate_litho_contacts.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-60

.. literalinclude:: ../../../src/groundmodel/application/correlate_litho_contacts.py
   :language: python
   :lines: 1-60
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening docstring and imports for the two use cases in this file: creating and deleting a contact-level correlation edge. The docstring explains the contact-level model; the imports pull in the partition lock, the tie-tombstone recorder, the frame-conformance helpers, the resolver, the scope guard, the crossing guard, the litho-body guard, the row types and the exception types. It also sets a one-millimetre containment tolerance used to match a geotech band to its parent litho layer.

**Why it is here.** A correlation edge records that two contacts are the same stratigraphic boundary across two investigation columns. The docstring records that this contact-level (boundary-to-boundary) model replaces the older formation-level model over time (debt #133), and that the create path is deliberately lightweight for litho models — it does not run the ordinal resolver or absence inference, which operate on the formation-level graph — while doing extra guarding for geotech models. The tolerance is tight because the geotech band depths come from the same arithmetic pipeline as the litho picks.

.. CG-EXPLANATION-END id=module-header

Function ``def canonical_contact_order``
----------------------------------------

.. CG-BLOCK id=function:canonical_contact_order lines=61-99

.. literalinclude:: ../../../src/groundmodel/application/correlate_litho_contacts.py
   :language: python
   :lines: 61-99
   :lineno-match:

.. CG-EXPLANATION-START id=function:canonical_contact_order

**What this does.** A pure function that puts an edge's two endpoints into a fixed order — smaller id first — carrying each endpoint's side (top or base) along with its own id when the pair is swapped.

**Why it is here.** A correlation edge is undirected, so storing it in a fixed order makes the pair unique regardless of the order the caller passed. Because each endpoint also carries a side (a bottom-tie joins two bases), the side must travel WITH its own id through the swap; otherwise a swapped base-to-base edge would silently mix up the sides.

.. CG-EXPLANATION-END id=function:canonical_contact_order

Class ``ContactCorrelateResult``
--------------------------------

.. CG-BLOCK id=class:ContactCorrelateResult lines=100-122

.. literalinclude:: ../../../src/groundmodel/application/correlate_litho_contacts.py
   :language: python
   :lines: 100-122
   :lineno-match:

.. CG-EXPLANATION-START id=class:ContactCorrelateResult

**What this does.** A dataclass carrying the resulting edge row, a flag saying whether it was newly created or already existed, and an optional draw-time frame warning.

**Why it is here.** The created flag makes the create idempotent — a repeat call returns the existing edge, not a duplicate. The frame warning is populated when a geotech packing tie does not conform to the litho frame; the tie is still written but the engineer is flagged at draw time (owner order 2026-08-21: flag a tie that does not conform to the litho model).

.. CG-EXPLANATION-END id=class:ContactCorrelateResult

Class ``CorrelateLithoContacts`` — header
-----------------------------------------

.. CG-BLOCK id=class:CorrelateLithoContacts lines=123-136

.. literalinclude:: ../../../src/groundmodel/application/correlate_litho_contacts.py
   :language: python
   :lines: 123-136
   :lineno-match:

.. CG-EXPLANATION-START id=class:CorrelateLithoContacts

**What this does.** The class header for the create use case, inheriting the logger.

**Why it is here.** The docstring records that it connects two contacts in a litho model, is idempotent (a repeat pair returns the existing edge), and unlike the formation-level correlate does not re-run the ordinal resolver or absence inference, because contact-level edges only drive lens detection.

.. CG-EXPLANATION-END id=class:CorrelateLithoContacts

Method ``CorrelateLithoContacts``. ``def __init__``
---------------------------------------------------

.. CG-BLOCK id=method:CorrelateLithoContacts.__init__ lines=137-141

.. literalinclude:: ../../../src/groundmodel/application/correlate_litho_contacts.py
   :language: python
   :lines: 137-141
   :lineno-match:

.. CG-EXPLANATION-START id=method:CorrelateLithoContacts.__init__

**What this does.** The setup step: stores the caller's database session.

**Why it is here.** The caller owns the session; this use case commits once at the end of ``execute``.

.. CG-EXPLANATION-END id=method:CorrelateLithoContacts.__init__

Method ``CorrelateLithoContacts``. ``async def execute``
--------------------------------------------------------

.. CG-BLOCK id=method:CorrelateLithoContacts.execute lines=142-430

.. literalinclude:: ../../../src/groundmodel/application/correlate_litho_contacts.py
   :language: python
   :lines: 142-430
   :lineno-match:

.. CG-EXPLANATION-START id=method:CorrelateLithoContacts.execute

**What this does.** The entry point that creates an edge. It requires a section, rejects a self-loop, scope-guards the model and both contacts, and rejects two contacts on the same column. For a geotechnical model it also blocks a tie that crosses a litho-body boundary, blocks a tie that crosses a standing tie, and flags (without blocking) a tie that breaks the litho frame. It then canonicalises the pair, returns the existing edge if one is present, otherwise takes the partition lock, inserts the approved edge, re-runs the resolver without committing, and commits.

**Why it is here.** Each guard has its recorded reason. A section is required (owner directive 2026-06-08) because correlations are section-scoped and drive rendering; a missing section would become a not-null database error, so it is surfaced as a clean 422. A cross-lithology edge is allowed on purpose — it is a surface tie where the material differs across a facies change, and the resolver drops such edges from body formation so a tie never creates a mixed body. The three geotech-only guards enforce owner rulings: a packing correlation must not cross a litho-body boundary (two separate sand bodies must not merge by this gesture); a crossing tie is a hard conflict that suspends both ties and kills the fill on that gap, so it is rejected with a toast (owner 2026-08-17); and a frame-mismatched tie is flagged with a review badge rather than refused (owner 2026-08-21). The partition lock is taken before the insert, not later in the resolver, to avoid the background-recompute deadlock (owner dogfeed 2026-08-23). Lens detection is deliberately not fired here (owner directive 2026-05-31): a manual correlate that incidentally closed a lens topology was silently spawning a body row, breaking the no-side-effects-beyond-the-gesture rule.

.. CG-EXPLANATION-END id=method:CorrelateLithoContacts.execute

Method ``CorrelateLithoContacts``. ``async def _resolve_litho_bodies_for_geotech``
----------------------------------------------------------------------------------

.. CG-BLOCK id=method:CorrelateLithoContacts._resolve_litho_bodies_for_geotech lines=431-582

.. literalinclude:: ../../../src/groundmodel/application/correlate_litho_contacts.py
   :language: python
   :lines: 431-582
   :lineno-match:

.. CG-EXPLANATION-START id=method:CorrelateLithoContacts._resolve_litho_bodies_for_geotech

**What this does.** A private helper that, for each geotech contact, builds the set of parent litho-body ids the contact touches — the body of the band below it and the band above it — while withdrawing a body that merely wraps an enclosed lens.

**Why it is here.** A NAD packing class is always a subdivision of one litho body, and a contact is a surface touching two bands. The withdrawal follows the owner's enclosed-lens rulings (2026-08-12): a body that wraps a lens above and below may not license a tie at the lens boundary, because a tie licensed by it would split that very body in two. The unit's own body is never withdrawn (owner dogfeed 2026-08-15): that licence is held in the band's own right, not borrowed from a neighbour, so a sand-to-sand tie running inside one big sand body survives. It is conservative — an unresolved band contributes nothing, and an empty set makes the sharing check block the correlation. The deciding line is logged at INFO, not DEBUG, so a dogfeed log shows why a lens-adjacent tie was allowed or refused without re-running.

.. CG-EXPLANATION-END id=method:CorrelateLithoContacts._resolve_litho_bodies_for_geotech

Method ``CorrelateLithoContacts``. ``async def _containing_litho_body``
-----------------------------------------------------------------------

.. CG-BLOCK id=method:CorrelateLithoContacts._containing_litho_body lines=583-608

.. literalinclude:: ../../../src/groundmodel/application/correlate_litho_contacts.py
   :language: python
   :lines: 583-608
   :lineno-match:

.. CG-EXPLANATION-START id=method:CorrelateLithoContacts._containing_litho_body

**What this does.** A private helper returning the litho-body id of the accepted litho layer that contains a given geotech band, or nothing when no containing layer exists or its body is not yet stamped.

**Why it is here.** A geotech band lives inside one accepted litho layer; its parent body is that layer's body. This resolves the parent body id used by the body-sharing guard above.

.. CG-EXPLANATION-END id=method:CorrelateLithoContacts._containing_litho_body

Method ``CorrelateLithoContacts``. ``async def _containing_litho_layer``
------------------------------------------------------------------------

.. CG-BLOCK id=method:CorrelateLithoContacts._containing_litho_layer lines=609-634

.. literalinclude:: ../../../src/groundmodel/application/correlate_litho_contacts.py
   :language: python
   :lines: 609-634
   :lineno-match:

.. CG-EXPLANATION-START id=method:CorrelateLithoContacts._containing_litho_layer

**What this does.** A private helper that returns the accepted litho layer containing a geotech band, delegating to the shared frame-conformance resolver.

**Why it is here.** The containment rule lives in one shared resolver so this manual-tie path and the machine-tie path resolve the parent layer identically; a second copy would be a second place for it to be wrong.

.. CG-EXPLANATION-END id=method:CorrelateLithoContacts._containing_litho_layer

Method ``CorrelateLithoContacts``. ``async def _frame_conformance_warning``
---------------------------------------------------------------------------

.. CG-BLOCK id=method:CorrelateLithoContacts._frame_conformance_warning lines=635-673

.. literalinclude:: ../../../src/groundmodel/application/correlate_litho_contacts.py
   :language: python
   :lines: 635-673
   :lineno-match:

.. CG-EXPLANATION-START id=method:CorrelateLithoContacts._frame_conformance_warning

**What this does.** A private helper that returns the draw-time warning sentence when a packing tie exceeds the litho frame, or nothing when it conforms, delegating to the shared frame helper.

**Why it is here.** The same shared helper is run by the machine auto-correlate path, so the hand and the machine flag the identical tie with the identical message (owner order 2026-08-21). It returns nothing when the geotech model has no litho parent.

.. CG-EXPLANATION-END id=method:CorrelateLithoContacts._frame_conformance_warning

Method ``CorrelateLithoContacts``. ``async def _enclosing_body_of``
-------------------------------------------------------------------

.. CG-BLOCK id=method:CorrelateLithoContacts._enclosing_body_of lines=674-741

.. literalinclude:: ../../../src/groundmodel/application/correlate_litho_contacts.py
   :language: python
   :lines: 674-741
   :lineno-match:

.. CG-EXPLANATION-START id=method:CorrelateLithoContacts._enclosing_body_of

**What this does.** A private helper that returns the body wrapping a unit both above and below when those neighbours share one body different from the unit's own, otherwise nothing.

**Why it is here.** A unit whose litho-stack neighbours share one body is an enclosed lens in that body, so its boundaries are the lens's, not a through-going horizon of the wrapper. Tying the wrapper's surface at a lens boundary would bisect the wrapper (owner ruling 2026-08-12: adding this correlation would split the clay body in two), so the wrapper may not license a tie there. A same-body enclosure is excluded from the rule, because that is the enclosed-lens-merge family, not a wrapper.

.. CG-EXPLANATION-END id=method:CorrelateLithoContacts._enclosing_body_of

Method ``CorrelateLithoContacts``. ``async def _crossing_tie_description``
--------------------------------------------------------------------------

.. CG-BLOCK id=method:CorrelateLithoContacts._crossing_tie_description lines=742-829

.. literalinclude:: ../../../src/groundmodel/application/correlate_litho_contacts.py
   :language: python
   :lines: 742-829
   :lineno-match:

.. CG-EXPLANATION-START id=method:CorrelateLithoContacts._crossing_tie_description

**What this does.** A private helper that names the standing tie a candidate would cross, in the engineer's own words (column names and depths), or nothing when the candidate crosses nothing.

**Why it is here.** Owner ruling 2026-08-17: a crossing tie is rejected with a toast. It shares its arithmetic with the derivation's emit-time crossing guard so the hand and the machine cannot disagree about what crossing means. It reports column names and depths rather than a database id because the owner's verdict on an id-bearing warning was that he could not tell which tests it meant.

.. CG-EXPLANATION-END id=method:CorrelateLithoContacts._crossing_tie_description

Method ``CorrelateLithoContacts``. ``async def _band_home``
-----------------------------------------------------------

.. CG-BLOCK id=method:CorrelateLithoContacts._band_home lines=830-840

.. literalinclude:: ../../../src/groundmodel/application/correlate_litho_contacts.py
   :language: python
   :lines: 830-840
   :lineno-match:

.. CG-EXPLANATION-START id=method:CorrelateLithoContacts._band_home

**What this does.** A private helper returning the column a band sits on and the depth of the surface named by the given side (top or base).

**Why it is here.** The crossing test compares ties by the depth of their endpoints within each column, so it needs each band resolved to its column and the depth of the tied surface.

.. CG-EXPLANATION-END id=method:CorrelateLithoContacts._band_home

Method ``CorrelateLithoContacts``. ``async def _investigation_name``
--------------------------------------------------------------------

.. CG-BLOCK id=method:CorrelateLithoContacts._investigation_name lines=841-849

.. literalinclude:: ../../../src/groundmodel/application/correlate_litho_contacts.py
   :language: python
   :lines: 841-849
   :lineno-match:

.. CG-EXPLANATION-START id=method:CorrelateLithoContacts._investigation_name

**What this does.** A private helper returning a column's name as the engineer reads it on the section — the CPT name, or the borehole name, or the bare id as a last resort.

**Why it is here.** The crossing-tie warning is phrased in the engineer's vocabulary, so it needs the human-readable column name rather than an id.

.. CG-EXPLANATION-END id=method:CorrelateLithoContacts._investigation_name

Method ``CorrelateLithoContacts``. ``async def _describe_geotech_band``
-----------------------------------------------------------------------

.. CG-BLOCK id=method:CorrelateLithoContacts._describe_geotech_band lines=850-866

.. literalinclude:: ../../../src/groundmodel/application/correlate_litho_contacts.py
   :language: python
   :lines: 850-866
   :lineno-match:

.. CG-EXPLANATION-START id=method:CorrelateLithoContacts._describe_geotech_band

**What this does.** A private helper that names a geotech band for a refusal toast — its formation and packing class at its investigation — delegating to the shared describer.

**Why it is here.** When a cross-body correlation is refused, the toast must name both bands in terms the engineer recognises rather than by id, so the shared describer builds a readable label.

.. CG-EXPLANATION-END id=method:CorrelateLithoContacts._describe_geotech_band

Class ``UncorrelateLithoContacts`` — header
-------------------------------------------

.. CG-BLOCK id=class:UncorrelateLithoContacts lines=867-872

.. literalinclude:: ../../../src/groundmodel/application/correlate_litho_contacts.py
   :language: python
   :lines: 867-872
   :lineno-match:

.. CG-EXPLANATION-START id=class:UncorrelateLithoContacts

**What this does.** The class header for the delete use case, inheriting the logger.

**Why it is here.** The docstring records that it deletes a contact-level edge and is idempotent — deleting an edge that does not exist is a no-op, not an error.

.. CG-EXPLANATION-END id=class:UncorrelateLithoContacts

Method ``UncorrelateLithoContacts``. ``def __init__``
-----------------------------------------------------

.. CG-BLOCK id=method:UncorrelateLithoContacts.__init__ lines=873-877

.. literalinclude:: ../../../src/groundmodel/application/correlate_litho_contacts.py
   :language: python
   :lines: 873-877
   :lineno-match:

.. CG-EXPLANATION-START id=method:UncorrelateLithoContacts.__init__

**What this does.** The setup step: stores the caller's database session.

**Why it is here.** The caller owns the session; this use case commits once at the end of ``execute``.

.. CG-EXPLANATION-END id=method:UncorrelateLithoContacts.__init__

Method ``UncorrelateLithoContacts``. ``async def execute``
----------------------------------------------------------

.. CG-BLOCK id=method:UncorrelateLithoContacts.execute lines=878-1018

.. literalinclude:: ../../../src/groundmodel/application/correlate_litho_contacts.py
   :language: python
   :lines: 878-1018
   :lineno-match:

.. CG-EXPLANATION-START id=method:UncorrelateLithoContacts.execute

**What this does.** The entry point that deletes an edge. It requires a section, scope-guards the model, canonicalises the pair, and looks up the single matching edge. If none exists it commits and returns (a no-op). Otherwise it takes the partition lock, records a tie-tombstone for a geotech-model deletion, deletes the edge, re-runs the resolver without committing, and commits.

**Why it is here.** A section is required (owner directive 2026-06-08) and scopes the delete, because the same contact pair can exist as independent edges on several sections; without it the lookup could match two rows and error. The side columns are part of the widened unique key so a top-tie and a bottom-tie on the same pair stay distinct. The partition lock is taken before the tombstone and delete to avoid the background-recompute deadlock (owner dogfeed 2026-08-23). A tombstone is written only for a geotech-model deletion, before the delete so it can read the endpoints, because a tie the engineer deletes on the geotech model must stay deleted across future subdivides (owner 2026-08-17) — and since every subdivide rebuilds the bands with new ids, the tombstone remembers the place (both endpoints plus section) rather than the id. Litho-model deletions record nothing, because a litho tie's absence is already its own statement and the geotech derivation only restates what the litho model holds.

.. CG-EXPLANATION-END id=method:UncorrelateLithoContacts.execute

