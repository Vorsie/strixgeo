desktop.renderer.src.utils.formatNadClass
=========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/formatNadClass.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/formatNadClass.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/renderer/src/utils/formatNadClass.ts
   :language: typescript
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This whole file is one small helper that turns a NAD packing-class value into the short text shown in the ghost-layer tooltip. The comment explains the two kinds of value it may receive: a *range* like (3, 7), meaning the segments that were merged together spanned packing classes 3 through 7, or a *single* class number like 5 for a layer that was never merged. The comment sets the precedence: a range wins when it is present, the single value is the fallback, and the answer is nothing at all when neither is available.

**Why it is here.** This is a *formatter* — a small function whose only job is to turn a value into display text — and it is written as a *pure function*: its answer depends only on the two values passed in, it changes nothing outside itself, and calling it twice with the same inputs always gives the same text, which makes it safe to call on every redraw and easy to test. The NAD packing class it formats is a Belgian-annex packing class (NBN EN 1997-1 ANB Tabel 2.1); the platform treats it as a *characterisation output* the engineer reads and verifies, never as a design number, so this file only ever renders the class as a label — it does no soil-mechanics calculation. The comment records why two shapes exist: the segmenter's merge pass (tracked as debt #119) can fold several Robertson segments into one ghost layer, and when it does the constituent classes may differ, so a range must be shown; un-merged and borehole-path layers carry only a single class number.

.. CG-EXPLANATION-END id=module-header

``function formatNadClass``
---------------------------

.. CG-BLOCK id=function:formatNadClass lines=22-32

.. literalinclude:: ../../../desktop/src/renderer/src/utils/formatNadClass.ts
   :language: typescript
   :lines: 22-32
   :lineno-match:

.. CG-EXPLANATION-START id=function:formatNadClass

**What this does.** Given a range and a single value (either of which may be missing), it builds the label. If a range is present it reads out its low and high ends: when they are equal it prints one class, like "NAD 5"; when they differ it prints both with a dash, like "NAD 1–3". If there is no range but there is a single number, it prints that one class. If neither is present it returns nothing (``null``), which tells the caller to draw no NAD label at all.

**Why it is here.** The order of the checks encodes the precedence stated in the file comment — range first, single value as fallback, nothing when both are absent. Returning nothing rather than an empty or placeholder label is deliberate: non-sand and borehole-observation layers have no Robertson packing zone, and for those the tooltip should simply omit the NAD line rather than show a blank one.

.. CG-EXPLANATION-END id=function:formatNadClass

