groundmodel.api.schemas.project.litho_suggestion.litho_suggestion_request
=========================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_suggestion/litho_suggestion_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_suggestion/litho_suggestion_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_suggestion/litho_suggestion_request.py
   :language: python
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports UUID, the Pydantic validator tools, the strict base class, and the segmenter's default and bounding constants for the two unit weights.

**Why it is here.** Pulling the unit-weight defaults and bounds from the shared domain constants (not typing the numbers here) keeps this request and the SBT-profile endpoint in exact agreement, which is the whole point of that parity — two copies of the same range is one too many (the don't-repeat rule).

.. CG-EXPLANATION-END id=module-header

Class ``LithoSuggestionRequest`` — header
-----------------------------------------

.. CG-BLOCK id=class:LithoSuggestionRequest lines=20-85

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_suggestion/litho_suggestion_request.py
   :language: python
   :lines: 20-85
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoSuggestionRequest

**What this does.** The body for asking the segmenter to propose layers for one investigation. It carries the target (a CPT or a borehole), a minimum layer thickness, the two unit weights and a sand-density factor for the CPT path, a merge-same-lithology flag, and a flag choosing the normalised or non-normalised classifier.

**Why it is here.** The docstring records the chosen defaults and why: the 0.15 m minimum matches typical CPT sampling (finer is noise, coarser missed thin clay drapes in dogfeed 2026-05-23); merging adjacent same-lithology segments is on by default per owner directive 2026-05-25; and the non-normalised option uses the Robertson 2010 index when the effective-stress profile is unreliable, leaving relative density and NAD packing blank because those need effective stress. Classification is a characterisation output within MVP scope. Methods: Robertson (2015) normalised pipeline and Robertson (2010) non-normalised index.

.. CG-EXPLANATION-END id=class:LithoSuggestionRequest

Method ``LithoSuggestionRequest``. ``def _exactly_one_anchor``
--------------------------------------------------------------

.. CG-BLOCK id=method:LithoSuggestionRequest._exactly_one_anchor lines=86-93

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_suggestion/litho_suggestion_request.py
   :language: python
   :lines: 86-93
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoSuggestionRequest._exactly_one_anchor

**What this does.** Rejects the request unless exactly one of the CPT id or the borehole id is set.

**Why it is here.** The segmenter reads one investigation, so an ambiguous or empty target is caught at the boundary with a ``422`` and never reaches the use case. This one-anchor rule recurs across the accept schemas below.

.. CG-EXPLANATION-END id=method:LithoSuggestionRequest._exactly_one_anchor

