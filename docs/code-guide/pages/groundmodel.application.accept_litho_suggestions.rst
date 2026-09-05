groundmodel.application.accept_litho_suggestions
================================================

.. CG-PAGE source=src/groundmodel/application/accept_litho_suggestions.py complete=true

*Source file:* ``src/groundmodel/application/accept_litho_suggestions.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-81

.. literalinclude:: ../../../src/groundmodel/application/accept_litho_suggestions.py
   :language: python
   :lines: 1-81
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the accept-litho file. It imports the body-partition locks, the litho-geo link helpers, the wedge-tip and absence-inference use cases, the scope guard, the segmenter suggestion type, and the database rows and repositories, and its docstring lays out the whole accept contract.

**Why it is here.** The docstring records the load-bearing rules: under the geo-agnostic A2 model a suggestion crossing a geological boundary stays as one litho layer keyed on lithology plus admixture; the find-or-create key is the soil code plus a canonical admixture signature; instance ordinals stay empty for a later phase to assign; and a non-negotiable trap that recurred three times — every created and found contact id must be added to the section's seeded set (the explicit-content invariant).

.. CG-EXPLANATION-END id=module-header

Function ``def _map_contact_source_to_layer``
---------------------------------------------

.. CG-BLOCK id=function:_map_contact_source_to_layer lines=82-105

.. literalinclude:: ../../../src/groundmodel/application/accept_litho_suggestions.py
   :language: python
   :lines: 82-105
   :lineno-match:

.. CG-EXPLANATION-START id=function:_map_contact_source_to_layer

**What this does.** Translates a contact provenance token into the tighter layer provenance set — a borehole observation maps to one token, a manual pick to another, everything else to segmenter.

**Why it is here.** The contact side has an open set of source tokens while the layer side has a fixed allow-list; the mapping preserves the observation-versus-derived intent, and a mirror trigger maps back the same way (docstring).

.. CG-EXPLANATION-END id=function:_map_contact_source_to_layer

Function ``def _canonical_admixture_signature``
-----------------------------------------------

.. CG-BLOCK id=function:_canonical_admixture_signature lines=106-126

.. literalinclude:: ../../../src/groundmodel/application/accept_litho_suggestions.py
   :language: python
   :lines: 106-126
   :lineno-match:

.. CG-EXPLANATION-START id=function:_canonical_admixture_signature

**What this does.** Builds a deterministic text signature from a unit's admixtures — the sorted canonical keys joined together, empty when there are none.

**Why it is here.** It is half of the find-or-create key that decides whether two units are the same litho bucket. The local-versus-global flag is left out on purpose (owner decision: composition buckets, not per-layer presence detail) so two units differing only in locality share a bucket.

.. CG-EXPLANATION-END id=function:_canonical_admixture_signature

Class ``AcceptLithoResult``
---------------------------

.. CG-BLOCK id=class:AcceptLithoResult lines=127-158

.. literalinclude:: ../../../src/groundmodel/application/accept_litho_suggestions.py
   :language: python
   :lines: 127-158
   :lineno-match:

.. CG-EXPLANATION-START id=class:AcceptLithoResult

**What this does.** A frozen dataclass (an immutable data holder) reporting the accept: which litho formations were created versus reused, which contacts were created versus already found, the section whose seeded set was updated, and which geological formations had their contacts snapped during litho-to-geo coupling.

