desktop.renderer.src.components.sections.disjoinOptions
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/disjoinOptions.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/disjoinOptions.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-37

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/disjoinOptions.ts
   :language: typescript
   :lines: 1-37
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file: it composes the un-join (Dutch 'Ontkoppelen') options for a right-clicked body. A body is a single mass of one soil the model treats as one thing, and a join (a union) states that two touching bodies are really one. It imports the union list-item type and the disjoin-option type.

**Why it is here.** The comment records it is pure and shared by the section's body menu and the geotech band menu (debt #278, the Join verb); the frontend owns no body-resolution map, so each anchor's current body info comes from the backend, and the parallel Separate-verb builder was deleted with that verb (owner 2026-09-01).

.. CG-EXPLANATION-END id=module-header

``function buildDisjoinOptions``
--------------------------------

.. CG-BLOCK id=function:buildDisjoinOptions lines=38-64

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/disjoinOptions.ts
   :language: typescript
   :lines: 38-64
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildDisjoinOptions

**What this does.** Builds one un-join option per standing union that touches the right-clicked body, each labelled by the OTHER body — its server-resolved name, or its formation label, or the fallback 'the other body'.

**Why it is here.** The docstring records that a union is offered back here only when one of its anchors currently resolves to this body, and the comment records that the other anchor's layer id is the disambiguator (D2): after a union both anchors resolve to the same merged body, so the other-body id collides between two options, but each other-layer id still names a distinct position for the hover highlight.

.. CG-EXPLANATION-END id=function:buildDisjoinOptions

