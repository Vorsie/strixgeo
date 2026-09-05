groundmodel.api.schemas.project.geotech_suggestion.divide_borehole_response
===========================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/geotech_suggestion/divide_borehole_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/geotech_suggestion/divide_borehole_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_suggestion/divide_borehole_response.py
   :language: python
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the schema and imports ``UUID`` and the Pydantic tools.

**Why it is here.** A response schema; same pattern.

.. CG-EXPLANATION-END id=module-header

Class ``DivideBoreholeResponse``
--------------------------------

.. CG-BLOCK id=class:DivideBoreholeResponse lines=10-166

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_suggestion/divide_borehole_response.py
   :language: python
   :lines: 10-166
   :lineno-match:

.. CG-EXPLANATION-START id=class:DivideBoreholeResponse

**What this does.** The result of committing the divide-boreholes step: the model updated, how many boreholes got several bands versus one, rows inserted, formations created, and a large set of counters about the accepted ties — how many were carried onto the rebuilt bands, flagged for review, lost, or deleted for various reasons — plus human-readable labels for the lost ties.

**Why it is here.** The docstring is dense with owner rulings behind each counter; the load-bearing one is that lost ties are surfaced with a label naming both investigations and depths, because a count alone tells the engineer his accepted work vanished but nothing about where to redraw it, and the ids were only ever in a server log. Several counters (crossing, superseded-jump, replaced-span) record deliberate deletions of machine ties while hand-drawn ties are never deleted. Fields are additive and defaulted so an older client ignores them.

.. CG-EXPLANATION-END id=class:DivideBoreholeResponse

