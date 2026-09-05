groundmodel.domain.services.nad_admixture_choice
================================================

.. CG-PAGE source=src/groundmodel/domain/services/nad_admixture_choice.py complete=true

*Source file:* ``src/groundmodel/domain/services/nad_admixture_choice.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-37

.. literalinclude:: ../../../src/groundmodel/domain/services/nad_admixture_choice.py
   :language: python
   :lines: 1-37
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces a small helper that runs the admixture prompt in the geotech stage. It imports the NAD packing-class threshold table, the classifier's own variant chooser, the admixture value object, and the base soil types, and defines the two answers the engineer can give (pure, or with-admixture).

**Why it is here.** The owner ruled (2026-09-04, quoted in the docstring) that where a unit carries an admixture the machine should ask the engineer which NAD family to use — pure sand or sand-with-admixture — rather than deciding silently. For some soils that is a real fork: a silty sand can be classified as clean sand or as silt-bearing sand, two different class ranges. This module decides which units carry such a fork and turns the stored answer into a forced classifier column, and it does so by reading the existing threshold table, never inventing new numbers.

.. CG-EXPLANATION-END id=module-header

Function ``def unit_admixture_is_ambiguous``
--------------------------------------------

.. CG-BLOCK id=function:unit_admixture_is_ambiguous lines=38-75

.. literalinclude:: ../../../src/groundmodel/domain/services/nad_admixture_choice.py
   :language: python
   :lines: 38-75
   :lineno-match:

.. CG-EXPLANATION-START id=function:unit_admixture_is_ambiguous

**What this does.** Decides whether the prompt must ask a given unit which NAD family to use. It returns true only when the classifier would pick the secondary column for this soil and admixtures AND the soil's clean and secondary columns actually differ.

**Why it is here.** Both conditions guard against asking a pointless question. If the soil has no qualifying secondary admixture there is no fork. And if the clean and secondary columns are identical there is nothing to choose — which is exactly what excludes peat, whose table gives it no separate with-admixture variant, and any soil the table does not know. The question is only ever raised when the answer genuinely changes the class.

.. CG-EXPLANATION-END id=function:unit_admixture_is_ambiguous

Function ``def resolve_admixture_variant``
------------------------------------------

.. CG-BLOCK id=function:resolve_admixture_variant lines=76-110

.. literalinclude:: ../../../src/groundmodel/domain/services/nad_admixture_choice.py
   :language: python
   :lines: 76-110
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolve_admixture_variant

**What this does.** Turns the stored answer into a forced classifier column: pure becomes the clean column, with-admixture becomes the secondary column, and anything else (unanswered, or an unrecognised old value) returns nothing, which tells the classifier to keep deciding for itself.

**Why it is here.** It is the one place the persisted choice binds the classifier, so the mapping lives in a single function. The soil and admixtures are accepted only to keep every call site uniform with the classifier's signature; the result depends solely on the stored choice.

.. CG-EXPLANATION-END id=function:resolve_admixture_variant

