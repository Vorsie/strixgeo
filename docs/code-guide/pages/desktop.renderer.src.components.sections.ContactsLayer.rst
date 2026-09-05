desktop.renderer.src.components.sections.ContactsLayer
======================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/ContactsLayer.tsx complete=false

*Source file:* ``desktop/src/renderer/src/components/sections/ContactsLayer.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-85

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 1-85
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=86-496

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 86-496
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:Props

``interface DragContact``
-------------------------

.. CG-BLOCK id=interface:DragContact lines=497-523

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 497-523
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DragContact

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:DragContact

``interface SnapCandidate``
---------------------------

.. CG-BLOCK id=interface:SnapCandidate lines=524-528

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 524-528
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SnapCandidate

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:SnapCandidate

``interface ContactCopyPayload``
--------------------------------

.. CG-BLOCK id=interface:ContactCopyPayload lines=529-537

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 529-537
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ContactCopyPayload

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:ContactCopyPayload

``interface DragState``
-----------------------

.. CG-BLOCK id=interface:DragState lines=538-612

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 538-612
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DragState

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:DragState

``interface MarqueeState``
--------------------------

.. CG-BLOCK id=interface:MarqueeState lines=613-624

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 613-624
   :lineno-match:

.. CG-EXPLANATION-START id=interface:MarqueeState

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:MarqueeState

``const LAYER_LABEL_MIN_HEIGHT_PX``
-----------------------------------

.. CG-BLOCK id=const:LAYER_LABEL_MIN_HEIGHT_PX lines=625-628

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 625-628
   :lineno-match:

.. CG-EXPLANATION-START id=const:LAYER_LABEL_MIN_HEIGHT_PX

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:LAYER_LABEL_MIN_HEIGHT_PX

``const DRAG_HIT_HALF_HEIGHT_PX``
---------------------------------

.. CG-BLOCK id=const:DRAG_HIT_HALF_HEIGHT_PX lines=629-632

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 629-632
   :lineno-match:

.. CG-EXPLANATION-START id=const:DRAG_HIT_HALF_HEIGHT_PX

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:DRAG_HIT_HALF_HEIGHT_PX

``const MIN_BAND_HIT_PX``
-------------------------

.. CG-BLOCK id=const:MIN_BAND_HIT_PX lines=633-642

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 633-642
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIN_BAND_HIT_PX

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:MIN_BAND_HIT_PX

``const REFERENCE_COINCIDENCE_EPSILON_M``
-----------------------------------------

.. CG-BLOCK id=const:REFERENCE_COINCIDENCE_EPSILON_M lines=643-648

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 643-648
   :lineno-match:

.. CG-EXPLANATION-START id=const:REFERENCE_COINCIDENCE_EPSILON_M

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:REFERENCE_COINCIDENCE_EPSILON_M

``const LITHO_CONTACT_LINE_COLOR``
----------------------------------

.. CG-BLOCK id=const:LITHO_CONTACT_LINE_COLOR lines=649-652

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 649-652
   :lineno-match:

.. CG-EXPLANATION-START id=const:LITHO_CONTACT_LINE_COLOR

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:LITHO_CONTACT_LINE_COLOR

``const LITHO_CONTACT_HALO_COLOR``
----------------------------------

.. CG-BLOCK id=const:LITHO_CONTACT_HALO_COLOR lines=653-660

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 653-660
   :lineno-match:

.. CG-EXPLANATION-START id=const:LITHO_CONTACT_HALO_COLOR

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:LITHO_CONTACT_HALO_COLOR

``const PACKING_BOUNDARY_LINE_COLOR``
-------------------------------------

.. CG-BLOCK id=const:PACKING_BOUNDARY_LINE_COLOR lines=661-664

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 661-664
   :lineno-match:

.. CG-EXPLANATION-START id=const:PACKING_BOUNDARY_LINE_COLOR

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:PACKING_BOUNDARY_LINE_COLOR

``const CLICK_TO_DRAG_THRESHOLD_PX``
------------------------------------

.. CG-BLOCK id=const:CLICK_TO_DRAG_THRESHOLD_PX lines=665-666

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 665-666
   :lineno-match:

.. CG-EXPLANATION-START id=const:CLICK_TO_DRAG_THRESHOLD_PX

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:CLICK_TO_DRAG_THRESHOLD_PX

``function ContactsLayer``
--------------------------

.. CG-BLOCK id=function:ContactsLayer lines=667-3714

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/ContactsLayer.tsx
   :language: tsx
   :lines: 667-3714
   :lineno-match:

.. CG-EXPLANATION-START id=function:ContactsLayer

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:ContactsLayer

