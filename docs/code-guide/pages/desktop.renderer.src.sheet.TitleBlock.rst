desktop.renderer.src.sheet.TitleBlock
=====================================

.. CG-PAGE source=desktop/src/renderer/src/sheet/TitleBlock.tsx complete=true

*Source file:* ``desktop/src/renderer/src/sheet/TitleBlock.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-3

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/TitleBlock.tsx
   :language: tsx
   :lines: 1-3
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the ``SheetField`` type (a label plus a value) and carries a one-line comment saying this file draws the four-field title block and that the field labels are the engineer's own.

**Why it is here.** A *type* here is just the agreed shape of one title-block field: a label and a value. Importing it keeps this file honest about what it is handed. The comment records that the labels are editable by the engineer, mimicking the four blank fields of the DOV length-profile sheet the owner asked to copy.

.. CG-EXPLANATION-END id=module-header

``function TitleBlock``
-----------------------

.. CG-BLOCK id=function:TitleBlock lines=4-18

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/TitleBlock.tsx
   :language: tsx
   :lines: 4-18
   :lineno-match:

.. CG-EXPLANATION-START id=function:TitleBlock

**What this does.** Draws the title box: a bordered block of a given height, split into four equal rows. For each of the four fields it shows the small uppercase label above the value; a divider line separates the first three rows, and a long value is cut off with an ellipsis rather than wrapping.

**Why it is here.** This is the four-field block (Project / Profile / Client / Date - Author by default) the owner wanted, imitating the DOV length-profile layout. Fixed equal rows and clipped values keep the box a tidy, predictable size on paper no matter how much text an engineer types.

.. CG-EXPLANATION-END id=function:TitleBlock

