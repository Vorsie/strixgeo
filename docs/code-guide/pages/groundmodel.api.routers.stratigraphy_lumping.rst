groundmodel.api.routers.stratigraphy_lumping
============================================

.. CG-PAGE source=src/groundmodel/api/routers/stratigraphy_lumping.py complete=true

*Source file:* ``src/groundmodel/api/routers/stratigraphy_lumping.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-57

.. literalinclude:: ../../../src/groundmodel/api/routers/stratigraphy_lumping.py
   :language: python
   :lines: 1-57
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring explaining the two endpoints and the design choice behind them, then imports of the router and error types, the project response schema, the stage-request schema, the project row and repository, the session, and the logger. It creates the ``/projects/{project_id}/stratigraphy-lumping`` router.

**Why it is here.** *Lumping* is the engineer's map of which stratigraphy tokens are grouped together. The docstring records why the surface is two verbs (stage and promote) rather than one combined write: a single write could put a value into the saved slot without the engineer ever having applied it, which is exactly the two-stage-save rule this guards. Promote-as-a-verb makes the only path into the saved slot a server-side copy, so the saved slot can never hold something the engineer did not apply first. Reads need no endpoint because both slots ride along on the project response.

.. CG-EXPLANATION-END id=module-header

Function ``async def stage_stratigraphy_lumping``
-------------------------------------------------

.. CG-BLOCK id=function:stage_stratigraphy_lumping lines=58-140

.. literalinclude:: ../../../src/groundmodel/api/routers/stratigraphy_lumping.py
   :language: python
   :lines: 58-140
   :lineno-match:

.. CG-EXPLANATION-START id=function:stage_stratigraphy_lumping

**What this does.** The handler for ``PUT .../staged`` — write the lumping snapshot into the project's staged slot as a whole-value replace, and (when the body carries one) advance a monotonic revision counter, rejecting a lower incoming revision with a ``409``.

**Why it is here.** The map is one atomic snapshot, so it is replaced wholesale rather than merged — merging two applies would produce a map that never existed at any single moment. The saved slot is left alone so the resulting staged-versus-saved difference is the dirty (unsaved) signal the desktop shows. The revision guard rejects a lower revision because it can only come from a stale writer (a resurrected timer, a recovered session replaying an old snapshot), and accepting it would silently roll the map back; an equal revision is an idempotent retry and is accepted.

.. CG-EXPLANATION-END id=function:stage_stratigraphy_lumping

Function ``async def promote_stratigraphy_lumping``
---------------------------------------------------

.. CG-BLOCK id=function:promote_stratigraphy_lumping lines=141-194

.. literalinclude:: ../../../src/groundmodel/api/routers/stratigraphy_lumping.py
   :language: python
   :lines: 141-194
   :lineno-match:

.. CG-EXPLANATION-START id=function:promote_stratigraphy_lumping

**What this does.** The handler for ``POST .../promote`` — copy the staged slot onto the saved slot (the File-Save half). It leaves the staged slot in place, is a no-op when nothing was ever staged, and never touches the revision counter.

**Why it is here.** The staged slot is kept so that staged-equals-saved reads as "clean" immediately after a save. It is copied, not aliased, so a later edit of the staged slot cannot mutate the snapshot already saved. The revision is left alone because it tracks staged edits only, and crash-recovery compares it against the revision the recovery file recorded; bumping it on save would make a save look like an edit and desynchronise that comparison.

.. CG-EXPLANATION-END id=function:promote_stratigraphy_lumping

Function ``async def _get_project_or_404``
------------------------------------------

.. CG-BLOCK id=function:_get_project_or_404 lines=195-205

.. literalinclude:: ../../../src/groundmodel/api/routers/stratigraphy_lumping.py
   :language: python
   :lines: 195-205
   :lineno-match:

.. CG-EXPLANATION-START id=function:_get_project_or_404

**What this does.** A small helper that fetches the project row or raises a ``404``.

**Why it is here.** The shared scope guard does not fit here because the row being fetched IS the project, not a child scoped by a project id, so this mirrors the project-level guard used by the view-state endpoint.

.. CG-EXPLANATION-END id=function:_get_project_or_404

