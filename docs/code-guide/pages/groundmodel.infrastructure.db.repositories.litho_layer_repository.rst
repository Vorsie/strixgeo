groundmodel.infrastructure.db.repositories.litho_layer_repository
=================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/repositories/litho_layer_repository.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/repositories/litho_layer_repository.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-49

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/litho_layer_repository.py
   :language: python
   :lines: 1-49
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A module docstring plus the toolbox: ``UUID``, the query helpers ``and_`` / ``or_`` / ``select`` / ``update`` and ``aliased`` (which lets one table appear twice in a query under different names), the investigation-kind constants, two pure domain helpers (the body-pick shape and the litho column digest), several ORM models, the geotech model-kind constant, and the logging base.

**Why it is here.** This repository is the read-and-write path for litho layers — the layer-centric primitive of the lithostratigraphic model. It imports pure domain helpers (the digest, the body pick) so the repository only assembles rows and the actual rules stay in the domain.

.. CG-EXPLANATION-END id=module-header

Class ``LithoLayerRepository`` — header
---------------------------------------

.. CG-BLOCK id=class:LithoLayerRepository lines=50-58

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/litho_layer_repository.py
   :language: python
   :lines: 50-58
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoLayerRepository

**What this does.** Opens the ``LithoLayerRepository`` class.

**Why it is here.** The same one-session-per-request repository shape as the others, for the ``litho_layer`` table and the caches derived from it.

.. CG-EXPLANATION-END id=class:LithoLayerRepository

Method ``LithoLayerRepository``. ``def __init__``
-------------------------------------------------

.. CG-BLOCK id=method:LithoLayerRepository.__init__ lines=59-62

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/litho_layer_repository.py
   :language: python
   :lines: 59-62
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoLayerRepository.__init__

**What this does.** The set-up method: registers the logger and stores the open session.

**Why it is here.** The shared repository pattern.

.. CG-EXPLANATION-END id=method:LithoLayerRepository.__init__

Method ``LithoLayerRepository``. ``async def list_layers``
----------------------------------------------------------

.. CG-BLOCK id=method:LithoLayerRepository.list_layers lines=63-110

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/litho_layer_repository.py
   :language: python
   :lines: 63-110
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoLayerRepository.list_layers

**What this does.** Lists a model's layers, optionally filtered by borehole, CPT, formation or status, always sorted shallowest-first.

**Why it is here.** Top-to-bottom order matches the dominant read: 'give me this column's layers in the order they stack'. The filters are trusted — the anchor XOR is enforced at the row level, so combining a borehole and a CPT filter safely returns nothing rather than a bad mix.

.. CG-EXPLANATION-END id=method:LithoLayerRepository.list_layers

Method ``LithoLayerRepository``. ``async def get_layer``
--------------------------------------------------------

.. CG-BLOCK id=method:LithoLayerRepository.get_layer lines=111-121

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/litho_layer_repository.py
   :language: python
   :lines: 111-121
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoLayerRepository.get_layer

**What this does.** Loads one layer by its primary key, or ``None``.

**Why it is here.** A plain fetch; a ``None`` also covers a layer already removed by a cascade.

.. CG-EXPLANATION-END id=method:LithoLayerRepository.get_layer

Method ``LithoLayerRepository``. ``async def update_layer``
-----------------------------------------------------------

.. CG-BLOCK id=method:LithoLayerRepository.update_layer lines=122-164

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/litho_layer_repository.py
   :language: python
   :lines: 122-164
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoLayerRepository.update_layer

**What this does.** Applies a partial update to a layer, optionally rejecting it as not-found when the layer does not belong to the given model, then flushes and returns the row.

**Why it is here.** It trusts the request schema and the database check constraints for validation (depth ordering, the allowed status / source / confidence strings), so it just maps the patch onto the row. The optional model check is the IDOR scope guard for the single-layer write path — the router always passes the URL's model id so a layer in another model cannot be edited by guessing its id.

.. CG-EXPLANATION-END id=method:LithoLayerRepository.update_layer

Method ``LithoLayerRepository``. ``async def create_layer``
-----------------------------------------------------------

.. CG-BLOCK id=method:LithoLayerRepository.create_layer lines=165-212

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/litho_layer_repository.py
   :language: python
   :lines: 165-212
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoLayerRepository.create_layer

**What this does.** Inserts one litho layer with a fresh uuid7 id and flushes, logging the depth range and status.

**Why it is here.** The single-row insert path; the caller supplies the anchor and the boundaries, and the database check constraints backstop the values.

