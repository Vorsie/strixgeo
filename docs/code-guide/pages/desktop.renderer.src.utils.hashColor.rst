desktop.renderer.src.utils.hashColor
====================================

.. CG-PAGE source=desktop/src/renderer/src/utils/hashColor.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/hashColor.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../desktop/src/renderer/src/utils/hashColor.ts
   :language: typescript
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file makes a stable colour from a text token by hashing it — a *hash colour*: it turns text into a number and maps that number to a fixed colour. The comment explains it is used when an arbitrary string (a formation name, a drill method, an observation kind) needs a colour without shipping a hand-made palette for every possible token, and that the same string always yields the same colour across reloads and machines. It notes the returned form is a hex string usable by backends and colour inputs, and that the hash used is DJB2, chosen as fast and stable with no collision worry at the few dozen tokens a project sees.

**Why it is here.** The reason is recorded in the comment: a curated colour per token is impossible for open-ended text, so a deterministic hash gives every token a consistent colour for free, and DJB2 is more than good enough at this small cardinality.

.. CG-EXPLANATION-END id=module-header

``function djb2Hash``
---------------------

.. CG-BLOCK id=function:djb2Hash lines=17-25

.. literalinclude:: ../../../desktop/src/renderer/src/utils/hashColor.ts
   :language: typescript
   :lines: 17-25
   :lineno-match:

.. CG-EXPLANATION-START id=function:djb2Hash

**What this does.** Computes the DJB2 hash of a string: it starts from a fixed seed and, for each character, mixes the running value with the character's code, returning the absolute value of the result.

**Why it is here.** This is the standard DJB2 algorithm — a small, fast, well-spread hash — that turns arbitrary text into a repeatable number to derive the colour from.

.. CG-EXPLANATION-END id=function:djb2Hash

``function hashHexColor``
-------------------------

.. CG-BLOCK id=function:hashHexColor lines=26-32

.. literalinclude:: ../../../desktop/src/renderer/src/utils/hashColor.ts
   :language: typescript
   :lines: 26-32
   :lineno-match:

.. CG-EXPLANATION-START id=function:hashHexColor

**What this does.** Produces a stable hex colour for a token: it hashes the string, folds the hash into a hue from 0 to 359, and converts that hue (at a fixed saturation and lightness) to a hex string.

**Why it is here.** Varying only the hue while fixing saturation and lightness keeps every generated colour at a similar, readable vividness, so different tokens are distinguishable without any becoming too pale or too harsh. As a *pure function* whose output depends only on its input, the same token always gets the same colour — the memo-cache rule for per-frame pure functions applies to callers that call it inside a render loop, though the memoisation lives with the caller, not here.

.. CG-EXPLANATION-END id=function:hashHexColor

``function hslToHex``
---------------------

.. CG-BLOCK id=function:hslToHex lines=33-66

.. literalinclude:: ../../../desktop/src/renderer/src/utils/hashColor.ts
   :language: typescript
   :lines: 33-66
   :lineno-match:

.. CG-EXPLANATION-START id=function:hslToHex

**What this does.** Converts a hue/saturation/lightness colour into a six-digit hex string using the standard formula, working out the red, green and blue components for the hue's sector and rounding each to a two-digit hex byte.

**Why it is here.** The palette is reasoned about in hue/saturation/lightness because that is where "vary only the hue" is natural, but the output must be a hex string for storage and colour inputs, so this is the standard conversion between the two.

.. CG-EXPLANATION-END id=function:hslToHex

