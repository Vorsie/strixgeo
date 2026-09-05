desktop.renderer.src.shell.stages.data.DataInspector
====================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/data/DataInspector.tsx complete=true

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

**What this does.** Names the file and pulls in its tools. This is the Data stage's *inspector* — the 420-pixel panel on the right that lists the project's CPTs and boreholes. The imports bring in React's ``useEffect``, ``useMemo`` and ``useState`` *hooks*, a set of icons, the windowed row list (``VirtualRowList``), the shared shell bus (``useShell``), the shared empty-state block, a hook that saves a value to browser storage (``usePersistedJSON``), the dirty-marker and tab-bar widgets, keyboard and date helper functions, the list-item types, and the translation helper.

**Why it is here.** It lifts the CPT and borehole list out of the app's old flat ``Sidebar.tsx`` into the right-hand inspector rail of the staged shell. A *component* is a function that returns a piece of screen; a *hook* is a ``use…`` function that lets it remember values and run effects. The scope comment records what belongs here — on both the CPT and borehole tabs: the list, sort, search, multi-select, remove-from-project, restore, viewport demotion, and the amber markers for tests imported this session — and what does not: the sections tab (owned by the Sections inspector) and the interpretation tab (owned by the Stratigraphy stage). The row widgets and sort helpers were copied here and scoped to this file so the old ``Sidebar.tsx`` did not have to be deleted while other stages still read from it.

.. CG-EXPLANATION-END id=module-header

``type InspectorTab``
---------------------

.. CG-BLOCK id=type:InspectorTab lines=59-62

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 59-62
   :lineno-match:

.. CG-EXPLANATION-START id=type:InspectorTab

**What this does.** A *type* — a note about what kind of value is allowed — that says a tab is exactly either ``'cpt'`` or ``'borehole'``.

**Why it is here.** The Data inspector lists only investigations, so the tab is one of these two and nothing else. The comment notes this makes the two-way choices in the code below complete, with no need for a dead third fallback branch.

.. CG-EXPLANATION-END id=type:InspectorTab

``type SortKey``
----------------

.. CG-BLOCK id=type:SortKey lines=63-63

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 63-63
   :lineno-match:

.. CG-EXPLANATION-START id=type:SortKey

**What this does.** A type listing the four ways the list can be sorted: the default (import) order, by name, by depth, or by date.

**Why it is here.** It names the allowed sort choices in one place. The comment notes the date sort reads each test's start date and always pushes tests with no date to the bottom, so undated rows never interleave with dated ones.

.. CG-EXPLANATION-END id=type:SortKey

``type SortDirection``
----------------------

.. CG-BLOCK id=type:SortDirection lines=64-65

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 64-65
   :lineno-match:

.. CG-EXPLANATION-START id=type:SortDirection

**What this does.** A type saying a sort runs either ascending (``'asc'``) or descending (``'desc'``).

**Why it is here.** The direction pairs with the sort key so the little arrow button can flip the order.

.. CG-EXPLANATION-END id=type:SortDirection

``interface SortState``
-----------------------

.. CG-BLOCK id=interface:SortState lines=66-73

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 66-73
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SortState

**What this does.** An *interface* — a named shape for an object — describing the remembered sort: a key plus a direction.

**Why it is here.** It bundles the two sort settings into one value that can be saved and restored together.

.. CG-EXPLANATION-END id=interface:SortState

``interface DateRangeFilter``
-----------------------------

.. CG-BLOCK id=interface:DateRangeFilter lines=74-82

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 74-82
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DateRangeFilter

**What this does.** A named shape for the date-range filter: a ``from`` string and a ``to`` string, each an ISO ``YYYY-MM-DD`` date or an empty string meaning no bound is set.

**Why it is here.** The comment records that the strings match the value format of a native date input, and that the two tabs keep independent date windows.

.. CG-EXPLANATION-END id=interface:DateRangeFilter

``const SORT_STORAGE_KEY``
--------------------------

.. CG-BLOCK id=const:SORT_STORAGE_KEY lines=83-83

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 83-83
   :lineno-match:

.. CG-EXPLANATION-START id=const:SORT_STORAGE_KEY

