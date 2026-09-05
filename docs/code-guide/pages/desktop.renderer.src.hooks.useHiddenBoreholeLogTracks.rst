desktop.renderer.src.hooks.useHiddenBoreholeLogTracks
=====================================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useHiddenBoreholeLogTracks.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useHiddenBoreholeLogTracks.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useHiddenBoreholeLogTracks.ts
   :language: typescript
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening documentation and its two imports: a shared persisted-JSON hook and the translator type. It sets up a per-user set of borehole-log tracks (columns) the engineer has chosen to hide.

**Why it is here.** The docstring records the design. The hidden-track set is kept in *localStorage* — a small store the browser keeps on this one computer that survives a reload — under a global, not project-scoped, key, because column visibility is a personal preference the same engineer wants across every project; this is the same rule as every screen preference (localStorage holds UI chrome only, never project decisions). The depth axis is never hidable because the spine is structurally mandatory, and unknown stored ids are ignored so a future build can rename a track without crashing on old data.

.. CG-EXPLANATION-END id=module-header

``const TOGGLEABLE_TRACK_IDS``
------------------------------

.. CG-BLOCK id=const:TOGGLEABLE_TRACK_IDS lines=31-46

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useHiddenBoreholeLogTracks.ts
   :language: typescript
   :lines: 31-46
   :lineno-match:

.. CG-EXPLANATION-START id=const:TOGGLEABLE_TRACK_IDS

**What this does.** The list of every track that can be hidden: the eight observation tracks (each named by its raw observation-type token) and three fixed tracks (drill method, field log, samples-and-lab).

**Why it is here.** The comment records that the observation ids match the engine's ``observation_type`` tokens exactly — the raw upstream tokens are stored and matched, never translated (Data Integrity Rule 2). Listing them once makes this the single source of which tracks are toggleable.

.. CG-EXPLANATION-END id=const:TOGGLEABLE_TRACK_IDS

``type ToggleableTrackId``
--------------------------

.. CG-BLOCK id=type:ToggleableTrackId lines=47-63

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useHiddenBoreholeLogTracks.ts
   :language: typescript
   :lines: 47-63
   :lineno-match:

.. CG-EXPLANATION-START id=type:ToggleableTrackId

**What this does.** A type meaning “one of the ids in the list above”.

**Why it is here.** Deriving the type from the list means the two can never drift apart: adding an id to the list automatically widens the type, and a track id outside the list is caught before the app runs.

.. CG-EXPLANATION-END id=type:ToggleableTrackId

``function trackLabel``
-----------------------

.. CG-BLOCK id=function:trackLabel lines=64-95

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useHiddenBoreholeLogTracks.ts
   :language: typescript
   :lines: 64-95
   :lineno-match:

.. CG-EXPLANATION-START id=function:trackLabel

**What this does.** Takes the active-language translator and a track id and returns the human label to show in the Columns dropdown.

**Why it is here.** This is the translate-at-the-presentation-boundary rule in action (CLAUDE.md; docs/ux.md): the id is a stored, matched token and is never altered — only the displayed label is translated. The three fixed tracks reuse the very same translation keys their column headers use, so the dropdown and the header can never disagree.

.. CG-EXPLANATION-END id=function:trackLabel

``const BORELOG_HIDDEN_TRACKS_KEY``
-----------------------------------

.. CG-BLOCK id=const:BORELOG_HIDDEN_TRACKS_KEY lines=96-97

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useHiddenBoreholeLogTracks.ts
   :language: typescript
   :lines: 96-97
   :lineno-match:

.. CG-EXPLANATION-START id=const:BORELOG_HIDDEN_TRACKS_KEY

**What this does.** The name under which the hidden-track set is stored in localStorage: ``groundmodel.borelog.hidden_tracks``.

**Why it is here.** Naming the storage slot once, and globally rather than per project, keeps the read and the write on the same key and matches the personal-preference rule from the module header.

.. CG-EXPLANATION-END id=const:BORELOG_HIDDEN_TRACKS_KEY

``const VALID_IDS``
-------------------

.. CG-BLOCK id=const:VALID_IDS lines=98-116

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useHiddenBoreholeLogTracks.ts
   :language: typescript
   :lines: 98-116
   :lineno-match:

.. CG-EXPLANATION-START id=const:VALID_IDS

**What this does.** The toggleable ids gathered into a set for fast membership checks.

**Why it is here.** A set makes the parse guard below able to check “is this a real track id?” quickly while validating stored data.

.. CG-EXPLANATION-END id=const:VALID_IDS

``function parseHiddenTracks``
------------------------------

.. CG-BLOCK id=function:parseHiddenTracks lines=117-124

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useHiddenBoreholeLogTracks.ts
   :language: typescript
   :lines: 117-124
   :lineno-match:

.. CG-EXPLANATION-START id=function:parseHiddenTracks

**What this does.** Turns whatever was read from localStorage into a validated set: a non-array value becomes an empty set, and any entry that is not a known track id is dropped.

**Why it is here.** The docstring records the two guards — forward-compatibility (a future build may rename or remove a track, and old stored ids simply evaporate) and corruption tolerance (a hand-edited or corrupt value falls back to no hidden tracks) — so a bad stored value can never crash the borehole log or hide a track that no longer exists.

.. CG-EXPLANATION-END id=function:parseHiddenTracks

``const serializeHiddenTracks``
-------------------------------

.. CG-BLOCK id=const:serializeHiddenTracks lines=125-148

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useHiddenBoreholeLogTracks.ts
   :language: typescript
   :lines: 125-148
   :lineno-match:

.. CG-EXPLANATION-START id=const:serializeHiddenTracks

**What this does.** Turns the set back into a plain array for storage.

**Why it is here.** localStorage stores text, not sets, so the set is written as its list of ids; the parse function above reverses this on load.

.. CG-EXPLANATION-END id=const:serializeHiddenTracks

``function useHiddenBoreholeLogTracks``
---------------------------------------

.. CG-BLOCK id=function:useHiddenBoreholeLogTracks lines=149-160

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useHiddenBoreholeLogTracks.ts
   :language: typescript
   :lines: 149-160
   :lineno-match:

.. CG-EXPLANATION-START id=function:useHiddenBoreholeLogTracks

**What this does.** The hook itself. It hands the storage key, an empty default, and the parse and serialize functions to the shared persisted-JSON hook, and returns the current hidden set plus a setter that also writes every change to localStorage.

**Why it is here.** Delegating the read-guard-write cycle to the shared ``usePersistedJSON`` hook keeps this hook a thin, purpose-named wrapper — the borehole-log view just calls it and gets a set that is loaded on mount, validated on load, and persisted on every change, with all the corruption handling living in the parse guard above.

.. CG-EXPLANATION-END id=function:useHiddenBoreholeLogTracks