**Why it is here.** The docstring records that the snapped-geo list drives a later surface rebuild for every affected geological formation (issue #162).

.. CG-EXPLANATION-END id=class:AcceptLithoResult

Class ``BatchAcceptContext``
----------------------------

.. CG-BLOCK id=class:BatchAcceptContext lines=159-192

.. literalinclude:: ../../../src/groundmodel/application/accept_litho_suggestions.py
   :language: python
   :lines: 159-192
   :lineno-match:

.. CG-EXPLANATION-START id=class:BatchAcceptContext

**What this does.** A dataclass holding the shared state a multi-anchor batch reuses: the parent geological model id, the find-or-create formation lookup, and a map of existing layers. The dicts are mutated as the batch runs.

**Why it is here.** The single-accept path re-loads all of this per call; hoisting it once for a batch turns per-layer existence queries and a per-anchor display-order recompute into one shared read (issue #153). Mutating the dicts as the batch proceeds also dedupes shared units across anchors for free.

.. CG-EXPLANATION-END id=class:BatchAcceptContext

Class ``AcceptLithoSuggestions`` — header
-----------------------------------------

.. CG-BLOCK id=class:AcceptLithoSuggestions lines=193-218

.. literalinclude:: ../../../src/groundmodel/application/accept_litho_suggestions.py
   :language: python
   :lines: 193-218
   :lineno-match:

.. CG-EXPLANATION-START id=class:AcceptLithoSuggestions

**What this does.** The bulk, idempotent use case that commits litho suggestions into the model as formation and contact rows. It defines a half-millimetre tolerance constant for the layer dedup match.

**Why it is here.** It is idempotent by design: re-accepting an unchanged investigation is a read-heavy no-op (formation found, contact found, nothing inserted). The tolerance exists because the stored depth is millimetre-rounded by a database trigger while a freshly computed depth is not, so an exact match would miss the existing row and double-insert near-identical layers (debt #218).

.. CG-EXPLANATION-END id=class:AcceptLithoSuggestions

Method ``AcceptLithoSuggestions``. ``def __init__``
---------------------------------------------------

.. CG-BLOCK id=method:AcceptLithoSuggestions.__init__ lines=219-225

.. literalinclude:: ../../../src/groundmodel/application/accept_litho_suggestions.py
   :language: python
   :lines: 219-225
   :lineno-match:

.. CG-EXPLANATION-START id=method:AcceptLithoSuggestions.__init__

**What this does.** Stores the session and builds the geology and litho-layer repositories.

**Why it is here.** The repositories are the gateways that read and write the rows so the use case never writes raw SQL; they share the one session.

.. CG-EXPLANATION-END id=method:AcceptLithoSuggestions.__init__

Method ``AcceptLithoSuggestions``. ``async def execute``
--------------------------------------------------------

.. CG-BLOCK id=method:AcceptLithoSuggestions.execute lines=226-609

.. literalinclude:: ../../../src/groundmodel/application/accept_litho_suggestions.py
   :language: python
   :lines: 226-609
   :lineno-match:

.. CG-EXPLANATION-START id=method:AcceptLithoSuggestions.execute

**What this does.** The entry point. It requires exactly one anchor, scope-guards the investigation, takes the body-partition locks, loads the formation lookup and the geological contacts at this investigation, then walks the suggestions creating one litho layer each — finding or creating its formation, coupling it to a nearby geological contact when close enough — and finally stales surfaces, recomputes display order, runs absence inference, and commits.

**Why it is here.** Accept is a verbatim copy of the suggestion shape (owner directive 2026-05-27): two adjacent ghosts make two contacts, a merged ghost makes one, and no merge or split runs here, because that would silently undo the engineer's post-suggest editing. The locks are taken before the first write, litho parent then geotech child, in the resolver's canonical order, because the inserts row-lock the same body rows a background recompute re-stamps and taking them out of order deadlocks. Display order encodes the superposition rule (lower is older and deeper). Coupling snaps a geological contact to the litho depth only for a newly created contact so a re-accept never snaps twice, and a re-accept that finds an uncoupled layer restores the link without snapping (owner ruling 2026-08-11: unlinking should not be that easy). The commit switch lets a batch caller wrap many accepts in one transaction.

.. CG-EXPLANATION-END id=method:AcceptLithoSuggestions.execute

Method ``AcceptLithoSuggestions``. ``def _build_litho_formation_lookup``
------------------------------------------------------------------------

.. CG-BLOCK id=method:AcceptLithoSuggestions._build_litho_formation_lookup lines=610-652

.. literalinclude:: ../../../src/groundmodel/application/accept_litho_suggestions.py
   :language: python
   :lines: 610-652
   :lineno-match:

.. CG-EXPLANATION-START id=method:AcceptLithoSuggestions._build_litho_formation_lookup

**What this does.** Builds the find-or-create lookup from a project's formation rows, keyed by soil code plus admixture signature, skipping non-litho rows.

**Why it is here.** Shared by the single-accept path and the batch-context builder so both index formations identically; under the geo-agnostic model two old rows differing only in geological parent collapse to one bucket.

.. CG-EXPLANATION-END id=method:AcceptLithoSuggestions._build_litho_formation_lookup

Method ``AcceptLithoSuggestions``. ``async def _verify_investigation_scope``
----------------------------------------------------------------------------

.. CG-BLOCK id=method:AcceptLithoSuggestions._verify_investigation_scope lines=653-679

.. literalinclude:: ../../../src/groundmodel/application/accept_litho_suggestions.py
   :language: python
   :lines: 653-679
   :lineno-match:

.. CG-EXPLANATION-START id=method:AcceptLithoSuggestions._verify_investigation_scope

**What this does.** Asserts the CPT or borehole anchor belongs to the project, raising otherwise, and returns nothing.

**Why it is here.** A pure scope guard before any contact is written, so an investigation from another project cannot be used as an anchor (the cross-project guard, debt #4 class).

.. CG-EXPLANATION-END id=method:AcceptLithoSuggestions._verify_investigation_scope

Method ``AcceptLithoSuggestions``. ``async def _load_existing_layers``
----------------------------------------------------------------------

.. CG-BLOCK id=method:AcceptLithoSuggestions._load_existing_layers lines=680-727

.. literalinclude:: ../../../src/groundmodel/application/accept_litho_suggestions.py
   :language: python
   :lines: 680-727
   :lineno-match:

.. CG-EXPLANATION-START id=method:AcceptLithoSuggestions._load_existing_layers

**What this does.** Loads every accepted layer in the model as a find-or-create map keyed by model, formation, top depth and anchor.

**Why it is here.** A batch loads this once instead of running one existence query per layer. It reads the litho-layer table (the source of truth) rather than the legacy contact mirror, and the layer id doubles as the mirrored contact id so the seed path consumes it directly.

.. CG-EXPLANATION-END id=method:AcceptLithoSuggestions._load_existing_layers

Method ``AcceptLithoSuggestions``. ``async def build_batch_context``
--------------------------------------------------------------------

.. CG-BLOCK id=method:AcceptLithoSuggestions.build_batch_context lines=728-772

.. literalinclude:: ../../../src/groundmodel/application/accept_litho_suggestions.py
   :language: python
   :lines: 728-772
   :lineno-match:

.. CG-EXPLANATION-START id=method:AcceptLithoSuggestions.build_batch_context

**What this does.** Loads once, up front, the three pieces of shared state a batch reuses: the parent model id with its scope guard, the formation lookup, and the existing-layer map.

**Why it is here.** Passing the result to every inner accept means none of these is re-loaded per anchor (the issue #153 hoist).

.. CG-EXPLANATION-END id=method:AcceptLithoSuggestions.build_batch_context

Method ``AcceptLithoSuggestions``. ``async def _create_litho_formation``
------------------------------------------------------------------------

.. CG-BLOCK id=method:AcceptLithoSuggestions._create_litho_formation lines=773-836

.. literalinclude:: ../../../src/groundmodel/application/accept_litho_suggestions.py
   :language: python
   :lines: 773-836
   :lineno-match:

.. CG-EXPLANATION-START id=method:AcceptLithoSuggestions._create_litho_formation

**What this does.** Inserts a new litho formation row with an auto-derived name and the lithology colour, leaving the geological parent and the instance ordinal empty, then flushes it.

**Why it is here.** Under the geo-agnostic model litho units carry no geological parent. The colour is stamped at create so every read-side consumer (section bands, 3-D viewer, exports, the project bundle) is correct with no presentation override. The ordinal stays empty for the later resolution phase to assign.

.. CG-EXPLANATION-END id=method:AcceptLithoSuggestions._create_litho_formation

Method ``AcceptLithoSuggestions``. ``async def _recompute_litho_display_orders``
--------------------------------------------------------------------------------

.. CG-BLOCK id=method:AcceptLithoSuggestions._recompute_litho_display_orders lines=837-985

.. literalinclude:: ../../../src/groundmodel/application/accept_litho_suggestions.py
   :language: python
   :lines: 837-985
   :lineno-match:

.. CG-EXPLANATION-START id=method:AcceptLithoSuggestions._recompute_litho_display_orders

**What this does.** Assigns compact, stratigraphically ordered display-order numbers to the model's litho formations, sorting by parent age then by depth, and writing only the rows that changed.

**Why it is here.** The docstring records the encoding: lower number is older and deeper, the project-wide superposition convention the section and 3-D viewers rely on, and the numbers are kept compact because the 3-D viewer multiplies them by a per-order offset. The sort has a deterministic name tiebreak so two units at the same depth never flip ranks between sessions, which would break idempotency.

.. CG-EXPLANATION-END id=method:AcceptLithoSuggestions._recompute_litho_display_orders

Method ``AcceptLithoSuggestions``. ``async def _find_or_create_layer``
----------------------------------------------------------------------

.. CG-BLOCK id=method:AcceptLithoSuggestions._find_or_create_layer lines=986-1098

.. literalinclude:: ../../../src/groundmodel/application/accept_litho_suggestions.py
   :language: python
   :lines: 986-1098
   :lineno-match:

.. CG-EXPLANATION-START id=method:AcceptLithoSuggestions._find_or_create_layer

**What this does.** The idempotent find-or-create for one layer: in batch mode it answers from the in-memory map, otherwise it runs an existence query within a half-millimetre window, and inserts a new accepted layer only when none is found.

**Why it is here.** The top depth is part of the key so a re-accept after a re-segmentation that moved the boundary does not match the old layer and keep a stale depth. It writes the litho-layer table directly (the source of truth) and a mirror trigger keeps the legacy contact row in sync with the same id.

.. CG-EXPLANATION-END id=method:AcceptLithoSuggestions._find_or_create_layer

