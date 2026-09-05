groundmodel.infrastructure.exporters.section_unit_labels
========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/exporters/section_unit_labels.py complete=true

*Source file:* ``src/groundmodel/infrastructure/exporters/section_unit_labels.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-27

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/section_unit_labels.py
   :language: python
   :lines: 1-27
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's description and its imports: the ``UUID`` type, the section unit type, the ASCII-folding helper, the identifier builder, and the duplicate-suffix constant.

**Why it is here.** Both Deltares targets name their soils from a flat namespace that allows no duplicates — D-Stability keys a layer on a soil ``code``, D-Sheet Piling keys a profile layer on a soil ``name`` — but the identifier scheme is deliberately NOT unique (two NAD-6 sand units under different geological parents make the same token). So both exporters need the same disambiguation, which is the second concrete use, so it becomes one shared helper rather than a copy in each (CLAUDE.md ``don't repeat logic``). The functions are pure, with no logging.

.. CG-EXPLANATION-END id=module-header

Function ``def _base_label``
----------------------------

.. CG-BLOCK id=function:_base_label lines=28-50

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/section_unit_labels.py
   :language: python
   :lines: 28-50
   :lineno-match:

.. CG-EXPLANATION-START id=function:_base_label

**What this does.** Returns a unit's base export label before any disambiguation: its identifier token (``NAD-06_ZAND`` or ``ZAND``) when it has one, otherwise its raw user-typed name folded to plain ASCII.

**Why it is here.** A classified unit's token is already a closed-vocabulary ASCII string, so it passes straight through; only the fallback user name is folded, because that label becomes a soil name/code that Deltares parses back out of a cp1252 file — a non-ASCII name would be the same decode-on-Linux failure ``ascii_fold`` exists to stop. Folding HERE, before the caller numbers duplicates, means two names that fold to the same ASCII collide in one namespace and get the ordinal suffix, instead of silently minting two soils that look identical.

.. CG-EXPLANATION-END id=function:_base_label

Function ``def build_unit_labels``
----------------------------------

.. CG-BLOCK id=function:build_unit_labels lines=51-85

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/section_unit_labels.py
   :language: python
   :lines: 51-85
   :lineno-match:

.. CG-EXPLANATION-START id=function:build_unit_labels

**What this does.** Maps every unit to a unique export label. The label is the identifier token when the unit has one and the display name otherwise, and the second and later unit that claims an already-taken label gets an ordinal suffix (``NAD-06_ZAND #2``).

**Why it is here.** Callers pass the units in display order, so the top-most unit of a colliding pair keeps the clean, unsuffixed label. The guarantee the two exporters rely on is that every unit is present and every returned label is distinct — which is what lets each become one D-Stability soil or one D-Sheet profile layer without a name clash.

.. CG-EXPLANATION-END id=function:build_unit_labels

Function ``def label_collisions``
---------------------------------

.. CG-BLOCK id=function:label_collisions lines=86-110

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/section_unit_labels.py
   :language: python
   :lines: 86-110
   :lineno-match:

.. CG-EXPLANATION-START id=function:label_collisions

**What this does.** Counts, per base label, how many units claimed it, and returns only the labels claimed more than once.

**Why it is here.** The exporters log this so a collision shows up in the log, not only in the delivered file — an engineer who sees ``NAD-06_ZAND #2`` in D-Stability and does not know why has no other way to find which two units collided.

.. CG-EXPLANATION-END id=function:label_collisions

