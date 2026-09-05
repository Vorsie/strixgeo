groundmodel.api.schemas.project.geotech_suggestion.auto_correlate_geotech_request
=================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/geotech_suggestion/auto_correlate_geotech_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/geotech_suggestion/auto_correlate_geotech_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_suggestion/auto_correlate_geotech_request.py
   :language: python
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the schema and imports ``UUID``, ``Field``, and the strict base.

**Why it is here.** A request schema on the strict base.

.. CG-EXPLANATION-END id=module-header

Class ``AutoCorrelateGeotechRequest``
-------------------------------------

.. CG-BLOCK id=class:AutoCorrelateGeotechRequest lines=12-28

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_suggestion/auto_correlate_geotech_request.py
   :language: python
   :lines: 12-28
   :lineno-match:

.. CG-EXPLANATION-START id=class:AutoCorrelateGeotechRequest

**What this does.** The body of the geotech auto-correlate endpoint: a single optional section id restricting the run to one section, or every section when absent.

**Why it is here.** The docstring notes the geotech correlation rule takes no tunables (its class-sequence match has no depth window), so the section id is the only field.

.. CG-EXPLANATION-END id=class:AutoCorrelateGeotechRequest