.. CG-EXPLANATION-END id=method:LithoLayerRepository.create_layer

Method ``LithoLayerRepository``. ``async def delete_layer``
-----------------------------------------------------------

.. CG-BLOCK id=method:LithoLayerRepository.delete_layer lines=213-229

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/litho_layer_repository.py
   :language: python
   :lines: 213-229
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoLayerRepository.delete_layer

**What this does.** Hard-deletes one layer, returning ``True`` when a row existed. Idempotent.

**Why it is here.** A plain delete; deleting an unknown id is a harmless ``False``.

.. CG-EXPLANATION-END id=method:LithoLayerRepository.delete_layer

Method ``LithoLayerRepository``. ``async def list_layers_by_ids``
-----------------------------------------------------------------

.. CG-BLOCK id=method:LithoLayerRepository.list_layers_by_ids lines=230-264

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/litho_layer_repository.py
   :language: python
   :lines: 230-264
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoLayerRepository.list_layers_by_ids

**What this does.** Loads many layers by id in one query, in arbitrary order.

**Why it is here.** The batch-update use case needs the whole set at once for its scope check and matches results by id, not position — the same pattern as the contact and CPT batch loads.

.. CG-EXPLANATION-END id=method:LithoLayerRepository.list_layers_by_ids

Method ``LithoLayerRepository``. ``async def load_body_picks``
--------------------------------------------------------------

.. CG-BLOCK id=method:LithoLayerRepository.load_body_picks lines=265-441

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/litho_layer_repository.py
   :language: python
   :lines: 265-441
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoLayerRepository.load_body_picks

**What this does.** Builds one ``BodyLayerPick`` per accepted layer that has a resolved body and an anchor with a full position — carrying the investigation's world coordinates and surface elevation. Layers with no body, a missing anchor, or a missing coordinate are skipped (and counted). It can be restricted to a set of in-corridor investigations.

**Why it is here.** These picks are the input to the 3-D solid build; the pick reads the same coordinate columns the surface builder uses, so the two 3-D pipelines share one coordinate source and can never disagree. A layer with no ``body_id`` is skipped because the resolver has not grouped it into a body yet, and one with an incomplete position cannot be placed in space.

.. CG-EXPLANATION-END id=method:LithoLayerRepository.load_body_picks

Method ``LithoLayerRepository``. ``async def load_column_digests``
------------------------------------------------------------------

.. CG-BLOCK id=method:LithoLayerRepository.load_column_digests lines=442-510

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/litho_layer_repository.py
   :language: python
   :lines: 442-510
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoLayerRepository.load_column_digests

**What this does.** For each column carrying accepted litho in a model, computes a *digest* — a short fingerprint — of that column's whole stack, by projecting just the five columns the digest is made of (the anchor pair, both depths, the formation) and grouping by column. Columns with no accepted litho are simply absent.