**What this does.** The browser-storage key under which the chosen sort is saved.

**Why it is here.** It is the same key the old sidebar used, so the engineer's sort preference survives the move to the staged shell. Browser storage (``localStorage``) holds only per-user screen preferences like this — never an engineering decision, which rides the project bundle.

.. CG-EXPLANATION-END id=const:SORT_STORAGE_KEY

``const DEFAULT_SORT``
----------------------

.. CG-BLOCK id=const:DEFAULT_SORT lines=84-87

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 84-87
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_SORT

**What this does.** The starting sort used when nothing is saved: the default order, ascending.

**Why it is here.** A first-run fallback so the list always has a valid sort to apply.

.. CG-EXPLANATION-END id=const:DEFAULT_SORT

``const DATE_FILTER_CPT_KEY``
-----------------------------

.. CG-BLOCK id=const:DATE_FILTER_CPT_KEY lines=88-88

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 88-88
   :lineno-match:

.. CG-EXPLANATION-START id=const:DATE_FILTER_CPT_KEY

**What this does.** The browser-storage key for the CPT tab's date window.

**Why it is here.** Kept separate from the borehole key so each tab remembers its own date range.

.. CG-EXPLANATION-END id=const:DATE_FILTER_CPT_KEY

``const DATE_FILTER_BH_KEY``
----------------------------

.. CG-BLOCK id=const:DATE_FILTER_BH_KEY lines=89-89

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 89-89
   :lineno-match:

.. CG-EXPLANATION-START id=const:DATE_FILTER_BH_KEY

**What this does.** The browser-storage key for the borehole tab's date window.

**Why it is here.** Per-tab, mirroring how the multi-select is scoped to one tab, so switching tabs does not clobber the other tab's date range.

.. CG-EXPLANATION-END id=const:DATE_FILTER_BH_KEY

``const DEFAULT_DATE_FILTER``
-----------------------------

.. CG-BLOCK id=const:DEFAULT_DATE_FILTER lines=90-92

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 90-92
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_DATE_FILTER

**What this does.** The starting date filter: both bounds empty, meaning no date filtering.

**Why it is here.** A first-run fallback with no window set, so every test shows until the engineer sets a bound.

.. CG-EXPLANATION-END id=const:DEFAULT_DATE_FILTER

``function parseSortState``
---------------------------

.. CG-BLOCK id=function:parseSortState lines=93-108

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 93-108
   :lineno-match:

.. CG-EXPLANATION-START id=function:parseSortState

**What this does.** Reads a raw value that came back from browser storage and returns a valid ``SortState`` — but only when it has a string ``key`` and ``direction`` from the allowed lists; otherwise it falls back to the default.

**Why it is here.** It guards against a corrupt storage entry (a hand edit, or an old format from a past version) silently breaking the sort.

.. CG-EXPLANATION-END id=function:parseSortState

``function parseDateFilter``
----------------------------

.. CG-BLOCK id=function:parseDateFilter lines=109-127

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 109-127
   :lineno-match:

.. CG-EXPLANATION-START id=function:parseDateFilter

**What this does.** The same validation for the date filter — it accepts the stored value only when it has string ``from`` and ``to`` fields, otherwise it returns the empty default.

**Why it is here.** The same guard: a malformed stored date window must not misbehave; it is replaced with 'no filter'.

.. CG-EXPLANATION-END id=function:parseDateFilter

``const NATURAL``
-----------------

.. CG-BLOCK id=const:NATURAL lines=128-145

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 128-145
   :lineno-match:

.. CG-EXPLANATION-START id=const:NATURAL

**What this does.** A reusable string comparator built once when the file loads — numeric-aware and case-insensitive — so that, for example, ``CPT-2`` sorts before ``CPT-10`` rather than after it.

**Why it is here.** Building this kind of comparator is not cheap, so it is created a single time and shared (a memo cache of a pure comparator). That keeps the per-row comparisons cheap when the whole list is re-sorted on every keystroke or sort change.

.. CG-EXPLANATION-END id=const:NATURAL

``function DataInspector``
--------------------------

