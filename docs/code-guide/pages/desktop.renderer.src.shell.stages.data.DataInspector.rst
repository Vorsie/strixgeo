desktop.renderer.src.shell.stages.data.DataInspector
====================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/data/DataInspector.tsx complete=false

*Source file:* ``desktop/src/renderer/src/shell/stages/data/DataInspector.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-58

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 1-58
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=module-header

``type InspectorTab``
---------------------

.. CG-BLOCK id=type:InspectorTab lines=59-62

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 59-62
   :lineno-match:

.. CG-EXPLANATION-START id=type:InspectorTab

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=type:InspectorTab

``type SortKey``
----------------

.. CG-BLOCK id=type:SortKey lines=63-63

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 63-63
   :lineno-match:

.. CG-EXPLANATION-START id=type:SortKey

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=type:SortKey

``type SortDirection``
----------------------

.. CG-BLOCK id=type:SortDirection lines=64-65

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 64-65
   :lineno-match:

.. CG-EXPLANATION-START id=type:SortDirection

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=type:SortDirection

``interface SortState``
-----------------------

.. CG-BLOCK id=interface:SortState lines=66-73

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 66-73
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SortState

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:SortState

``interface DateRangeFilter``
-----------------------------

.. CG-BLOCK id=interface:DateRangeFilter lines=74-82

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 74-82
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DateRangeFilter

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=interface:DateRangeFilter

``const SORT_STORAGE_KEY``
--------------------------

.. CG-BLOCK id=const:SORT_STORAGE_KEY lines=83-83

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 83-83
   :lineno-match:

.. CG-EXPLANATION-START id=const:SORT_STORAGE_KEY

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:SORT_STORAGE_KEY

``const DEFAULT_SORT``
----------------------

.. CG-BLOCK id=const:DEFAULT_SORT lines=84-87

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 84-87
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_SORT

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:DEFAULT_SORT

``const DATE_FILTER_CPT_KEY``
-----------------------------

.. CG-BLOCK id=const:DATE_FILTER_CPT_KEY lines=88-88

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 88-88
   :lineno-match:

.. CG-EXPLANATION-START id=const:DATE_FILTER_CPT_KEY

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:DATE_FILTER_CPT_KEY

``const DATE_FILTER_BH_KEY``
----------------------------

.. CG-BLOCK id=const:DATE_FILTER_BH_KEY lines=89-89

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 89-89
   :lineno-match:

.. CG-EXPLANATION-START id=const:DATE_FILTER_BH_KEY

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:DATE_FILTER_BH_KEY

``const DEFAULT_DATE_FILTER``
-----------------------------

.. CG-BLOCK id=const:DEFAULT_DATE_FILTER lines=90-92

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 90-92
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_DATE_FILTER

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:DEFAULT_DATE_FILTER

``function parseSortState``
---------------------------

.. CG-BLOCK id=function:parseSortState lines=93-108

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 93-108
   :lineno-match:

.. CG-EXPLANATION-START id=function:parseSortState

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:parseSortState

``function parseDateFilter``
----------------------------

.. CG-BLOCK id=function:parseDateFilter lines=109-127

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 109-127
   :lineno-match:

.. CG-EXPLANATION-START id=function:parseDateFilter

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:parseDateFilter

``const NATURAL``
-----------------

.. CG-BLOCK id=const:NATURAL lines=128-145

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 128-145
   :lineno-match:

.. CG-EXPLANATION-START id=const:NATURAL

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=const:NATURAL

``function DataInspector``
--------------------------

.. CG-BLOCK id=function:DataInspector lines=146-690

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 146-690
   :lineno-match:

.. CG-EXPLANATION-START id=function:DataInspector

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:DataInspector

``function SortControl``
------------------------

.. CG-BLOCK id=function:SortControl lines=691-730

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 691-730
   :lineno-match:

.. CG-EXPLANATION-START id=function:SortControl

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:SortControl

``function makeCptSorter``
--------------------------

.. CG-BLOCK id=function:makeCptSorter lines=731-758

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 731-758
   :lineno-match:

.. CG-EXPLANATION-START id=function:makeCptSorter

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:makeCptSorter

``function makeBoreholeSorter``
-------------------------------

.. CG-BLOCK id=function:makeBoreholeSorter lines=759-790

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 759-790
   :lineno-match:

.. CG-EXPLANATION-START id=function:makeBoreholeSorter

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:makeBoreholeSorter

``function HiddenSeparator``
----------------------------

.. CG-BLOCK id=function:HiddenSeparator lines=791-804

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 791-804
   :lineno-match:

.. CG-EXPLANATION-START id=function:HiddenSeparator

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:HiddenSeparator

``function cptBadgeColor``
--------------------------

.. CG-BLOCK id=function:cptBadgeColor lines=805-817

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 805-817
   :lineno-match:

.. CG-EXPLANATION-START id=function:cptBadgeColor

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:cptBadgeColor

``function CptRow``
-------------------

.. CG-BLOCK id=function:CptRow lines=818-909

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 818-909
   :lineno-match:

.. CG-EXPLANATION-START id=function:CptRow

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:CptRow

``function BoreholeRow``
------------------------

.. CG-BLOCK id=function:BoreholeRow lines=910-1033

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 910-1033
   :lineno-match:

.. CG-EXPLANATION-START id=function:BoreholeRow

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:BoreholeRow

``function DateRangeControl``
-----------------------------

.. CG-BLOCK id=function:DateRangeControl lines=1034-1119

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 1034-1119
   :lineno-match:

.. CG-EXPLANATION-START id=function:DateRangeControl

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:DateRangeControl

``function EmptyState``
-----------------------

.. CG-BLOCK id=function:EmptyState lines=1120-1128

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 1120-1128
   :lineno-match:

.. CG-EXPLANATION-START id=function:EmptyState

.. CG-PLACEHOLDER

.. note::

   **Plain-English explanation not yet written.** This block still needs a
   "What this does" and "Why it is here" walkthrough in the plainest
   English possible.

.. CG-EXPLANATION-END id=function:EmptyState

