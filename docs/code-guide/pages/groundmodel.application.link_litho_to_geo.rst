groundmodel.application.link_litho_to_geo
=========================================

.. CG-PAGE source=src/groundmodel/application/link_litho_to_geo.py complete=true

*Source file:* ``src/groundmodel/application/link_litho_to_geo.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-48

.. literalinclude:: ../../../src/groundmodel/application/link_litho_to_geo.py
   :language: python
   :lines: 1-48
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening docstring and imports for the use case that links a lithostratigraphic contact to the nearest geological contact on the same investigation. The docstring lays out the coupling logic step by step and the project-scope guard; the imports pull in the two shared coupling helpers, the contact result value object, and the contact, surface and geological-model row types.

**Why it is here.** The docstring records that this is the manual inverse of the auto-link that fires on accept, letting the engineer reconnect a contact when the auto-link was wrong or missing. It spells out the four coupling steps — set the parent-contact link, snap the geological depth to the litho depth so both agree at one physical surface, mark the geological surface stale, and return the updated contact — and states plainly that the surface is NOT rebuilt, because the owner directive is that only the explicit Build-3-D button runs the triangulation; drags and manual edits merely mark stale. The scope guard (load the contact, load its model, check the model belongs to the project) is the id-guessing defence that rejects a foreign contact.

.. CG-EXPLANATION-END id=module-header

Class ``LinkLithoToGeo`` — header
---------------------------------

.. CG-BLOCK id=class:LinkLithoToGeo lines=49-58

.. literalinclude:: ../../../src/groundmodel/application/link_litho_to_geo.py
   :language: python
   :lines: 49-58
   :lineno-match:

.. CG-EXPLANATION-START id=class:LinkLithoToGeo

**What this does.** The use-case class header, inheriting the logger.

**Why it is here.** The docstring restates its job (issue #162): manually link a litho contact to the nearest geological contact within tolerance.

.. CG-EXPLANATION-END id=class:LinkLithoToGeo

Method ``LinkLithoToGeo``. ``def __init__``
-------------------------------------------

.. CG-BLOCK id=method:LinkLithoToGeo.__init__ lines=59-63

.. literalinclude:: ../../../src/groundmodel/application/link_litho_to_geo.py
   :language: python
   :lines: 59-63
   :lineno-match:

.. CG-EXPLANATION-START id=method:LinkLithoToGeo.__init__

**What this does.** The setup step: stores the caller's database session.

**Why it is here.** The caller owns the session and the commit; this use case commits once at the end of ``execute``.

.. CG-EXPLANATION-END id=method:LinkLithoToGeo.__init__

Method ``LinkLithoToGeo``. ``async def execute``
------------------------------------------------

.. CG-BLOCK id=method:LinkLithoToGeo.execute lines=64-172

.. literalinclude:: ../../../src/groundmodel/application/link_litho_to_geo.py
   :language: python
   :lines: 64-172
   :lineno-match:

.. CG-EXPLANATION-START id=method:LinkLithoToGeo.execute

**What this does.** The entry point. It scope-guards the contact and its model against the project, resolves the parent geological model, loads that model's contacts at the same investigation, picks the nearest within tolerance, then sets the coupling link, snaps the geological contact's depth to the litho depth, marks the geological surface stale, commits and returns the updated contact. It returns nothing when no geological contact is within tolerance or the litho model has no parent.

**Why it is here.** The default tolerance is 0.20 m to match the accept-time coupling tolerance, so the manual re-link behaves like the automatic one. The nearest-within-tolerance choice and the depth snap are shared with the accept-time path (the same helper), so both routes couple identically. The surface is marked stale but not rebuilt, per the owner directive that only Build-3-D triggers the interpolation. Returning nothing on no-match leaves the database untouched, so a mis-aimed link is a safe no-op.

.. CG-EXPLANATION-END id=method:LinkLithoToGeo.execute

Method ``LinkLithoToGeo``. ``async def _mark_geo_surface_stale``
----------------------------------------------------------------

.. CG-BLOCK id=method:LinkLithoToGeo._mark_geo_surface_stale lines=173-207

.. literalinclude:: ../../../src/groundmodel/application/link_litho_to_geo.py
   :language: python
   :lines: 173-207
   :lineno-match:

.. CG-EXPLANATION-START id=method:LinkLithoToGeo._mark_geo_surface_stale

**What this does.** A private helper that flips the stale flag to true on the surface row for the given geological model and formation, logging when a row was actually touched.

**Why it is here.** It records that a surface no longer matches its contacts, without rebuilding it — the engineer triggers the triangulation explicitly via Build-3-D. A missing surface row is silently ignored, because there is no built surface to mark stale.

.. CG-EXPLANATION-END id=method:LinkLithoToGeo._mark_geo_surface_stale

