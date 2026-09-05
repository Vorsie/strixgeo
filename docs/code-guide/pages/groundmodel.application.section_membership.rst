groundmodel.application.section_membership
==========================================

.. CG-PAGE source=src/groundmodel/application/section_membership.py complete=true

*Source file:* ``src/groundmodel/application/section_membership.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../src/groundmodel/application/section_membership.py
   :language: python
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the section-membership helpers. It imports the collection type, the shared projection query, and the borehole/CPT/section rows.

**Why it is here.** The docstring records the owner ruling (dogfeed 2026-08-15) that a CPT on no section must not be subdivided or enter the geotech model, because it can never be drawn, correlated or corrected there. Membership is therefore "appears on at least one cross-section", decided by the app's own projection rule rather than a hand-rolled distance test, so every consumer agrees with what the section view draws — and a test on a section's exclusion list is not a member there.

.. CG-EXPLANATION-END id=module-header

Function ``async def load_section_member_investigation_ids``
------------------------------------------------------------

.. CG-BLOCK id=function:load_section_member_investigation_ids lines=40-96

.. literalinclude:: ../../../src/groundmodel/application/section_membership.py
   :language: python
   :lines: 40-96
   :lineno-match:

.. CG-EXPLANATION-START id=function:load_section_member_investigation_ids

**What this does.** Returns the set of investigations that appear on a cross-section. Given one section id it returns that section's members; given none it unions the members across every section in the project.

**Why it is here.** The two modes back the two pipeline presses — section-scoped and model-wide — and both exclude an investigation that appears on no section. An empty result for a project with no sections at all is a legitimate state (nothing drawn yet), in which the geotech model correctly has no members. Why: recorded in the docstring.

.. CG-EXPLANATION-END id=function:load_section_member_investigation_ids

Function ``async def load_members_by_section``
----------------------------------------------

.. CG-BLOCK id=function:load_members_by_section lines=97-146

.. literalinclude:: ../../../src/groundmodel/application/section_membership.py
   :language: python
   :lines: 97-146
   :lineno-match:

.. CG-EXPLANATION-START id=function:load_members_by_section

**What this does.** Returns each requested section's member investigations, keyed by section, by calling the shared projection query once per section.

**Why it is here.** A per-section judgement — "does this correlation connect two columns this section draws?" — needs the membership sets side by side, not unioned. Calling the single projection function per section keeps the corridor rule single-source; a batched re-implementation would be a second copy that could drift from what the section view draws. A section absent from the project resolves to an empty set so a caller can tell "no members" from "never asked".

.. CG-EXPLANATION-END id=function:load_members_by_section

Function ``async def load_investigation_names``
-----------------------------------------------

.. CG-BLOCK id=function:load_investigation_names lines=147-177

.. literalinclude:: ../../../src/groundmodel/application/section_membership.py
   :language: python
   :lines: 147-177
   :lineno-match:

.. CG-EXPLANATION-START id=function:load_investigation_names

**What this does.** Looks up display names for a mixed set of CPT and borehole ids, returning a mapping from id to name and omitting ids that match no row.

**Why it is here.** It exists to log what was skipped, not just how many — a model that came out smaller than the engineer expected is exactly the case where the log must name the dropped rows.

.. CG-EXPLANATION-END id=function:load_investigation_names

Function ``async def load_investigation_labels``
------------------------------------------------

.. CG-BLOCK id=function:load_investigation_labels lines=178-202

.. literalinclude:: ../../../src/groundmodel/application/section_membership.py
   :language: python
   :lines: 178-202
   :lineno-match:

.. CG-EXPLANATION-START id=function:load_investigation_labels

**What this does.** Resolves a set of investigation ids into one sorted, comma-separated label string, falling back to an id's own text when it matches no row.

**Why it is here.** It is the log-line form of the name lookup, shared by the three geotech writers that each report the columns they left off a section; the id fallback means the line never silently drops a row it is counting.

.. CG-EXPLANATION-END id=function:load_investigation_labels

