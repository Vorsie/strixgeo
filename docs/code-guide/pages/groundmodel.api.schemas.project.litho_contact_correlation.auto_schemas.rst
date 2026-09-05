groundmodel.api.schemas.project.litho_contact_correlation.auto_schemas
======================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_contact_correlation/auto_schemas.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_contact_correlation/auto_schemas.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_contact_correlation/auto_schemas.py
   :language: python
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring, then imports of ``UUID``, the Pydantic tools, and the strict base.

**Why it is here.** This file holds the request and responses for the auto-correlate endpoint; the request uses the strict base.

.. CG-EXPLANATION-END id=module-header

Class ``AutoCorrelateContactRequest``
-------------------------------------

.. CG-BLOCK id=class:AutoCorrelateContactRequest lines=12-34

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_contact_correlation/auto_schemas.py
   :language: python
   :lines: 12-34
   :lineno-match:

.. CG-EXPLANATION-START id=class:AutoCorrelateContactRequest

**What this does.** The body of the auto-correlate endpoint: a depth-match window in metres (bounded 0.05 to 5.0, or the algorithm default when absent) and an optional section id.

**Why it is here.** The docstring records that the depth window mirrors the desktop's Settings control (#163b), and that supplying a section id makes adjacency follow the section's left-to-right column order — the engineer's mental model — rather than true map-plane proximity, which crossed columns for off-line investigations (dogfeed 2026-05-29).

.. CG-EXPLANATION-END id=class:AutoCorrelateContactRequest

Class ``DeleteAutoCorrelationsResponse``
----------------------------------------

.. CG-BLOCK id=class:DeleteAutoCorrelationsResponse lines=35-47

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_contact_correlation/auto_schemas.py
   :language: python
   :lines: 35-47
   :lineno-match:

.. CG-EXPLANATION-START id=class:DeleteAutoCorrelationsResponse

**What this does.** The result of the bulk delete-auto-suggestions endpoint: how many unapproved auto edges were removed.

**Why it is here.** Approved manual edges are untouched, as the docstring notes (#179).

.. CG-EXPLANATION-END id=class:DeleteAutoCorrelationsResponse

Class ``CrossingPinchOutResponse``
----------------------------------

.. CG-BLOCK id=class:CrossingPinchOutResponse lines=48-72

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_contact_correlation/auto_schemas.py
   :language: python
   :lines: 48-72
   :lineno-match:

.. CG-EXPLANATION-START id=class:CrossingPinchOutResponse

**What this does.** One pinch-out lens candidate inferred when two proposed correlations cross: the source investigation, its two framing contacts (top and base of the pinching layer), and the neighbour the layer pinches out toward.

**Why it is here.** The docstring records the auto-lens rule: when two proposals cross and neither is flat, both edges are dropped and the pinching layer is surfaced here for the desktop to draw as a lens ghost.

.. CG-EXPLANATION-END id=class:CrossingPinchOutResponse

Class ``AutoCorrelateContactResponse``
--------------------------------------

.. CG-BLOCK id=class:AutoCorrelateContactResponse lines=73-94

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_contact_correlation/auto_schemas.py
   :language: python
   :lines: 73-94
   :lineno-match:

.. CG-EXPLANATION-START id=class:AutoCorrelateContactResponse

**What this does.** The result of auto-correlate: edges created, edges skipped because they already existed, edges dropped for crossing, and the list of pinch-out lens candidates.

**Why it is here.** The skip count reflects safe idempotent re-calls (insert-or-do-nothing). The dropped-crossing count and the lens list default to empty so an older client is unaffected.

.. CG-EXPLANATION-END id=class:AutoCorrelateContactResponse

