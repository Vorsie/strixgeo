groundmodel.api.schemas.project.geotech_suggestion.auto_correlate_geotech_response
==================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/geotech_suggestion/auto_correlate_geotech_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/geotech_suggestion/auto_correlate_geotech_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_suggestion/auto_correlate_geotech_response.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the schema and imports ``BaseModel``.

**Why it is here.** A response schema; the same pattern.

.. CG-EXPLANATION-END id=module-header

Class ``AutoCorrelateGeotechResponse``
--------------------------------------

.. CG-BLOCK id=class:AutoCorrelateGeotechResponse lines=8-61

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_suggestion/auto_correlate_geotech_response.py
   :language: python
   :lines: 8-61
   :lineno-match:

.. CG-EXPLANATION-START id=class:AutoCorrelateGeotechResponse

**What this does.** A set of counters reporting what the auto-correlate run did: ties proposed, ties born already-accepted, ties skipped because one already existed, sections examined, and several counts of ties skipped, deleted, retained, or flagged for review.

**Why it is here.** The docstring records the reasoning behind each counter (several tied to dated owner rulings): most notably that ties restating an approved litho tie are born accepted because the litho approval already vouches for them, and that mis-scoped machine proposals are removed while accepted or hand-drawn ones are retained and named in the log for the engineer to decide. The verb adds; it never reconciles.

.. CG-EXPLANATION-END id=class:AutoCorrelateGeotechResponse

