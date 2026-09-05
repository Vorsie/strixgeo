groundmodel.api.schemas.borehole.caco3_content_response
=======================================================

.. CG-PAGE source=src/groundmodel/api/schemas/borehole/caco3_content_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/borehole/caco3_content_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/caco3_content_response.py
   :language: python
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring and the usual date/UUID/BaseModel/ConfigDict imports.

**Why it is here.** The response-schema pattern for one lab-test family.

.. CG-EXPLANATION-END id=module-header

Class ``CaCO3ContentResponse``
------------------------------

.. CG-BLOCK id=class:CaCO3ContentResponse lines=9-22

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/caco3_content_response.py
   :language: python
   :lines: 9-22
   :lineno-match:

.. CG-EXPLANATION-START id=class:CaCO3ContentResponse

**What this does.** The calcium-carbonate (lime) content as a percentage of dry mass, plus method and test date and the id.

**Why it is here.** The docstring draws a line the reader will care about: this is a measured lime content, distinct from a grain-size test's ``lime_removed`` flag, which is only a pre-treatment marker, not a measurement (Data Integrity Rule 3: independently measured quantities are not conflated).

.. CG-EXPLANATION-END id=class:CaCO3ContentResponse

