desktop.renderer.src.utils.partialMatch
=======================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partialMatch.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partialMatch.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partialMatch.ts
   :language: typescript
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening docstring. This file is a pure ranking utility that reorders a list of stratigraphy names by how well they match what the user typed, so a candidate is easy to find. It never removes a name — every name gets a score, even zero.

**Why it is here.** The docstring records the owner directive (2026-05-17): the system must not decide that two names are the same unit; ranking only reorders and never removes anything; and there are no seeds, default rules, or auto-alias library. The caller always shows the full list so the user can still hand-pick a zero-score name into a group whose synonymy the string maths cannot know.

.. CG-EXPLANATION-END id=module-header

``const NOISE_TOKENS``
----------------------

.. CG-BLOCK id=const:NOISE_TOKENS lines=24-47

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partialMatch.ts
   :language: typescript
   :lines: 24-47
   :lineno-match:

.. CG-EXPLANATION-START id=const:NOISE_TOKENS

**What this does.** A set of short Dutch and English filler words — van, de, het, tot, m — that are thrown away before the word-overlap scoring.

**Why it is here.** The comment records that these appear in nearly every formation name and would falsely inflate the word-overlap between unrelated names; bare numbers are dropped too, and a Set is used for instant membership checks in the hot filtering path.

.. CG-EXPLANATION-END id=const:NOISE_TOKENS

``function _normalise``
-----------------------

.. CG-BLOCK id=function:_normalise lines=48-59

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partialMatch.ts
   :language: typescript
   :lines: 48-59
   :lineno-match:

.. CG-EXPLANATION-START id=function:_normalise

**What this does.** Cleans a string for matching: it strips accents, lower-cases, collapses every run of non-letter/non-digit characters to a single space, and trims.

**Why it is here.** The docstring records that it mirrors the engine's own normalisation, and that stripping accents is the main reason a spelling like "holoceen" matches "holocene" — the accents on the Dutch variants disappear.

.. CG-EXPLANATION-END id=function:_normalise

``function _tokens``
--------------------

.. CG-BLOCK id=function:_tokens lines=60-69

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partialMatch.ts
   :language: typescript
   :lines: 60-69
   :lineno-match:

.. CG-EXPLANATION-START id=function:_tokens

**What this does.** Splits a cleaned string into its meaningful words, dropping empties, the filler words, and bare numbers.

**Why it is here.** It feeds the word-overlap measure with only the distinguishing words.

.. CG-EXPLANATION-END id=function:_tokens

``function _jaccardTokens``
---------------------------

.. CG-BLOCK id=function:_jaccardTokens lines=70-90

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partialMatch.ts
   :language: typescript
   :lines: 70-90
   :lineno-match:

.. CG-EXPLANATION-START id=function:_jaccardTokens

**What this does.** Measures word-set overlap: the count of shared words divided by the count of all distinct words across both; zero when both are empty.

**Why it is here.** It captures how many meaningful words two names have in common.

.. CG-EXPLANATION-END id=function:_jaccardTokens

``function _diceBigrams``
-------------------------

.. CG-BLOCK id=function:_diceBigrams lines=91-116

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partialMatch.ts
   :language: typescript
   :lines: 91-116
   :lineno-match:

.. CG-EXPLANATION-START id=function:_diceBigrams

**What this does.** Measures character-pair overlap between two strings (the Dice coefficient over adjacent-letter pairs); zero for strings shorter than two characters.

**Why it is here.** The docstring records that this is the fuzzy tie-breaker that catches spelling variants like "holoceen" and "holocene", which share most letter-pairs even when their word sets are identical.

.. CG-EXPLANATION-END id=function:_diceBigrams

``interface RankedName``
------------------------

.. CG-BLOCK id=interface:RankedName lines=117-162

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partialMatch.ts
   :language: typescript
   :lines: 117-162
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RankedName

**What this does.** A candidate name paired with its match score between 0 and 1, where higher is a better match.

**Why it is here.** The docstring records that a score of zero does NOT mean the candidate was filtered out — it is still returned, and the caller must never hide zero-score items from the user.

.. CG-EXPLANATION-END id=interface:RankedName

``function rankByPartialMatch``
-------------------------------

.. CG-BLOCK id=function:rankByPartialMatch lines=163-204

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partialMatch.ts
   :language: typescript
   :lines: 163-204
   :lineno-match:

.. CG-EXPLANATION-START id=function:rankByPartialMatch

**What this does.** Scores every candidate name against the query and returns them all, sorted best-first with ties broken by name. The score is a fixed weighted blend of three signals: containment (weight 0.50) — one string is a substring of the other; word-set overlap (weight 0.30); and character-pair overlap (weight 0.20).

**Why it is here.** The docstring records that it never removes any entry — the reorder-never-filter rule is load-bearing so the user can hand-pick a zero-score synonym into a group the string maths cannot recognise — and that containment is the strongest signal for the common "I know how the name starts" case. The stable secondary sort by name keeps equal-score items in a predictable order.

.. CG-EXPLANATION-END id=function:rankByPartialMatch

