desktop.renderer.src.shell.ShellContext
=======================================

.. CG-PAGE source=desktop/src/renderer/src/shell/ShellContext.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/ShellContext.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ShellContext.ts
   :language: typescript
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file sets up the shared data bus — the single bundle of app state that every stage reads from. The comments explain how it is meant to be used: the top-level component gathers the results of all its hooks into one bundle, hands it in through the context, and each stage picks out only the slice it needs by calling ``useShell()``. The imports are almost all *type* imports — descriptions of the shapes the various hooks return — plus React's two context tools.

**Why it is here.** The comments repeat the "Risk 2" rule that governs this whole mechanism: the bundle must be a *memo* — a value kept and rebuilt only when its ingredients truly change — because a context makes every reader redraw whenever the shared value's identity changes, and an unwrapped, freshly-built bundle would make all readers redraw on every redraw. The comments also record a deliberate non-decision: there is no per-field subscription machinery, because pulling the whole bundle costs only a single context read, not a redraw — React redraws a reader only when the bundle's identity changes, which the memo prevents unless something real changed.

.. CG-EXPLANATION-END id=module-header

``type ParameterUnitScopeKind``
-------------------------------

.. CG-BLOCK id=type:ParameterUnitScopeKind lines=31-62

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ShellContext.ts
   :language: typescript
   :lines: 31-62
   :lineno-match:

.. CG-EXPLANATION-START id=type:ParameterUnitScopeKind

**What this does.** Names the kinds of unit the Parameters stage can be focused on: a lithological unit or one of its bodies, and — on the geotechnical side — a class, a body, a manual group, or a whole unit. Each is written as a fixed word so the code can only ever hold one of these.

**Why it is here.** Naming the kinds as a closed list lets the rest of the code branch safely on which kind it holds, with a wrong word caught by the build. The distinction is load-bearing for the reasons the next block's docstring spells out — chiefly which model (litho or geotech) the statistics should be pooled from.

.. CG-EXPLANATION-END id=type:ParameterUnitScopeKind

``type ParameterUnitScope``
---------------------------

.. CG-BLOCK id=type:ParameterUnitScope lines=63-82

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ShellContext.ts
   :language: typescript
   :lines: 63-82
   :lineno-match:

.. CG-EXPLANATION-START id=type:ParameterUnitScope

**What this does.** The full description of what the Parameters stage is focused on. It is a *discriminated union* — a value that is one of several different shapes, each tagged by its ``kind`` word so the code can tell them apart and know which extra fields come with it. A litho-unit scope carries just a unit id; a geotech class carries a litho unit, a litho body and an NAD class number; a manual group carries its member bodies; and so on.

**Why it is here.** The docstring records why the kind matters on two axes. First, which model to read (owner ruling R1): a litho scope pools the whole litho unit across every NAD subdivision, while a geotech scope pools the geotech model — and mixing them up is exactly the silent empty-statistics bug this shape is built to make impossible to express. Second, how much ground inside the model, quoting the owner's rule that a body is only a body when it is geometrically connected or the user has declared two bodies the same. One central helper (``bandsForScope``) is the sole authority that turns any of these scopes into its set of bands, so no consumer branches on the kind on its own.

.. CG-EXPLANATION-END id=type:ParameterUnitScope

``function parameterScopeModel``
--------------------------------

.. CG-BLOCK id=function:parameterScopeModel lines=83-87

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ShellContext.ts
   :language: typescript
   :lines: 83-87
   :lineno-match:

.. CG-EXPLANATION-START id=function:parameterScopeModel

**What this does.** A one-line helper that answers a single question about a scope: does it belong to the litho model or the geotech model? It returns ``'litho'`` for the two litho kinds and ``'geotech'`` for all the geotech kinds.

**Why it is here.** The docstring calls this the one branch consumers still need before they reach the central band helper — they use it to pick the litho or geotech layer list. Isolating that single either/or in a named helper keeps the litho-versus-geotech decision in one place rather than re-derived, slightly differently, in each consumer.

.. CG-EXPLANATION-END id=function:parameterScopeModel

``type ParametersTabId``
------------------------

.. CG-BLOCK id=type:ParametersTabId lines=88-103

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ShellContext.ts
   :language: typescript
   :lines: 88-103
   :lineno-match:

.. CG-EXPLANATION-START id=type:ParametersTabId

**What this does.** Names the three tabs of the Parameters stage's centre area: ``per-test``, ``per-unit`` and ``methods``.

