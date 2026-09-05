groundmodel.api.schemas.project.geological_model
================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/geological_model.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/geological_model.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geological_model.py
   :language: python
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the datetime and UUID types, the Pydantic building blocks (``BaseModel``, ``ConfigDict``, ``Field``), the strict base class for write bodies, and the ``ModelKind`` vocabulary.

**Why it is here.** A *Pydantic model* is a class that both declares a data shape and automatically checks (validates) incoming values against it. A *UUID* is a long random identifier. ``Field`` attaches per-field rules (length limits, defaults); ``ConfigDict`` sets model-wide options. These are the tools the three schemas below are built from.

.. CG-EXPLANATION-END id=module-header

Class ``GeologicalModelCreateRequest``
--------------------------------------

.. CG-BLOCK id=class:GeologicalModelCreateRequest lines=14-36

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geological_model.py
   :language: python
   :lines: 14-36
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeologicalModelCreateRequest

**What this does.** The body for creating a geological interpretation model. It declares a required name (1–200 characters), an optional description, an active flag defaulting to false, a list of excluded borehole ids, the model kind (defaulting to geological), and an optional parent-model id.

**Why it is here.** ``Field(min_length=1, max_length=200)`` is a *validation* rule: a name outside that length is rejected with a ``422`` before any code runs. ``= <value>`` gives a *default* used when the client omits the field, which keeps the schema additive (older clients that do not send a field still work). The docstring records the domain rules enforced at the endpoint rather than here: a parent is required for non-geological kinds and forbidden for geological, and kind/parent cannot be changed after creation — this is the three-level model hierarchy (geological → litho → geotech).

.. CG-EXPLANATION-END id=class:GeologicalModelCreateRequest

Class ``GeologicalModelUpdateRequest``
--------------------------------------

.. CG-BLOCK id=class:GeologicalModelUpdateRequest lines=37-48

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geological_model.py
   :language: python
   :lines: 37-48
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeologicalModelUpdateRequest

**What this does.** The body for a partial update of a model: an optional name, description, and excluded-borehole list. Every field is optional.

**Why it is here.** A *PATCH* applies only the fields present in the body, so all fields are optional. The docstring notes the active flag is deliberately not updatable here — flipping it goes through a dedicated endpoint so the "only one active model per project" guard always runs.

.. CG-EXPLANATION-END id=class:GeologicalModelUpdateRequest

Class ``GeologicalModelResponse``
---------------------------------

.. CG-BLOCK id=class:GeologicalModelResponse lines=49-74

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geological_model.py
   :language: python
   :lines: 49-74
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeologicalModelResponse

**What this does.** The shape returned for one model: its id, project, name, description, active flag, excluded boreholes, kind, parent, two representative-statistic fields, and timestamps. It sets ``from_attributes=True``.

**Why it is here.** ``from_attributes=True`` lets Pydantic build this reply directly by reading the attributes off a database row, so the endpoint does not copy fields by hand. The reply deliberately omits the model's contacts so list endpoints stay light — the docstring points to a separate contacts endpoint. The two statistic fields are meaningful only for a geotechnical model and default to safe values, so they are additive for every existing client (owner rulings, debt #227); the stale flag is derived on read, never stored (Data Integrity Rule 1).

.. CG-EXPLANATION-END id=class:GeologicalModelResponse

