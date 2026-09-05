desktop.renderer.src.hooks.useSections
======================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useSections.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useSections.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useSections.ts
   :language: typescript
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The comment and the imports (five React hooks, setter types, the API client and response types, set helpers, the section-projection util, the WGS84 coordinate converter, the logger, the translation helper, the section defaults, the tie-suggest util, the undo type, and the focus-column and correlate helpers). This hook owns cross-section state: the sections list, the selection, the drawing mode, the focused-contacts highlight, and all the create/delete/patch handlers, plus the manifest and session-import bookkeeping for new and deleted sections.

**Why it is here.** The section lifecycle callbacks that used to sit inline in the App component now live alongside the handlers that call them. The contacts and investigations lists are injected rather than imported, so the hook stays independent of the data-loading hooks (the one-way dependency rule).

.. CG-EXPLANATION-END id=module-header

``type SectionModelAxis``
-------------------------

.. CG-BLOCK id=type:SectionModelAxis lines=32-33

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useSections.ts
   :language: typescript
   :lines: 32-33
   :lineno-match:

.. CG-EXPLANATION-START id=type:SectionModelAxis

**What this does.** Names which model the section editor is rendering and editing: geological, lithostratigraphic, or geotechnical.

**Why it is here.** The cross-section is the single edit-and-view surface for all three model levels (the commercial-direction design), so the editor needs a value that says which of the three is currently on the axis.

.. CG-EXPLANATION-END id=type:SectionModelAxis

``interface UseSectionsResult``
-------------------------------

.. CG-BLOCK id=interface:UseSectionsResult lines=34-186

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useSections.ts
   :language: typescript
   :lines: 34-186
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseSectionsResult

**What this does.** The large return shape: the sections list, the selection, the drawing state, the focused-contacts highlight, the model-axis and backdrop-model overrides, the correlate-mode state, the tie suggestions with their accept and reject handlers, and the create / delete / patch handlers.

**Why it is here.** Naming the whole surface in one place documents everything the App and the section stage read and call for cross-section editing.

.. CG-EXPLANATION-END id=interface:UseSectionsResult

``interface BoreholeAnchor``
----------------------------

.. CG-BLOCK id=interface:BoreholeAnchor lines=187-197

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useSections.ts
   :language: typescript
   :lines: 187-197
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BoreholeAnchor

**What this does.** The minimal borehole shape the hook needs: an id, an x/y location, and an optional own coordinate system.

**Why it is here.** The investigation's own coordinate system is used as the fallback section CRS when the project metadata never set one — for example a DOV import that did not populate the project's default horizontal CRS.

.. CG-EXPLANATION-END id=interface:BoreholeAnchor

``interface CptAnchor``
-----------------------

.. CG-BLOCK id=interface:CptAnchor lines=198-216

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useSections.ts
   :language: typescript
   :lines: 198-216
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CptAnchor

**What this does.** The same minimal shape for a CPT: an id, an x/y location, and an optional coordinate system.

**Why it is here.** Only the location is needed here, because all the hook does with an anchor is project it onto a section line.

.. CG-EXPLANATION-END id=interface:CptAnchor

``function tieToCreatePayload``
-------------------------------

.. CG-BLOCK id=function:tieToCreatePayload lines=217-285

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useSections.ts
   :language: typescript
   :lines: 217-285
   :lineno-match:

.. CG-EXPLANATION-START id=function:tieToCreatePayload

**What this does.** Builds the section-create payload for one accepted tie-section suggestion: the name, the coordinate system, the start and end coordinates, the projection buffer, and the vertical exaggeration.

**Why it is here.** It is shared by the single-accept and the accept-all paths so the field set cannot drift between them; only the ordinal in the ``Tie-section N`` name differs per caller (the ``extract on the second copy`` rule).

.. CG-EXPLANATION-END id=function:tieToCreatePayload

``function useSections``
------------------------

.. CG-BLOCK id=function:useSections lines=286-995

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useSections.ts
   :language: typescript
   :lines: 286-995
   :lineno-match:

.. CG-EXPLANATION-START id=function:useSections

**What this does.** The hook. It takes the project, the engine-ready flag, the toast, the undo-push, the body-recompute request, the manifest and session-import helpers, the contacts and litho-contacts and borehole and CPT lists, and the selection setters. It keeps the sections list, the selection, and the drawing and correlate state in *state*, runs *effects* that load the sections once the project changes and the engine is ready, and exposes the create-via-line-draw, delete, patch, focus-contacts, tie-suggest/accept, and correlate handlers.

**Why it is here.** The sections load only once the engine reports ready. A section create or delete adds or removes a whole partition, so it requests a body-identity recompute because both model axes' geometry moves. A user's click on the map is converted into the project's native coordinate system through the WGS84 converter (see the ``desktop.renderer.src.hooks.useWgs84`` page) before it is stored as a section endpoint. One effect suppresses the exhaustive-deps lint with a ``// reason:`` comment because the refresh callback is stable while the project is stable, and the contacts and investigations lists are injected so focus-contacts can resolve which section holds an offending anchor without coupling this hook to the data-loading hooks.

.. CG-EXPLANATION-END id=function:useSections

