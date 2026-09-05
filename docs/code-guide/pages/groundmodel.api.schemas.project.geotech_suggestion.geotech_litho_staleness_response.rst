groundmodel.api.schemas.project.geotech_suggestion.geotech_litho_staleness_response
===================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/geotech_suggestion/geotech_litho_staleness_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/geotech_suggestion/geotech_litho_staleness_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_suggestion/geotech_litho_staleness_response.py
   :language: python
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and imports ``UUID`` and the Pydantic tools.

**Why it is here.** This file holds a response schema and its item schema together.

.. CG-EXPLANATION-END id=module-header

Class ``StaleGeotechColumnItem``
--------------------------------

.. CG-BLOCK id=class:StaleGeotechColumnItem lines=10-27

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_suggestion/geotech_litho_staleness_response.py
   :language: python
   :lines: 10-27
   :lineno-match:

.. CG-EXPLANATION-START id=class:StaleGeotechColumnItem

**What this does.** One column whose lithology moved after its packing bands were made: the investigation id and its display name.

**Why it is here.** The kind (CPT or borehole) is left for the desktop to look up rather than duplicated, since it already holds both lists; the label falls back to the id when the row cannot be resolved.

.. CG-EXPLANATION-END id=class:StaleGeotechColumnItem

Class ``GeotechLithoStalenessResponse``
---------------------------------------

.. CG-BLOCK id=class:GeotechLithoStalenessResponse lines=28-76

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_suggestion/geotech_litho_staleness_response.py
   :language: python
   :lines: 28-76
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeotechLithoStalenessResponse

**What this does.** The answer to "has the lithology under these packing bands been edited since they were made?": the geotech model, its parent litho model, the columns to re-press, and counts of stale, banded, and unstamped columns.

**Why it is here.** The docstring records that bands are derived from the litho stack, so a moved litho contact leaves them describing ground that is no longer there — and until this shipped nothing said so, all the way into an export (debt #266). It is derived on every read by comparing stamped digests, so it self-clears when the columns are re-pressed. Unstamped columns (bands made before the stamp shipped) are reported separately and NOT counted as stale, because unknown provenance is not evidence the ground moved.

.. CG-EXPLANATION-END id=class:GeotechLithoStalenessResponse