**Why it is here.** A closed list of the three tab names lets the code track and switch the active tab safely, with a typo caught by the build rather than producing a blank tab at run time.

.. CG-EXPLANATION-END id=type:ParametersTabId

``interface Coordinator``
-------------------------

.. CG-BLOCK id=interface:Coordinator lines=104-387

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ShellContext.ts
   :language: typescript
   :lines: 104-387
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Coordinator

**What this does.** Describes a named slice of shared state that does not belong to any single hook because it is written in one place and read in another. It gathers: the currently selected CPT and borehole and the functions to change them; the current canvas mode (map or chart); the select handlers that load a detail and switch view (including a variant that selects without disturbing the Data stage's view); the DXF and Plaxis section-export actions; sets of investigations that are off-screen or imported-but-unsaved (which drive the amber row markers); the marquee selection and the hovered row; three cross-stage "deep-link" requests (to Geology, to Sections, to Parameters) each with a setter; the unit the Parameters stage is focused on and its active tab; a ``markMutated`` flag-raiser; and several counters ("nonces") that trigger refetches and body recomputes.

**Why it is here.** The docstring gives the throughline: each of these values crosses a hook boundary — for example, the selected id is written by the import handlers but read by the sections hook, and the unsaved-import sets are written by the save/discard flow but read by the inspector lists. Extracting them into their own hook would create circular dependencies between those hooks, so instead they are grouped here as one documented slice with a predictable home. Individual comments record the sharper reasons: ``handleSelectWithoutView`` exists so a stage other than Data can select a CPT to plot in its own surface without silently rewriting where Data will land next; ``markMutated`` exists because an edit to a pre-existing row (a dragged contact, a typed water table) belongs to none of the unsaved-import sets, so without this call the unsaved marker never lights, Save is never prompted, and the next open of the project file silently drops the edit; and the deep-link targets live here because their writer and their readers sit in different parts of the interface and the request must survive the stage switch.

.. CG-EXPLANATION-END id=interface:Coordinator

``interface ShellContextValue``
-------------------------------

.. CG-BLOCK id=interface:ShellContextValue lines=388-465

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ShellContext.ts
   :language: typescript
   :lines: 388-465
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ShellContextValue

**What this does.** The description of the whole bus — the complete bundle handed through the context. Each field is the return value of one hook in the top-level component: the project, its lifecycle actions, the CPT and borehole data and import flows, the filtered visible lists, the geological model, the cross-sections, the map overlays, the toast stack, the undo/redo stack, the engine-ready flags, the map view state, and the coordinator slice above.

**Why it is here.** The docstring records two shaping decisions. The project is lifted to the top level of the bundle for convenience because it is the most-read field, saving every consumer a step. And several fields are deliberately trimmed away — the close-without-save dialog copy, the CPT refresh-confirmation trio, the toast-dismiss action — because those exist only to drive dialogs the top-level component renders directly, no stage reads them, and carrying them here would force every stage's test fixture to fabricate values it never uses.

.. CG-EXPLANATION-END id=interface:ShellContextValue

``const ShellContext``
----------------------

.. CG-BLOCK id=const:ShellContext lines=466-484

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ShellContext.ts
   :language: typescript
   :lines: 466-484
   :lineno-match:

.. CG-EXPLANATION-START id=const:ShellContext

**What this does.** Creates the actual context object the bus flows through, starting it off empty.

**Why it is here.** The docstring explains the empty start value: it lets the typed code assume the bundle is present inside a provider, and any stage accidentally drawn outside a provider gets a clear run-time error instead of silently reading nothing — which is intended, because stage components are only ever meant to live inside the shell.

.. CG-EXPLANATION-END id=const:ShellContext

``function useShell``
---------------------

.. CG-BLOCK id=function:useShell lines=485-487

.. literalinclude:: ../../../desktop/src/renderer/src/shell/ShellContext.ts
   :language: typescript
   :lines: 485-487
   :lineno-match:

.. CG-EXPLANATION-START id=function:useShell

**What this does.** The small helper every stage calls to read the shared bus; it returns the whole bundle so the caller can pick out the slice it needs.

**Why it is here.** The docstring records the one rule of use: it must be called from inside the shell's provider, and it will raise a run-time error if used outside one. Wrapping the plain context read in a named helper gives every stage the same, single, discoverable way in.

.. CG-EXPLANATION-END id=function:useShell

