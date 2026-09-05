groundmodel.api.schemas.project.litho_contact_correlation.litho_contact_correlation_schemas
===========================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_contact_correlation/litho_contact_correlation_schemas.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_contact_correlation/litho_contact_correlation_schemas.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_contact_correlation/litho_contact_correlation_schemas.py
   :language: python
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring listing the endpoints served and the section-scoping rule, then imports of ``datetime``, ``Literal``, ``UUID``, ``BaseModel`` and ``model_validator``, and the strict base.

**Why it is here.** The docstring records the section-scoped authoring rule (owner directive 2026-06-08): an edge carries the section it was authored on, create and delete both require a section id (the use cases raise a ``422`` on null), and the list endpoint returns the section and accepts a section filter.

.. CG-EXPLANATION-END id=module-header

Class ``ContactCorrelationRequest`` — header
--------------------------------------------

.. CG-BLOCK id=class:ContactCorrelationRequest lines=25-63

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_contact_correlation/litho_contact_correlation_schemas.py
   :language: python
   :lines: 25-63
   :lineno-match:

.. CG-EXPLANATION-START id=class:ContactCorrelationRequest

**What this does.** The body for creating and deleting a contact-correlation edge: the two layer endpoints, a provenance token, the authoring section, and which contact (top or base) of each layer the edge joins.

**Why it is here.** The docstring records that endpoints may be given in either order (the use case normalises to a canonical pair), that the section id is required in practice (declared optional only so the use case raises a clear ``422`` rather than request parsing), and that a base-on-both-ends edge is a bottom-tie letting the deepest unit band.

.. CG-EXPLANATION-END id=class:ContactCorrelationRequest

Method ``ContactCorrelationRequest``. ``def _no_self_loop``
-----------------------------------------------------------

.. CG-BLOCK id=method:ContactCorrelationRequest._no_self_loop lines=64-71

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_contact_correlation/litho_contact_correlation_schemas.py
   :language: python
   :lines: 64-71
   :lineno-match:

.. CG-EXPLANATION-START id=method:ContactCorrelationRequest._no_self_loop

**What this does.** A validator that rejects a request whose two endpoints are the same layer.

**Why it is here.** Defence in depth — a self-loop is meaningless, caught at the API boundary as well as deeper in.

.. CG-EXPLANATION-END id=method:ContactCorrelationRequest._no_self_loop

Class ``ContactCorrelationResponse``
------------------------------------

.. CG-BLOCK id=class:ContactCorrelationResponse lines=72-114

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_contact_correlation/litho_contact_correlation_schemas.py
   :language: python
   :lines: 72-114
   :lineno-match:

.. CG-EXPLANATION-START id=class:ContactCorrelationResponse

**What this does.** The result of creating an edge: the edge id, the canonical endpoints and their sides, the model, the provenance, whether a new edge was created, and an optional frame warning.

**Why it is here.** ``was_created`` is false when the edge already existed, so an idempotent re-call returns 200 not 201. The docstring records that a frame warning is set when a geotech packing tie does not conform to the litho frame — the tie IS still written, and the warning is the draw-time flag the owner ordered (2026-08-21), surfaced as a toast; it is null for conforming ties and every litho or geological correlation.

.. CG-EXPLANATION-END id=class:ContactCorrelationResponse

Class ``ContactCorrelationEdgeListItem``
----------------------------------------

.. CG-BLOCK id=class:ContactCorrelationEdgeListItem lines=115-165

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_contact_correlation/litho_contact_correlation_schemas.py
   :language: python
   :lines: 115-165
   :lineno-match:

.. CG-EXPLANATION-START id=class:ContactCorrelationEdgeListItem

**What this does.** One edge returned by the list endpoint: its id, canonical endpoints and sides, model, authoring section, provenance, whether the user approved it, an optional review reason, and its creation time. ``from_attributes`` is set.

**Why it is here.** ``from_attributes`` lets it read straight off the database row. The docstring records that a flagged edge (carrying a review reason) is still user-approved — awaiting confirmation, not demoted to a proposal — set by the geotech re-anchor when a re-subdivide could not identify the band a tie was drawn on, so the tie is carried and flagged rather than dropped.

.. CG-EXPLANATION-END id=class:ContactCorrelationEdgeListItem

