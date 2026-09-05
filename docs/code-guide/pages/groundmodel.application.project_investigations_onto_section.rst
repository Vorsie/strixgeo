groundmodel.application.project_investigations_onto_section
===========================================================

.. CG-PAGE source=src/groundmodel/application/project_investigations_onto_section.py complete=true

*Source file:* ``src/groundmodel/application/project_investigations_onto_section.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-41

.. literalinclude:: ../../../src/groundmodel/application/project_investigations_onto_section.py
   :language: python
   :lines: 1-41
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the shared section-projection query. It imports the collection and id types, the query builder and session, the borehole/CPT/section rows, and the corridor-projection geometry helpers.

**Why it is here.** The docstring records that this is the single source of truth for a block copy-pasted across three body and correlation use cases (debt #197): load the section, build its endpoints, project the project's CPT and borehole locations, and keep the ones inside the projection buffer. Centralising it stops the projection maths from drifting across callers; it names the two structurally different sites deliberately left out.

.. CG-EXPLANATION-END id=module-header

Function ``async def project_investigations_onto_section``
----------------------------------------------------------

.. CG-BLOCK id=function:project_investigations_onto_section lines=42-130

.. literalinclude:: ../../../src/groundmodel/application/project_investigations_onto_section.py
   :language: python
   :lines: 42-130
   :lineno-match:

.. CG-EXPLANATION-START id=function:project_investigations_onto_section

**What this does.** Projects the in-corridor investigations onto a section line and returns each one's along-distance. It loads and scope-checks the section, builds its endpoints, gathers the excluded ids, then for every project CPT and borehole (optionally restricted to a given set) projects it onto the corridor and keeps those that land inside the buffer and between the endpoints.

**Why it is here.** It uses the same corridor rule the section view, the DXF/PDF render and the renderer all draw with, so an adjacency consumer never gets a column that is not actually on the section — a lateral-offset-only filter would. The optional missing-ok flag returns an empty mapping instead of raising for a section absent from the project, which the section-less body fallback relies on; otherwise a missing section is a hard error (the by-project scope guard).

.. CG-EXPLANATION-END id=function:project_investigations_onto_section

