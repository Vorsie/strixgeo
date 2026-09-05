groundmodel.infrastructure.db.repositories.project_bundle.bundle_clone
======================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_clone.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_clone.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-66

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_clone.py
   :language: python
   :lines: 1-66
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A module docstring plus the toolbox — the registry helpers (collection keys, restore kwargs, the id map builder, the row counter, the CPT-series fingerprint, the remap, the parents-first sort).

**Why it is here.** The docstring states the module's whole point: File → Save As copies the project's tree by driving the *same* build-and-restore the ``.strix`` round-trip uses, with an id remap in between, so a collection added to the bundle is copied by Save-As the same day without anyone remembering to update a hand-written clone. The hand-written clone this replaced knew only about CPTs and boreholes and silently handed the engineer a copy missing every interpretation.

.. CG-EXPLANATION-END id=module-header

Class ``BundleCloneIncompleteError``
------------------------------------

.. CG-BLOCK id=class:BundleCloneIncompleteError lines=67-74

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_clone.py
   :language: python
   :lines: 67-74
   :lineno-match:

.. CG-EXPLANATION-START id=class:BundleCloneIncompleteError

**What this does.** Defines ``BundleCloneIncompleteError`` (a ``ValueError``), raised when a copy came out with fewer rows than the source.

**Why it is here.** It inherits ``ValueError`` so the routers' bad-bundle handling turns it into a clean error rather than a 500. A Save-As that quietly loses the interpretation is worse than one that fails, because the app adopts the copy the moment the call returns.

.. CG-EXPLANATION-END id=class:BundleCloneIncompleteError

Function ``async def clone_project_children``
---------------------------------------------

.. CG-BLOCK id=function:clone_project_children lines=75-171

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_clone.py
   :language: python
   :lines: 75-171
   :lineno-match:

.. CG-EXPLANATION-START id=function:clone_project_children

**What this does.** Copies every child row of the source project onto the target with fresh ids: it builds the source's bundle, maps every id to a new one, canonicalises the layer-pair endpoints, feeds the remapped bundle to the same restore, and then re-reads the copy and verifies it against the source before returning the per-collection counts.

**Why it is here.** Re-using the build and restore is what keeps the copy complete as the bundle grows; the id remap keeps every reference pointing inside the copy; and the verify-then-return (rather than assume) is the safety net the docstring insists on — a short copy raises rather than being handed back. It drops ``body_id`` for the caller's resolver to re-stamp, exactly as an open-from-file does.

.. CG-EXPLANATION-END id=function:clone_project_children

Function ``def _canonicalise_edge_endpoints``
---------------------------------------------

.. CG-BLOCK id=function:_canonicalise_edge_endpoints lines=172-205

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_clone.py
   :language: python
   :lines: 172-205
   :lineno-match:

.. CG-EXPLANATION-START id=function:_canonicalise_edge_endpoints

**What this does.** Restores a correlation edge's smallest-first endpoint order (and swaps the matching side labels along with it) after the id remap.

**Why it is here.** The remap replaces ids by value, which can flip a canonically-ordered pair out of order; the edge table requires and is deduped on the smallest-first order, so it must be re-established, carrying each endpoint's top/base side with it.

.. CG-EXPLANATION-END id=function:_canonicalise_edge_endpoints

Function ``def _canonicalise_fact_endpoints``
---------------------------------------------

.. CG-BLOCK id=function:_canonicalise_fact_endpoints lines=206-231

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_clone.py
   :language: python
   :lines: 206-231
   :lineno-match:

.. CG-EXPLANATION-START id=function:_canonicalise_fact_endpoints

**What this does.** The same smallest-first re-ordering for a geometry fact's endpoint pair.

**Why it is here.** Facts share the canonical-order rule; a fact has no side labels, so this is the simpler version.

.. CG-EXPLANATION-END id=function:_canonicalise_fact_endpoints

Function ``async def _count_litho_solids``
------------------------------------------

.. CG-BLOCK id=function:_count_litho_solids lines=232-259

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_clone.py
   :language: python
   :lines: 232-259
   :lineno-match:

.. CG-EXPLANATION-START id=function:_count_litho_solids

**What this does.** Counts a project's cached body solids with a database count, without serialising their meshes.

**Why it is here.** The completeness check compares solid counts, and re-serialising megabytes of vertex and triangle arrays just to learn how many rows there are would be the most expensive thing the copy does — a plain count answers the question cheaply.

.. CG-EXPLANATION-END id=function:_count_litho_solids

Function ``def _verify_clone_is_complete``
------------------------------------------

.. CG-BLOCK id=function:_verify_clone_is_complete lines=260-339

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_clone.py
   :language: python
   :lines: 260-339
   :lineno-match:

.. CG-EXPLANATION-START id=function:_verify_clone_is_complete

**What this does.** Compares the copy against the source collection by collection and, for CPTs, series fingerprint by series fingerprint, raising ``BundleCloneIncompleteError`` on any shortfall.

**Why it is here.** It is the teeth behind 'verified, not assumed'. Comparing the CPT series fingerprints as well as the row counts closes the blind spot that the series table has no id, so a copy that kept every CPT and dropped every series cannot pass.

.. CG-EXPLANATION-END id=function:_verify_clone_is_complete

Function ``def _lost_cpt_series``
---------------------------------

.. CG-BLOCK id=function:_lost_cpt_series lines=340-380

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_clone.py
   :language: python
   :lines: 340-380
   :lineno-match:

.. CG-EXPLANATION-START id=function:_lost_cpt_series

**What this does.** Names every CPT whose depth series did not survive the copy, for the error message.

**Why it is here.** When the verification fails on the series, the error should say which CPTs lost their data, not just that a count did not match.

.. CG-EXPLANATION-END id=function:_lost_cpt_series

