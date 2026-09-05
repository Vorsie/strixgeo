groundmodel.domain.services.litho_frame_conformance
===================================================

.. CG-PAGE source=src/groundmodel/domain/services/litho_frame_conformance.py complete=true

*Source file:* ``src/groundmodel/domain/services/litho_frame_conformance.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_frame_conformance.py
   :language: python
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces a pure helper that checks whether a packing tie conforms to the litho frame, and defines the review-reason token stamped on a flagged edge.

**Why it is here.** The docstring records the owner order of 2026-08-21: flag a tie when it does not conform to the litho model. A packing tie subdivides ground inside the litho frame, so two bands can never band when their parent litho units are different soils, or are the same soil but carry no litho correlation path (the frame closes each family separately). The check only WARNS, never refuses, because a tie is still a legitimate surface statement; the engineer is told at draw time instead of discovering a wrong onlap on the canvas.

.. CG-EXPLANATION-END id=module-header

Function ``def frame_tie_warning``
----------------------------------

.. CG-BLOCK id=function:frame_tie_warning lines=35-80

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_frame_conformance.py
   :language: python
   :lines: 35-80
   :lineno-match:

.. CG-EXPLANATION-START id=function:frame_tie_warning

**What this does.** Returns a draw-time warning sentence for a non-conforming packing tie, or nothing when it conforms. It returns nothing if either parent soil is unresolved; a soil mismatch or a missing litho correlation path each produce a specific human-readable message naming the two bands.

**Why it is here.** The messages are written to be shown to the engineer word for word, describing the two bands by column and depth, never by id. An unresolved parent yields no warning because a missing parent is not evidence of non-conformance. The frame-mismatch token it complements renders as the review badge that the existing Confirm-tie flow clears.

.. CG-EXPLANATION-END id=function:frame_tie_warning

