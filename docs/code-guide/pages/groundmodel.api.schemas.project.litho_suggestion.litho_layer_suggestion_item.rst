groundmodel.api.schemas.project.litho_suggestion.litho_layer_suggestion_item
============================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_suggestion/litho_layer_suggestion_item.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_suggestion/litho_layer_suggestion_item.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-18

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_suggestion/litho_layer_suggestion_item.py
   :language: python
   :lines: 1-18
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports UUID and Pydantic, re-exports the shared admixture shape for backward compatibility, and imports the base-lithology and confidence vocabularies.

**Why it is here.** The comment records that the admixture shape now lives in one shared file (it also serves the propagation request family) and is only re-exported here so older import paths still resolve — the don't-repeat rule with a compatibility bridge.

.. CG-EXPLANATION-END id=module-header

Class ``LithoLayerSuggestionItem``
----------------------------------

.. CG-BLOCK id=class:LithoLayerSuggestionItem lines=19-84

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_suggestion/litho_layer_suggestion_item.py
   :language: python
   :lines: 19-84
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoLayerSuggestionItem

**What this does.** One suggested layer from the segmenter: its top and base depth, base lithology, an optional NAD packing class, mean cone resistance and relative density (for clean sand), a confidence level, a provenance string, any aggregated admixtures, the parent formation, a flag for crossing a formation boundary, and the NAD class range across merged segments.

**Why it is here.** Each field's meaning is documented in the docstring. The NAD packing class and relative density are CPT-derived characterisation outputs (MVP), left blank for lithologies where a borehole is needed to confirm them; the class is bounded 1–31. The Phase-1 additions are all optional/defaulted so pre-Phase-1 clients still work (additive-only). The spans-boundary flag drives an amber warning border in the desktop because such a layer would be split in two on accept. Method: Robertson (2015) for the CPT path (source token ``cpt_robertson_2015``).

.. CG-EXPLANATION-END id=class:LithoLayerSuggestionItem

