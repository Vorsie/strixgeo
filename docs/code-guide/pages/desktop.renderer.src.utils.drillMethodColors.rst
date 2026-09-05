desktop.renderer.src.utils.drillMethodColors
============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/drillMethodColors.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/drillMethodColors.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-12

.. literalinclude:: ../../../desktop/src/renderer/src/utils/drillMethodColors.ts
   :language: typescript
   :lines: 1-12
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment introducing a *colour lookup* — a table that maps a text token to a fixed colour — for DOV drill-method tokens, used by the drill-method track in the borehole log.

**Why it is here.** The comment records that the tokens come from DOV's documented drill-method vocabulary (the project's DOV codelist memory), that the colours are purely categorical (only "different methods are easy to tell apart", no geological meaning), and that matching is case-insensitive and prefix-tolerant because DOV mixes Dutch spellings for the same physical method — the lookup normalises both to one colour.

.. CG-EXPLANATION-END id=module-header

``interface DrillMethodStyle``
------------------------------

.. CG-BLOCK id=interface:DrillMethodStyle lines=13-20

.. literalinclude:: ../../../desktop/src/renderer/src/utils/drillMethodColors.ts
   :language: typescript
   :lines: 13-20
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DrillMethodStyle

**What this does.** Describes the render style for one drill method: a fill colour and a short English label.

**Why it is here.** The comment records that the label is a short English legend name with the raw DOV token shown alongside it — the translate-at-the-presentation-boundary rule, so a domain expert can verify the mapping against the original token.

.. CG-EXPLANATION-END id=interface:DrillMethodStyle

``const DRILL_METHOD_COLORS``
-----------------------------

.. CG-BLOCK id=const:DRILL_METHOD_COLORS lines=21-36

.. literalinclude:: ../../../desktop/src/renderer/src/utils/drillMethodColors.ts
   :language: typescript
   :lines: 21-36
   :lineno-match:

.. CG-EXPLANATION-START id=const:DRILL_METHOD_COLORS

**What this does.** The lookup table itself: lowercased DOV tokens mapped to their fill colour and English label, with both Dutch spelling variants of each method pointing at the same entry.

**Why it is here.** Keeping the pairs of spellings on the same colour and label is what makes the two DOV variants of one physical method read identically on the log.

.. CG-EXPLANATION-END id=const:DRILL_METHOD_COLORS

``const FALLBACK``
------------------

.. CG-BLOCK id=const:FALLBACK lines=37-46

.. literalinclude:: ../../../desktop/src/renderer/src/utils/drillMethodColors.ts
   :language: typescript
   :lines: 37-46
   :lineno-match:

.. CG-EXPLANATION-START id=const:FALLBACK

**What this does.** The neutral grey style used when a token is not in the table.

**Why it is here.** So an unrecognised or missing method still renders (in grey) rather than breaking the track, while the missing token shows in the legend.

.. CG-EXPLANATION-END id=const:FALLBACK

``function drillMethodStyle``
-----------------------------

.. CG-BLOCK id=function:drillMethodStyle lines=47-51

.. literalinclude:: ../../../desktop/src/renderer/src/utils/drillMethodColors.ts
   :language: typescript
   :lines: 47-51
   :lineno-match:

.. CG-EXPLANATION-START id=function:drillMethodStyle

**What this does.** Resolves a drill-method token to its style: it returns the fallback for an empty token, otherwise trims and lowercases the token and looks it up, falling back when there is no match.

**Why it is here.** The docstring records that an unknown token is still rendered in neutral grey rather than dropped, and surfacing the missing token in the legend is how the team learns a new entry is needed.

.. CG-EXPLANATION-END id=function:drillMethodStyle

