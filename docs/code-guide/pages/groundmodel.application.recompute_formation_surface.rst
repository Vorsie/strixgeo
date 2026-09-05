groundmodel.application.recompute_formation_surface
===================================================

.. CG-PAGE source=src/groundmodel/application/recompute_formation_surface.py complete=true

*Source file:* ``src/groundmodel/application/recompute_formation_surface.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-51

.. literalinclude:: ../../../src/groundmodel/application/recompute_formation_surface.py
   :language: python
   :lines: 1-51
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the single-surface recompute file. It imports the triangulation service and its helpers (the point type, the checksum function, and ``compute_tin``), the borehole/CPT/contact/surface/model database row shapes, Postgres's "insert-or-update" statement, a time-ordered id generator, and the logger. The docstring states the job and the recompute scope rules.

**Why it is here.** The docstring records that every contact-editing use case calls this after its writes land, and that it re-runs the Delaunay triangulation (the standard way to build a surface mesh from scattered points) and writes the result into the ``formation_surface`` cache — a *cache* being a stored copy of a computed result so it need not be recomputed on every read. It also records the short-circuit: if the recomputed fingerprint matches the stored one, no write fires, so a no-op refresh costs nothing.

.. CG-EXPLANATION-END id=module-header

Class ``RecomputeFormationSurface`` — header
--------------------------------------------

.. CG-BLOCK id=class:RecomputeFormationSurface lines=52-54

.. literalinclude:: ../../../src/groundmodel/application/recompute_formation_surface.py
   :language: python
   :lines: 52-54
   :lineno-match:

.. CG-EXPLANATION-START id=class:RecomputeFormationSurface

**What this does.** Declares the use-case class for refreshing the cached surface of one (model, formation) pair, inheriting the shared logger.

**Why it is here.** Why: recorded in the class + module docstrings — it is the per-formation unit the model-wide rebuild and every contact-editing use case call.

.. CG-EXPLANATION-END id=class:RecomputeFormationSurface

Method ``RecomputeFormationSurface``. ``def __init__``
------------------------------------------------------

.. CG-BLOCK id=method:RecomputeFormationSurface.__init__ lines=55-59

.. literalinclude:: ../../../src/groundmodel/application/recompute_formation_surface.py
   :language: python
   :lines: 55-59
   :lineno-match:

.. CG-EXPLANATION-START id=method:RecomputeFormationSurface.__init__

**What this does.** Stores the active database session and names the logger after this module.

**Why it is here.** Same pattern as its siblings: the caller owns the session, so this use case never commits on its own — it flushes or writes and the caller's commit persists it.

.. CG-EXPLANATION-END id=method:RecomputeFormationSurface.__init__

Method ``RecomputeFormationSurface``. ``async def execute``
-----------------------------------------------------------

.. CG-BLOCK id=method:RecomputeFormationSurface.execute lines=60-295

.. literalinclude:: ../../../src/groundmodel/application/recompute_formation_surface.py
   :language: python
   :lines: 60-295
   :lineno-match:

.. CG-EXPLANATION-START id=method:RecomputeFormationSurface.execute

**What this does.** Recomputes one formation's surface and writes it if it changed. It loads the formation's contacts, drops any anchored to a borehole the model excludes, bulk-loads the referenced borehole and CPT rows, and builds a three-dimensional point per contact from its anchor's easting, northing and (surface elevation minus contact depth) — or, for a synthetic pinch-out contact, from the absolute coordinates stored on the row. It fingerprints the points; if the fingerprint matches the cached row and force is off, it does nothing (only clearing a lingering stale flag). Otherwise it triangulates, and inserts-or-updates the cache row in one round-trip, marking it not-stale.

**Why it is here.** Every branch cites its reason. Excluded boreholes are dropped before the fingerprint (debt #36) so excluding one changes the fingerprint and its point vanishes from the surface, matching what the section view shows; the contact row is kept, not deleted, so un-excluding restores it. Contacts with no usable anchor are silently skipped because rendering nothing beats a crash. The insert-or-update uses Postgres's ON CONFLICT on the (model, formation) unique constraint so one statement handles both the create and the update case, and this is the only path that clears the on-click-build staleness flag — the edit handlers set it, only this clears it.

.. CG-EXPLANATION-END id=method:RecomputeFormationSurface.execute

Method ``RecomputeFormationSurface``. ``async def execute_many``
----------------------------------------------------------------

.. CG-BLOCK id=method:RecomputeFormationSurface.execute_many lines=296-317

.. literalinclude:: ../../../src/groundmodel/application/recompute_formation_surface.py
   :language: python
   :lines: 296-317
   :lineno-match:

.. CG-EXPLANATION-START id=method:RecomputeFormationSurface.execute_many

**What this does.** A convenience wrapper that recomputes several (model, formation) pairs, de-duplicating them first, and returns how many actually wrote (no-op recomputes do not count).

**Why it is here.** Batch edits touch several formations at once; recomputing each affected pair once after the batch commit avoids re-running the triangulation redundantly inside the edit loop, as the module docstring's scope rules require. Force is forwarded so the manual Build re-triangulates every pair regardless of the fingerprint.

.. CG-EXPLANATION-END id=method:RecomputeFormationSurface.execute_many

