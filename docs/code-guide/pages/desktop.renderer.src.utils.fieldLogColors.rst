desktop.renderer.src.utils.fieldLogColors
=========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/fieldLogColors.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/fieldLogColors.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-12

.. literalinclude:: ../../../desktop/src/renderer/src/utils/fieldLogColors.ts
   :language: typescript
   :lines: 1-12
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment describing the categorical colours for the borehole log's field-log track, which has three sub-stripes: the driller's observed soil colour, the moisture, and the consistency.

**Why it is here.** The comment records that DOV uses Dutch compound words for colour so the code parses the first colour token and picks a representative hue, and — importantly — that the colours are visual cues only while the literal source-vocabulary value is always shown in the cell, so the exact original string is never lost (the translate-at-the-presentation-boundary rule).

.. CG-EXPLANATION-END id=module-header

``const COLOR_KEYWORDS``
------------------------

.. CG-BLOCK id=const:COLOR_KEYWORDS lines=13-34

.. literalinclude:: ../../../desktop/src/renderer/src/utils/fieldLogColors.ts
   :language: typescript
   :lines: 13-34
   :lineno-match:

.. CG-EXPLANATION-START id=const:COLOR_KEYWORDS

**What this does.** A small table mapping Dutch base-colour words (brown, green, grey, red, yellow, black, white, blue) to representative hex colours.

**Why it is here.** These base hues are what a compound word like "greenish-brown" is reduced to for the stripe; keeping them in one table means every colour parse uses the same hues.

.. CG-EXPLANATION-END id=const:COLOR_KEYWORDS

``function fieldColorFill``
---------------------------

.. CG-BLOCK id=function:fieldColorFill lines=35-46

.. literalinclude:: ../../../desktop/src/renderer/src/utils/fieldLogColors.ts
   :language: typescript
   :lines: 35-46
   :lineno-match:

.. CG-EXPLANATION-START id=function:fieldColorFill

**What this does.** Picks a hex colour for a DOV soil-colour string: it lowercases the value and returns the hue of the first base-colour keyword it finds, or a neutral grey for empty or unrecognised input.

**Why it is here.** The docstring records that matching the first keyword in a compound word is close enough for a visual stripe, and that the literal string is also shown in the cell so the exact source value is not lost.

.. CG-EXPLANATION-END id=function:fieldColorFill

``function moistureFill``
-------------------------

.. CG-BLOCK id=function:moistureFill lines=47-59

.. literalinclude:: ../../../desktop/src/renderer/src/utils/fieldLogColors.ts
   :language: typescript
   :lines: 47-59
   :lineno-match:

.. CG-EXPLANATION-START id=function:moistureFill

**What this does.** Maps DOV moisture words to a dry-to-wet colour gradient: dry to a sandy yellow, weakly moist to a light blue, moist to a mid blue, wet to a deep blue, and grey for anything else.

**Why it is here.** The docstring records the intent — a wetness gradient — so the stripe reads intuitively from dry to wet.

.. CG-EXPLANATION-END id=function:moistureFill

``function consistencyFill``
----------------------------

.. CG-BLOCK id=function:consistencyFill lines=60-68

.. literalinclude:: ../../../desktop/src/renderer/src/utils/fieldLogColors.ts
   :language: typescript
   :lines: 60-68
   :lineno-match:

.. CG-EXPLANATION-START id=function:consistencyFill

**What this does.** Maps DOV consistency words to a soft-to-hard colour gradient: soft to a pale tone, moderate to tan, firm to brown, hard to dark brown, and grey for anything else.

**Why it is here.** The docstring records the intent — a hardness gradient — so the stripe reads intuitively from soft to hard.

.. CG-EXPLANATION-END id=function:consistencyFill

