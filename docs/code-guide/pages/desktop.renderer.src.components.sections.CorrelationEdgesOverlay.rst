desktop.renderer.src.components.sections.CorrelationEdgesOverlay
================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx complete=false

*Source file:* ``desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-52

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 1-52
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=module-header

``const CONTACT_EDGE_WIDTH``
----------------------------

.. CG-BLOCK id=const:CONTACT_EDGE_WIDTH lines=53-56

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 53-56
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONTACT_EDGE_WIDTH

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:CONTACT_EDGE_WIDTH

``const UNAPPROVED_EDGE_COLOR``
-------------------------------

.. CG-BLOCK id=const:UNAPPROVED_EDGE_COLOR lines=57-58

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 57-58
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNAPPROVED_EDGE_COLOR

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:UNAPPROVED_EDGE_COLOR

``const UNAPPROVED_EDGE_DASH``
------------------------------

.. CG-BLOCK id=const:UNAPPROVED_EDGE_DASH lines=59-66

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 59-66
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNAPPROVED_EDGE_DASH

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:UNAPPROVED_EDGE_DASH

``const BASE_TIE_COLOR``
------------------------

.. CG-BLOCK id=const:BASE_TIE_COLOR lines=67-69

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 67-69
   :lineno-match:

.. CG-EXPLANATION-START id=const:BASE_TIE_COLOR

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:BASE_TIE_COLOR

``const BASE_TIE_DASH``
-----------------------

.. CG-BLOCK id=const:BASE_TIE_DASH lines=70-76

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 70-76
   :lineno-match:

.. CG-EXPLANATION-START id=const:BASE_TIE_DASH

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:BASE_TIE_DASH

``const RIBBON_HALF_HEIGHT_PX``
-------------------------------

.. CG-BLOCK id=const:RIBBON_HALF_HEIGHT_PX lines=77-82

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 77-82
   :lineno-match:

.. CG-EXPLANATION-START id=const:RIBBON_HALF_HEIGHT_PX

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:RIBBON_HALF_HEIGHT_PX

``const RIBBON_STRIPES_ENABLED``
--------------------------------

.. CG-BLOCK id=const:RIBBON_STRIPES_ENABLED lines=83-90

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 83-90
   :lineno-match:

.. CG-EXPLANATION-START id=const:RIBBON_STRIPES_ENABLED

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:RIBBON_STRIPES_ENABLED

``const RIBBON_MIN_WIDTH_PX``
-----------------------------

.. CG-BLOCK id=const:RIBBON_MIN_WIDTH_PX lines=91-92

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 91-92
   :lineno-match:

.. CG-EXPLANATION-START id=const:RIBBON_MIN_WIDTH_PX

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:RIBBON_MIN_WIDTH_PX

``const RIBBON_APPROVED_OPACITY``
---------------------------------

.. CG-BLOCK id=const:RIBBON_APPROVED_OPACITY lines=93-95

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 93-95
   :lineno-match:

.. CG-EXPLANATION-START id=const:RIBBON_APPROVED_OPACITY

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:RIBBON_APPROVED_OPACITY

``const RIBBON_PENDING_OPACITY``
--------------------------------

.. CG-BLOCK id=const:RIBBON_PENDING_OPACITY lines=96-98

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 96-98
   :lineno-match:

.. CG-EXPLANATION-START id=const:RIBBON_PENDING_OPACITY

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:RIBBON_PENDING_OPACITY

``const RIBBON_SEAM_COLOR``
---------------------------

.. CG-BLOCK id=const:RIBBON_SEAM_COLOR lines=99-101

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 99-101
   :lineno-match:

.. CG-EXPLANATION-START id=const:RIBBON_SEAM_COLOR

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:RIBBON_SEAM_COLOR

``const CONTACT_HIT_HEIGHT``
----------------------------

.. CG-BLOCK id=const:CONTACT_HIT_HEIGHT lines=102-103

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 102-103
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONTACT_HIT_HEIGHT

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:CONTACT_HIT_HEIGHT

``const CONTACT_ARM_COLOR``
---------------------------

.. CG-BLOCK id=const:CONTACT_ARM_COLOR lines=104-106

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 104-106
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONTACT_ARM_COLOR

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:CONTACT_ARM_COLOR

``const LENS_CANDIDATE_COLOR``
------------------------------

.. CG-BLOCK id=const:LENS_CANDIDATE_COLOR lines=107-114

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 107-114
   :lineno-match:

.. CG-EXPLANATION-START id=const:LENS_CANDIDATE_COLOR

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:LENS_CANDIDATE_COLOR

``const EDGE_HIT_STROKE_WIDTH``
-------------------------------

.. CG-BLOCK id=const:EDGE_HIT_STROKE_WIDTH lines=115-119

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 115-119
   :lineno-match:

.. CG-EXPLANATION-START id=const:EDGE_HIT_STROKE_WIDTH

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:EDGE_HIT_STROKE_WIDTH

``const EDGE_DRAG_HIT_WIDTH``
-----------------------------

.. CG-BLOCK id=const:EDGE_DRAG_HIT_WIDTH lines=120-124

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 120-124
   :lineno-match:

.. CG-EXPLANATION-START id=const:EDGE_DRAG_HIT_WIDTH

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:EDGE_DRAG_HIT_WIDTH

``const EDGE_HIT_END_INSET``
----------------------------

.. CG-BLOCK id=const:EDGE_HIT_END_INSET lines=125-136

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 125-136
   :lineno-match:

.. CG-EXPLANATION-START id=const:EDGE_HIT_END_INSET

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:EDGE_HIT_END_INSET

``interface ContactGestureState``
---------------------------------

.. CG-BLOCK id=interface:ContactGestureState lines=137-187

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 137-187
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ContactGestureState

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:ContactGestureState

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=188-398

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 188-398
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:Props

``function CorrelationEdgesOverlay``
------------------------------------

.. CG-BLOCK id=function:CorrelationEdgesOverlay lines=399-1666

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
   :language: tsx
   :lines: 399-1666
   :lineno-match:

.. CG-EXPLANATION-START id=function:CorrelationEdgesOverlay

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:CorrelationEdgesOverlay

