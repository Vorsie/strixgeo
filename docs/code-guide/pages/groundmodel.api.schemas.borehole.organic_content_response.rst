groundmodel.api.schemas.borehole.organic_content_response
=========================================================

.. CG-PAGE source=src/groundmodel/api/schemas/borehole/organic_content_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/borehole/organic_content_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/organic_content_response.py
   :language: python
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring and the date/UUID/BaseModel/ConfigDict imports.

**Why it is here.** The response-schema pattern for one lab family.

.. CG-EXPLANATION-END id=module-header

Class ``OrganicContentResponse``
--------------------------------

.. CG-BLOCK id=class:OrganicContentResponse lines=9-28

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/organic_content_response.py
   :language: python
   :lines: 9-28
   :lineno-match:

.. CG-EXPLANATION-START id=class:OrganicContentResponse

**What this does.** Organic carbon and/or organic matter, each as a percentage of dry mass, plus method, test date, and id.

**Why it is here.** The docstring stresses the two are independent and never auto-derived from each other: the carbon-to-matter conversion factor is empirical and soil-dependent, so any consumer needing one from the other must apply it at display time and label it derived (Data Integrity Rule 3). DOV ships organic carbon, so DOV rows usually fill carbon and leave matter empty.

.. CG-EXPLANATION-END id=class:OrganicContentResponse

