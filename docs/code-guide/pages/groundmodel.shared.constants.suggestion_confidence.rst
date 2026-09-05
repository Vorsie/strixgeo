groundmodel.shared.constants.suggestion_confidence
==================================================

.. CG-PAGE source=src/groundmodel/shared/constants/suggestion_confidence.py complete=true

*Source file:* ``src/groundmodel/shared/constants/suggestion_confidence.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../src/groundmodel/shared/constants/suggestion_confidence.py
   :language: python
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces an enum for how confident a suggested lithostratigraphic layer boundary is, and imports ``StrEnum``.

**Why it is here.** The docstring records that it was moved out of the segmenter service into ``shared/`` so the API schema layer can reference it without importing from the domain layer (debt #54). The enum is data, not logic, and the segmenter imports it back from here.

.. CG-EXPLANATION-END id=module-header

Class ``SuggestionConfidence``
------------------------------

.. CG-BLOCK id=class:SuggestionConfidence lines=14-26

.. literalinclude:: ../../../src/groundmodel/shared/constants/suggestion_confidence.py
   :language: python
   :lines: 14-26
   :lineno-match:

.. CG-EXPLANATION-START id=class:SuggestionConfidence

**What this does.** The enum with three values: ``HIGH`` (a major, persistent signal at least twice the minimum layer thickness), ``MEDIUM`` (passes the minimum thickness but the zone is thin), and ``LOW`` (the boundary came from merging a too-thin run into its neighbour).

**Why it is here.** The three levels let the editor show the user how strong each suggested boundary is; each definition ties the level to the segmenter's own thickness thresholds so the label means the same thing wherever it is shown.

.. CG-EXPLANATION-END id=class:SuggestionConfidence

