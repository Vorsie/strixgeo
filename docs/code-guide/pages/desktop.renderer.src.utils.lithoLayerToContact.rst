desktop.renderer.src.utils.lithoLayerToContact
==============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/lithoLayerToContact.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/lithoLayerToContact.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-52

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLayerToContact.ts
   :language: typescript
   :lines: 1-52
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening docstring and the one import. This file projects a litho layer — the newer per-layer record — onto the older formation-contact shape that the existing renderer and inspector still read.

**Why it is here.** The docstring records why it exists: the litho axis's source of truth moved from per-boundary contact rows to per-layer records (Shape A, carrying an explicit top, base and status), and a migration preserved the unique ids end to end, so a lookup by id finds the same row on either side of the change and the correlation edges and seeded-contact-id lists keep pointing at the same things. The reading components stay on the contact shape during this transition and are rewritten to think in layers one at a time. It also records the selection rules — only accepted layers become contacts, pending layers stay in the suggestion pipeline, rejected layers are dropped — and that the source-code mapping here is the inverse of the migration's, a best-effort round trip.

.. CG-EXPLANATION-END id=module-header

``function lithoLayerToContact``
--------------------------------

.. CG-BLOCK id=function:lithoLayerToContact lines=53-83

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLayerToContact.ts
   :language: typescript
   :lines: 53-83
   :lineno-match:

.. CG-EXPLANATION-START id=function:lithoLayerToContact

**What this does.** Turns one layer into a contact record, or returns nothing when the layer is rejected. It copies the ids and the top depth, maps the layer's origin code to the contact's origin code, and leaves the synthetic-position fields empty.

**Why it is here.** The docstring records that only the top boundary is carried across because the top is the surface used for selection, dragging and hit-testing, and that a rejected layer returns nothing (a pending layer is filtered out by the caller). A comment records that the synthetic fields are empty because a litho layer always has a real investigation anchor (enforced in the database) — synthetic pinch-out wedges are a geological-model feature only, and litho pinch-out is still parked (debt #131-b).

.. CG-EXPLANATION-END id=function:lithoLayerToContact

``function lithoLayersToContacts``
----------------------------------

.. CG-BLOCK id=function:lithoLayersToContacts lines=84-92

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLayerToContact.ts
   :language: typescript
   :lines: 84-92
   :lineno-match:

.. CG-EXPLANATION-START id=function:lithoLayersToContacts

**What this does.** Turns a whole list of layers into a list of contacts, keeping only the accepted ones and dropping rejected and pending.

**Why it is here.** The docstring records that it is accepted-only, matching the existing split between committed contacts and still-suggested layers.

.. CG-EXPLANATION-END id=function:lithoLayersToContacts