.. CG-BLOCK id=function:DataInspector lines=146-690

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 146-690
   :lineno-match:

.. CG-EXPLANATION-START id=function:DataInspector

**What this does.** The Data stage's inspector content. It reads the visible CPTs and boreholes, the remove and restore handlers, the current selection, the out-of-viewport and imported-this-session sets, and the map filters from the shared shell. It keeps in *state* (values a component remembers between redraws): the active tab, the saved sort, a per-tab saved date window, the set of rows ticked for removal, a range anchor, and the search text. From those it derives, for each tab, the filtered, partitioned and sorted lists — a VISIBLE group and a map-filter-HIDDEN group. It wires the checkbox toggling (including Shift-click to tick a range), select-all, clear, and bulk-remove, plus a Delete/Backspace shortcut that removes the ticked rows. It draws, top to bottom: the CPT/borehole tab bar, a search box, the date-range filter, a bulk-action bar (only when at least one row is ticked), a sort and select-all row, the windowed list of rows (visible rows, then a 'N hidden' divider, then the dimmed hidden rows), and a footer showing the count and a 'restore all' link.

**Why it is here.** This is the inspector the engineer uses to find, filter and prune the project's tests. The comments carry the reasons. The ticked set is kept in step with the map's rectangle (marquee) selection, so ticking on the map and in the list agree. The sort is shared across both tabs and saved to browser storage. The date windows are per-tab, and their cached lists depend only on the raw bound strings, not on freshly parsed date objects, so they recompute only when a bound actually changes. Crucially, 'Remove' uses a neutral button colour, NOT the danger red, because removing a test is a *reversible* project-local hide (the footer's 'restore all' brings them back) — the red is reserved for irreversible deletes. Rows hidden by a map filter drop to the bottom at reduced opacity but stay clickable. All of this list state is per-user screen chrome saved in browser storage; the engineering decisions themselves ride the project bundle, never storage alone.

.. CG-EXPLANATION-END id=function:DataInspector

``function SortControl``
------------------------

.. CG-BLOCK id=function:SortControl lines=691-730

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 691-730
   :lineno-match:

.. CG-EXPLANATION-START id=function:SortControl

**What this does.** The small sort UI: a dropdown to pick the sort key (default, name, depth, date) and a button that flips the direction between ascending and descending. The direction button is disabled while the key is 'default'.

**Why it is here.** The direction toggle is greyed out on the default order because there is nothing to reverse — the default is the import order, which has no ascending or descending sense.

.. CG-EXPLANATION-END id=function:SortControl

``function makeCptSorter``
--------------------------

.. CG-BLOCK id=function:makeCptSorter lines=731-758

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 731-758
   :lineno-match:

.. CG-EXPLANATION-START id=function:makeCptSorter

**What this does.** Builds the comparison function that orders the CPT list for a given sort setting: the default returns 'no change'; name uses the natural comparator; date compares parsed start dates; depth compares the maximum depth. A sign flips the result for the descending direction.

**Why it is here.** For both date and depth, tests with no value always sort to the bottom in both directions, so they never interleave with real values. The date path runs every date through the tolerant parser, so ISO, slash-separated and year-only file dates are all handled the same way.

.. CG-EXPLANATION-END id=function:makeCptSorter

``function makeBoreholeSorter``
-------------------------------

.. CG-BLOCK id=function:makeBoreholeSorter lines=759-790

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 759-790
   :lineno-match:

.. CG-EXPLANATION-START id=function:makeBoreholeSorter

**What this does.** The same comparator builder for boreholes — default, name, date, or total depth, with the direction sign applied. It accepts the borehole axis argument but does not currently use it.

**Why it is here.** Boreholes with no date or no depth sort last in both directions too, so they never mix in among the real values.

.. CG-EXPLANATION-END id=function:makeBoreholeSorter

``function HiddenSeparator``
----------------------------

.. CG-BLOCK id=function:HiddenSeparator lines=791-804

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 791-804
   :lineno-match:

.. CG-EXPLANATION-START id=function:HiddenSeparator

**What this does.** Draws the divider row that reads 'N hidden' with an eye-off icon, marking the start of the map-filter-hidden group in the list.

**Why it is here.** It tells the engineer that the dimmed rows below were pushed down by a map filter (or fell outside the current map view) rather than being removed from the project.

.. CG-EXPLANATION-END id=function:HiddenSeparator

``function cptBadgeColor``
--------------------------

.. CG-BLOCK id=function:cptBadgeColor lines=805-817

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 805-817
   :lineno-match:

.. CG-EXPLANATION-START id=function:cptBadgeColor

**What this does.** Maps a CPT type — CPTU, CPTE, CPTM, or anything else — to the colour classes for its small type badge, with a light and a dark variant for each.

**Why it is here.** It gives each cone type a consistent colour so the engineer can pick out the cone kind at a glance while scanning the list.

.. CG-EXPLANATION-END id=function:cptBadgeColor

``function CptRow``
-------------------

.. CG-BLOCK id=function:CptRow lines=818-909

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 818-909
   :lineno-match:

.. CG-EXPLANATION-START id=function:CptRow

**What this does.** Draws one CPT row: a multi-select checkbox on the left, then a clickable body — a pin icon, the name, a dirty asterisk when the test was imported this session but not yet saved, and an amber warning triangle when the test has no surface elevation — then a coloured type badge and the maximum depth; and, revealed on hover, a trash button that removes the test. Hovering the row highlights the matching marker on the map, and the row's background shows its selected, ticked, unsaved or hidden state.

**Why it is here.** The comments record the visual rules. The amber left stripe and the asterisk mark a test imported this session but not yet saved to the project file — amber, never red, is the unsaved colour. The warning triangle flags a missing Z the engineer still needs to supply. The remove button is the *reversible* project-local hide, carrying a stable testid that the guided tutorial and the automated tests anchor on. The name uses the semantic primary-text colour token so it stays visible on the dark inspector surface — a fixed grey used to vanish there.

.. CG-EXPLANATION-END id=function:CptRow

``function BoreholeRow``
------------------------

.. CG-BLOCK id=function:BoreholeRow lines=910-1033

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 910-1033
   :lineno-match:

.. CG-EXPLANATION-START id=function:BoreholeRow

**What this does.** The borehole counterpart of the CPT row: a checkbox, then a drill icon, the name, the same unsaved asterisk and no-elevation warning, and the total depth with the drill method; plus the hover-revealed remove button and the same selected, ticked, unsaved and hidden background states.

**Why it is here.** It mirrors the CPT row so the two tabs behave identically. The same rules apply: amber for unsaved, a warning triangle for a missing surface elevation, and a reversible project-local remove.

.. CG-EXPLANATION-END id=function:BoreholeRow

``function DateRangeControl``
-----------------------------

.. CG-BLOCK id=function:DateRangeControl lines=1034-1119

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 1034-1119
   :lineno-match:

.. CG-EXPLANATION-START id=function:DateRangeControl

**What this does.** Draws the date-range filter bar under the search box: a 'From' and a 'To' native date input, with a clear link that appears when either bound is set.

**Why it is here.** The docstring records the choices. Native date inputs are used because they are accessible, keyboard-navigable and render correctly in dark mode. The filter is *reversible*, so it applies immediately with no confirmation. And the clear link resets both bounds in a single update so there is never a half-cleared in-between state.

.. CG-EXPLANATION-END id=function:DateRangeControl

``function EmptyState``
-----------------------

.. CG-BLOCK id=function:EmptyState lines=1120-1128

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataInspector.tsx
   :language: tsx
   :lines: 1120-1128
   :lineno-match:

.. CG-EXPLANATION-START id=function:EmptyState

**What this does.** A compact empty-list row: a centred icon over a label. It shows the search icon when the emptiness is a 'no search matches' case, and the inbox icon for every other kind of emptiness.

**Why it is here.** It uses the shared empty-state widget so the list's empties carry an icon rather than bare centred text. The comment notes the search-versus-other case is passed in explicitly rather than guessed from the label text, because the label is translated and sniffing it for the word 'match' would break in another language.

.. CG-EXPLANATION-END id=function:EmptyState

