desktop.renderer.src.shell.stages.data.dataInspectorVirtualList
===============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/data/dataInspectorVirtualList.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/data/dataInspectorVirtualList.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-27

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/dataInspectorVirtualList.tsx
   :language: tsx
   :lines: 1-27
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and imports React hooks plus the ``List`` from the ``react-window`` library. The docstring explains this is the windowed row list behind the Data inspector's CPT and borehole tabs.

**Why it is here.** A project can hold thousands of CPTs, and drawing one on-screen row per test made the inspector stutter at around five thousand. This wraps ``react-window`` so only the rows in and just around the visible window are actually built — a technique called *virtualisation* or *windowing*; the rest stay virtual until scrolled into view. It was split out of ``DataInspector.tsx`` because that file is already well past the 500-line 'god component' size (debt #201), and the windowing wiring is the reusable part.

.. CG-EXPLANATION-END id=module-header

``const DATA_ROW_HEIGHT``
-------------------------

.. CG-BLOCK id=const:DATA_ROW_HEIGHT lines=28-36

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/dataInspectorVirtualList.tsx
   :language: tsx
   :lines: 28-36
   :lineno-match:

.. CG-EXPLANATION-START id=const:DATA_ROW_HEIGHT

**What this does.** The fixed height of one inspector row, 52 pixels.

**Why it is here.** The docstring explains a row is a two-line card about 50 pixels tall, set a little higher so rows never overlap and clip the second (depth) line; the sliver of surface between rows is invisible. Windowing needs a fixed row height so it can place rows without measuring each one.

.. CG-EXPLANATION-END id=const:DATA_ROW_HEIGHT

``const DATA_LIST_DEFAULT_HEIGHT``
----------------------------------

.. CG-BLOCK id=const:DATA_LIST_DEFAULT_HEIGHT lines=37-39

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/dataInspectorVirtualList.tsx
   :language: tsx
   :lines: 37-39
   :lineno-match:

.. CG-EXPLANATION-START id=const:DATA_LIST_DEFAULT_HEIGHT

**What this does.** The list height, 600 pixels, that ``react-window`` assumes before it has measured its container.

**Why it is here.** The docstring notes this only governs the very first paint — the library measures the real height at runtime — and the test environment, whose size observer is a do-nothing stub, so there this value alone decides the window.

.. CG-EXPLANATION-END id=const:DATA_LIST_DEFAULT_HEIGHT

``type FlatVirtualRow``
-----------------------

.. CG-BLOCK id=type:FlatVirtualRow lines=40-62

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/dataInspectorVirtualList.tsx
   :language: tsx
   :lines: 40-62
   :lineno-match:

.. CG-EXPLANATION-START id=type:FlatVirtualRow

**What this does.** The type for one entry in the flattened list: either a data row (carrying its item and a 'hidden' flag) or the single hidden-group divider (carrying a count).

**Why it is here.** Flattening both visual groups into one list of entries lets a single fixed-height window cover the visible rows, the divider and the hidden rows all together.

.. CG-EXPLANATION-END id=type:FlatVirtualRow

``function buildFlatRows``
--------------------------

.. CG-BLOCK id=function:buildFlatRows lines=63-76

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/dataInspectorVirtualList.tsx
   :language: tsx
   :lines: 63-76
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildFlatRows

**What this does.** Flattens the visible and hidden groups into one array — the visible rows, then a divider entry if there are any hidden rows, then the hidden rows.

**Why it is here.** It reproduces the exact order the old non-windowed list drew in, so the windowed version looks identical.

.. CG-EXPLANATION-END id=function:buildFlatRows

``interface VirtualRowData``
----------------------------

.. CG-BLOCK id=interface:VirtualRowData lines=77-86

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/dataInspectorVirtualList.tsx
   :language: tsx
   :lines: 77-86
   :lineno-match:

.. CG-EXPLANATION-START id=interface:VirtualRowData

**What this does.** The bundle of data ``react-window`` hands to every row it draws: the flattened entries plus the two functions that render a data row and the divider.

**Why it is here.** The comment explains the item type is left as ``unknown`` here because the library's list cannot carry the caller's own *generic* type (a type left blank to be filled per use) through it; the public list restores the exact type at its edge.

.. CG-EXPLANATION-END id=interface:VirtualRowData

``function VirtualRow``
-----------------------

.. CG-BLOCK id=function:VirtualRow lines=87-103

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/dataInspectorVirtualList.tsx
   :language: tsx
   :lines: 87-103
   :lineno-match:

.. CG-EXPLANATION-START id=function:VirtualRow

**What this does.** Draws one windowed slot. ``react-window`` supplies the absolute position, the height and the accessibility attributes; this function fills in the content — the divider when the entry is a separator, otherwise the data row.

**Why it is here.** It is the single row template the library calls for whichever entries are currently on screen.

.. CG-EXPLANATION-END id=function:VirtualRow

``interface VirtualRowListProps``
---------------------------------

.. CG-BLOCK id=interface:VirtualRowListProps lines=104-124

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/dataInspectorVirtualList.tsx
   :language: tsx
   :lines: 104-124
   :lineno-match:

.. CG-EXPLANATION-START id=interface:VirtualRowListProps

**What this does.** The props of the public list: the visible rows, the hidden rows, a function giving each item a stable key, a function to render one row, and a function to render the 'N hidden' divider.

**Why it is here.** It keeps the windowing generic — the caller supplies the item type and how to draw a row, so the same list serves both the CPT and the borehole tab.

.. CG-EXPLANATION-END id=interface:VirtualRowListProps

``function VirtualRowList``
---------------------------

.. CG-BLOCK id=function:VirtualRowList lines=125-164

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/dataInspectorVirtualList.tsx
   :language: tsx
   :lines: 125-164
   :lineno-match:

.. CG-EXPLANATION-START id=function:VirtualRowList

**What this does.** The public windowed list. It flattens the visible and hidden rows with ``useMemo``, builds a stable key-lookup with ``useCallback``, and renders ``react-window``'s ``List`` filling the parent's height, with the fixed row height and eight extra rows drawn just off-screen.

**Why it is here.** The comments note the key function is called during drawing, so it must be a stable reference; the 100% height lets the library measure the real pixel height at runtime; and keyboard selection, testids and hover all live in the caller's row output, so windowing changes none of them.

.. CG-EXPLANATION-END id=function:VirtualRowList