**Why it is here.** This is the read a geotech band-set is compared against to tell whether it is stale (debt #266): if a column's litho stack changed since the bands were built, its digest no longer matches and the bands over it read stale. Projecting only the five relevant columns keeps this cheap on every geotech render, and the rest of a row (notes, timestamps) says nothing about where the ground is. Absent columns make bands read stale rather than 'unknown'.

.. CG-EXPLANATION-END id=method:LithoLayerRepository.load_column_digests

Method ``LithoLayerRepository``. ``async def banded_column_ids``
----------------------------------------------------------------

.. CG-BLOCK id=method:LithoLayerRepository.banded_column_ids lines=511-540

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/litho_layer_repository.py
   :language: python
   :lines: 511-540
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoLayerRepository.banded_column_ids

**What this does.** Returns the set of columns that carry at least one layer or band in a model.

**Why it is here.** Run against a geotech model, it answers 'which columns have bands right now' — the set a build folds its fresh digests into, and the set a cleared column drops out of.

.. CG-EXPLANATION-END id=method:LithoLayerRepository.banded_column_ids

Method ``LithoLayerRepository``. ``async def mark_litho_solids_stale``
----------------------------------------------------------------------

.. CG-BLOCK id=method:LithoLayerRepository.mark_litho_solids_stale lines=541-569

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/litho_layer_repository.py
   :language: python
   :lines: 541-569
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoLayerRepository.mark_litho_solids_stale

**What this does.** Flips the stale flag to true on every cached 3-D solid for a model, returning the count touched.

**Why it is here.** Every use case that mutates accepted layers or body membership calls this so the on-click Build knows the 3-D cache is no longer valid. Zero rows means no build has run yet — a legal no-op.

.. CG-EXPLANATION-END id=method:LithoLayerRepository.mark_litho_solids_stale

Method ``LithoLayerRepository``. ``async def get_formation_contact``
--------------------------------------------------------------------

.. CG-BLOCK id=method:LithoLayerRepository.get_formation_contact lines=570-592

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/litho_layer_repository.py
   :language: python
   :lines: 570-592
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoLayerRepository.get_formation_contact

**What this does.** Returns one geological contact row by id, or ``None``.

**Why it is here.** A litho layer coupled to the geological model carries a parent contact id, and that contact *is* the layer's top boundary — the same physical surface recorded once per model. A boundary move must reach that geological row in the *same* transaction, so this read lives here rather than forcing the use case to open a second repository.

.. CG-EXPLANATION-END id=method:LithoLayerRepository.get_formation_contact

Method ``LithoLayerRepository``. ``async def mark_geo_surfaces_stale``
----------------------------------------------------------------------

.. CG-BLOCK id=method:LithoLayerRepository.mark_geo_surfaces_stale lines=593-620

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/litho_layer_repository.py
   :language: python
   :lines: 593-620
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoLayerRepository.mark_geo_surfaces_stale

**What this does.** Marks the listed geological (model, formation) surfaces stale, by delegating to the geology repository's bulk stale method.

**Why it is here.** A geological surface is interpolated through its contacts, so moving a coupled boundary leaves the surface describing a line the section no longer agrees with — and nothing shows the mismatch until someone spots the 2-D and 3-D views disagree. Delegating keeps one implementation of the staleness rule.

.. CG-EXPLANATION-END id=method:LithoLayerRepository.mark_geo_surfaces_stale

Method ``LithoLayerRepository``. ``async def list_litho_solids``
----------------------------------------------------------------

.. CG-BLOCK id=method:LithoLayerRepository.list_litho_solids lines=621-645

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/litho_layer_repository.py
   :language: python
   :lines: 621-645
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoLayerRepository.list_litho_solids

**What this does.** Returns every cached 3-D solid for a model, in arbitrary order.

**Why it is here.** The 3-D GET endpoint and the recompute use case read these and index them by body; the list is empty until a build has run.

.. CG-EXPLANATION-END id=method:LithoLayerRepository.list_litho_solids

Method ``LithoLayerRepository``. ``async def rederive_geotech_parent_litho_layers``
-----------------------------------------------------------------------------------

.. CG-BLOCK id=method:LithoLayerRepository.rederive_geotech_parent_litho_layers lines=646-744

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/litho_layer_repository.py
   :language: python
   :lines: 646-744
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoLayerRepository.rederive_geotech_parent_litho_layers

**What this does.** For a geotechnical model, overwrites every accepted band's covering-litho-band link using the midpoint rule: each band is linked to the accepted litho band, in the parent litho model, on the same investigation whose depth interval contains the band's vertical midpoint. It returns the count re-derived and is a no-op on a non-geotech model.

**Why it is here.** It is run just before the mesh build — the last whole-model operation (owner ruling 2026-09-01) — so the links reflect the final litho geometry rather than an earlier subdivide. The write is an *overwrite*, not fill-if-null, because a band edited after the last subdivide may now sit under a different litho layer, and a band that lost its cover becomes a true orphan (``None``). It stays geotech-only so a litho build never touches these links. The SQL is the set-based form of a pure domain rule, so the two cannot drift.

.. CG-EXPLANATION-END id=method:LithoLayerRepository.rederive_geotech_parent_litho_layers

Method ``LithoLayerRepository``. ``async def restamp_geotech_parent_litho_bodies``
----------------------------------------------------------------------------------

.. CG-BLOCK id=method:LithoLayerRepository.restamp_geotech_parent_litho_bodies lines=745-821

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/litho_layer_repository.py
   :language: python
   :lines: 745-821
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoLayerRepository.restamp_geotech_parent_litho_bodies

**What this does.** For a geotechnical model, overwrites every body's litho-parent-*body* link with the litho body of its shallowest member band that has a covering litho band, returning the count re-stamped. A no-op on a non-geotech model.

**Why it is here.** It runs right after the band-level re-derivation and reads the links that method just wrote. At build time the bodies already exist, so this only re-stamps the body-level parent from the fresh band links, without running the full resolver. It mirrors the resolver's own shallowest-member rule, so the body-level link the Parameters pane relies on stays correct through a litho reshuffle.

.. CG-EXPLANATION-END id=method:LithoLayerRepository.restamp_geotech_parent_litho_bodies

