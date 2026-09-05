desktop.renderer.src.components.ui.NumericInput
===============================================

.. CG-PAGE source=desktop/src/renderer/src/components/ui/NumericInput.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/ui/NumericInput.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-37

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/NumericInput.tsx
   :language: tsx
   :lines: 1-37
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening comment and its one import. The comment explains that this is a number-entry box that accepts both a dot and a comma as the decimal mark no matter the machine's language setting, gives three reasons the browser's built-in number box was rejected, and describes the behaviour: display uses the machine's own decimal mark, typing accepts either mark, letters and stray symbols are blocked, minus signs are refused unless opted in, and a half-typed value is preserved while the field is focused. It imports the ``useState`` hook and an input-attributes type.

**Why it is here.** The custom box exists because the browser's built-in number field mishandles the decimal mark across languages — a Belgian engineer on a US-configured machine could not type ``0,3`` — and it reports an empty value mid-typing, which breaks a controlled field. Because the stored value stays a plain number, a project file written on one machine opens cleanly on another; the display mark is only a presentation choice. This is a shared UI primitive in the sense introduced on the ``desktop.renderer.src.components.ui.Button`` page.

.. CG-EXPLANATION-END id=module-header

``const OS_DECIMAL_SEPARATOR``
------------------------------

.. CG-BLOCK id=const:OS_DECIMAL_SEPARATOR lines=38-49

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/NumericInput.tsx
   :language: tsx
   :lines: 38-49
   :lineno-match:

.. CG-EXPLANATION-START id=const:OS_DECIMAL_SEPARATOR

**What this does.** Works out, once when the file loads, whether the machine's language shows a comma or a dot as the decimal mark, and remembers that single character (falling back to a dot if it cannot tell).

**Why it is here.** This is computed just once because it never changes during a session, and it is used only for showing numbers — both marks are always accepted for typing. Detecting it lets a Belgian user see ``0,3`` and a US user see ``0.3`` from the very same stored number.

.. CG-EXPLANATION-END id=const:OS_DECIMAL_SEPARATOR

``function formatNumericForDisplay``
------------------------------------

.. CG-BLOCK id=function:formatNumericForDisplay lines=50-61

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/NumericInput.tsx
   :language: tsx
   :lines: 50-61
   :lineno-match:

.. CG-EXPLANATION-START id=function:formatNumericForDisplay

**What this does.** A small *formatter* — a pure function that turns a value into display text — that renders a number using the machine's decimal mark, no thousands grouping, up to six decimals, and returns an empty string for a non-finite number.

**Why it is here.** Returning empty for a broken value keeps the field from showing the word "NaN" when an external value arrives malformed. A *pure function* like this depends only on its input, so it is safe to call on every redraw.

.. CG-EXPLANATION-END id=function:formatNumericForDisplay

``interface NumericParseOptions``
---------------------------------

.. CG-BLOCK id=interface:NumericParseOptions lines=62-90

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/NumericInput.tsx
   :language: tsx
   :lines: 62-90
   :lineno-match:

.. CG-EXPLANATION-START id=interface:NumericParseOptions

**What this does.** A one-field options shape with ``allowNegative``, which defaults to off.

**Why it is here.** Negative values are off by default so a field for a quantity that physically cannot go below its reference — a ratio, a depth measured down from its own collar — refuses a minus without extra code. The comment records the owner ruling of 2026-08-23 that a water depth can be negative offshore, where the water stands above the collar, which is exactly the case where a caller turns this on.

.. CG-EXPLANATION-END id=interface:NumericParseOptions

``function tryParseNumeric``
----------------------------

.. CG-BLOCK id=function:tryParseNumeric lines=91-116

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/NumericInput.tsx
   :language: tsx
   :lines: 91-116
   :lineno-match:

.. CG-EXPLANATION-START id=function:tryParseNumeric

**What this does.** Turns a string the user typed into a number, or returns nothing when the string is empty, malformed, or contains both a comma and a dot. It trims the text, rejects mixed marks, swaps a comma for a dot, checks the text against a strict shape (optional leading minus only when allowed, digits, at most one dot), refuses a string with no digit at all, and finally converts what remains.

**Why it is here.** Rejecting both marks together treats ``1.2,3`` as a paste-in typo rather than a language ambiguity. Accepting a half-typed ``0,`` as ``0`` lets the parent value follow along as the user types past the mark, while a lone minus or dot yields nothing so the stored value does not jump to meet an unfinished entry. The strict shape blocks scientific notation, hex and pasted currency — only a plain decimal number gets through.

.. CG-EXPLANATION-END id=function:tryParseNumeric

``const ALLOWED_NAV_KEYS``
--------------------------

.. CG-BLOCK id=const:ALLOWED_NAV_KEYS lines=117-130

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/NumericInput.tsx
   :language: tsx
   :lines: 117-130
   :lineno-match:

.. CG-EXPLANATION-START id=const:ALLOWED_NAV_KEYS

**What this does.** A set of keyboard keys that are let through even though they are not digits or marks — Backspace, Delete, Tab, Enter, Escape, the arrows, Home and End.

**Why it is here.** The keystroke filter blocks anything that is not part of a number, so the editing and navigation keys must be listed as explicit exceptions or the field would become impossible to correct.

.. CG-EXPLANATION-END id=const:ALLOWED_NAV_KEYS

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=131-149

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/NumericInput.tsx
   :language: tsx
   :lines: 131-149
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Lists the box's inputs: the committed ``value`` (a plain number the parent owns), an ``onChange`` fired whenever the typed text becomes a valid number, an optional ``invalid`` flag for out-of-range styling, and the opt-in ``allowNegative``. It inherits standard input attributes but hides the ones it manages itself.

**Why it is here.** The box parses and reports whatever parses, and leaves the min/max judgement to the parent, which styles the field via ``invalid`` — so range rules live with the field's owner while this primitive stays reusable. Hiding the input's own ``value``, ``onChange`` and ``type`` prevents a caller from wiring them in a way that would fight the box's locale handling.

.. CG-EXPLANATION-END id=interface:Props

``function NumericInput``
-------------------------

.. CG-BLOCK id=function:NumericInput lines=150-250

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/NumericInput.tsx
   :language: tsx
   :lines: 150-250
   :lineno-match:

.. CG-EXPLANATION-START id=function:NumericInput

**What this does.** The component. It keeps one piece of *state* — a ``draft`` string that is empty except while the user is editing — and shows either that draft or the formatted committed value. Its keystroke handler lets modifier combos, navigation keys and digits through, allows only the first decimal mark, allows a minus only when opted in and not already present, and blocks everything else. On each change it stores the draft and, if it parses, reports the number up. On focus it seeds the draft from the current value; on blur it clears the draft so the display re-derives cleanly. It draws a plain text input wired to these handlers.

**Why it is here.** The draft is refreshed on focus and cleared on blur rather than kept in step by an effect, which the comment notes removes a whole class of value-versus-draft feedback-loop bugs: while the field is focused the user's exact typing wins, and when it is not focused an external change to the value shows through. The keystroke filter only governs which characters may appear; where a minus lands is left to the parser, so a misplaced one can be typed but never commits.

.. CG-EXPLANATION-END id=function:NumericInput

