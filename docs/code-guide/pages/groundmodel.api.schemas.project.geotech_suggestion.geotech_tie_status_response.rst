groundmodel.api.schemas.project.geotech_suggestion.geotech_tie_status_response
==============================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/geotech_suggestion/geotech_tie_status_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/geotech_suggestion/geotech_tie_status_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_suggestion/geotech_tie_status_response.py
   :language: python
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the schema and imports ``UUID`` and the Pydantic tools.

**Why it is here.** A response schema; same pattern.

.. CG-EXPLANATION-END id=module-header

Class ``GeotechTieStatusResponse``
----------------------------------

.. CG-BLOCK id=class:GeotechTieStatusResponse lines=10-50

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_suggestion/geotech_tie_status_response.py
   :language: python
   :lines: 10-50
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeotechTieStatusResponse

**What this does.** The answer to "is there packing-correlation work still waiting?": the model, the counts of pending, accepted, and flagged ties, and the pending count broken down per section.

**Why it is here.** The docstring notes this is cheap enough to poll after every accept, so the divide-boreholes button can say why it is disabled rather than failing on press — while pending ties are non-zero the divide verb refuses. Only accepted ties feed the resolver, the fill, and the 3-D build. The per-section breakdown is additive (2026-08-15) so the toolbar can name the other sections still holding the divide shut.

.. CG-EXPLANATION-END id=class:GeotechTieStatusResponse

