groundmodel.api.schemas.project.geotech_band_edit.restated_contact_move_response
================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/geotech_band_edit/restated_contact_move_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/geotech_band_edit/restated_contact_move_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_band_edit/restated_contact_move_response.py
   :language: python
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the schema and imports ``UUID``, ``Field``, and the band-edit response it extends.

**Why it is here.** It builds on an existing response schema rather than repeating it — the same pattern of reuse.

.. CG-EXPLANATION-END id=module-header

Class ``RestatedContactMoveResponse``
-------------------------------------

.. CG-BLOCK id=class:RestatedContactMoveResponse lines=14-44

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_band_edit/restated_contact_move_response.py
   :language: python
   :lines: 14-44
   :lineno-match:

.. CG-EXPLANATION-START id=class:RestatedContactMoveResponse

**What this does.** Extends the band-edit response with the other model levels a restated-contact move carried: the litho layer above and below the moved contact, and the geological contact carried along (or absent when the litho row is not derived from one).

**Why it is here.** The geotech half of this gesture IS a band move, so the caller reads the same plan and outcome; what it adds is the answer to "what else did I just change", which the docstring says the engineer must be told before pressing the button, not after. Extending rather than replacing keeps the shared fields identical.

.. CG-EXPLANATION-END id=class:RestatedContactMoveResponse

