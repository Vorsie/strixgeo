desktop.renderer.src.i18n.interpolateSlot
=========================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/interpolateSlot.tsx complete=true

*Source file:* ``desktop/src/renderer/src/i18n/interpolateSlot.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-33

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/interpolateSlot.tsx
   :language: tsx
   :lines: 1-33
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment and the one tool this file borrows. It introduces a small helper that takes a piece of message text containing a single ``{slot}`` marker and renders it with that marker replaced by a piece of on-screen content instead of by plain text. It brings in ``Fragment`` and the ``ReactNode`` type from React. (React is the library that builds the on-screen interface out of small reusable pieces; a piece is a component, written as a function that returns what to draw; the HTML-like markup inside a component is JSX; a "node" is any such drawable piece of interface; a ``Fragment`` is an invisible wrapper that groups several pieces without adding anything to the page.)

**Why it is here.** The comment explains the problem it solves. The ordinary translator ``t('key', { name })`` flattens a filled-in value down to plain text, which is right for a small message but wrong for a dialog title that wants the name shown in bold. A before-and-after pair of separate keys would restore the bold yet break for a language that places the name in the middle of the sentence — the comment gives the Dutch example "Contact bij {name} verwijderen?". Splitting the translated sentence on the literal ``{slot}`` marker keeps BOTH the bold styling AND each language's own word order.

.. CG-EXPLANATION-END id=module-header

``function interpolateSlot``
----------------------------

.. CG-BLOCK id=function:interpolateSlot lines=34-45

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/interpolateSlot.tsx
   :language: tsx
   :lines: 34-45
   :lineno-match:

.. CG-EXPLANATION-START id=function:interpolateSlot

**What this does.** The helper itself. It looks for the marker ``{slot}`` inside the template text; if the marker is not there it hands the text straight back unchanged; if it is there it returns the text before the marker, then the supplied node in the marker's place, then the text after it.

**Why it is here.** The docstring says to call it with the UN-filled template (``t('key')`` with no values) so the ``{slot}`` marker survives to be split here. Returning the template unchanged when the marker is missing is a safe fallback that keeps the label showing rather than crashing.

.. CG-EXPLANATION-END id=function:interpolateSlot

