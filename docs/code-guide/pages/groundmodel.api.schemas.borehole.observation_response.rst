groundmodel.api.schemas.borehole.observation_response
=====================================================

.. CG-PAGE source=src/groundmodel/api/schemas/borehole/observation_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/borehole/observation_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-12

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/observation_response.py
   :language: python
   :lines: 1-12
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring and imports of ``date``, ``UUID``, ``BaseModel``, ``ConfigDict``, and the layer response.

**Why it is here.** The response-schema pattern; it composes the layers list.

.. CG-EXPLANATION-END id=module-header

Class ``ObservationResponse``
-----------------------------

.. CG-BLOCK id=class:ObservationResponse lines=13-31

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/observation_response.py
   :language: python
   :lines: 13-31
   :lineno-match:

.. CG-EXPLANATION-START id=class:ObservationResponse

**What this does.** One interpretation stream on a borehole: id, its type, author, date, three quality/score fields, and its layers. Reads off the row.

**Why it is here.** A borehole can carry several observations of different types (coded lithology, formal stratigraphy, ...), each its own row with its own metadata; the type is a raw token the desktop maps to a label.

.. CG-EXPLANATION-END id=class:ObservationResponse

