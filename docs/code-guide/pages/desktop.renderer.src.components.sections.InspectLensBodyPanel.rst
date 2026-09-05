desktop.renderer.src.components.sections.InspectLensBodyPanel
=============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/InspectLensBodyPanel.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/InspectLensBodyPanel.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-45

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/InspectLensBodyPanel.tsx
   :language: tsx
   :lines: 1-45
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file for the panel that inspects a lens body — opened by right-clicking a body chip and choosing 'Inspect lens body…'. It shows the formation and body, which investigations the body is present at and which it is absent from (with confidence badges and per-row confirm buttons), a name field, a boundary-style picker, and a 'create perpendicular companion' button. The imports pull in React hooks, the data types, the backend client, the logger, and the shared button, modal, and translation pieces.

**Why it is here.** It is the gesture surface for a lens body's absence evidence (#101 Blocker 1). Inferred absences carry an amber 'auto' badge and render the band faintly; confirming an absence promotes it from inferred to manual and flips the band to solid — the panel's confirm gesture is what makes the band solid. It is a full modal so it escapes the section's drawing stacking context.

.. CG-EXPLANATION-END id=module-header

``interface InspectLensBodyTarget``
-----------------------------------

.. CG-BLOCK id=interface:InspectLensBodyTarget lines=46-56

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/InspectLensBodyPanel.tsx
   :language: tsx
   :lines: 46-56
   :lineno-match:

.. CG-EXPLANATION-START id=interface:InspectLensBodyTarget

**What this does.** The shape of what the panel is inspecting: the formation id, the body ordinal, the project id, and the model id.

**Why it is here.** These four identifiers scope every request the panel makes — fetching absences, naming the body, loading its boundary shape.

.. CG-EXPLANATION-END id=interface:InspectLensBodyTarget

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=57-87

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/InspectLensBodyPanel.tsx
   :language: tsx
   :lines: 57-87
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs: the target (or null when closed), the formation vocabulary, the investigations present on this section, a label map, any existing lens id and name, and callbacks for when a lens is named, a companion is offered, an absence is updated, and the panel closes.

**Why it is here.** A null target means the panel is closed. The present-investigations list and label map are computed by the caller from the section's contacts and visible tests, so the panel does not have to work them out itself.

.. CG-EXPLANATION-END id=interface:Props

``const SOURCE_BADGE``
----------------------

.. CG-BLOCK id=const:SOURCE_BADGE lines=88-136

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/InspectLensBodyPanel.tsx
   :language: tsx
   :lines: 88-136
   :lineno-match:

.. CG-EXPLANATION-START id=const:SOURCE_BADGE

**What this does.** A constant dictionary mapping each absence source — inferred, manual, observed — to a badge label and styling: 'auto' amber, 'confirmed' green, 'observed' blue.

**Why it is here.** The badge makes the evidence behind each absence visible at a glance and colour-codes its strength, with amber marking the inferred guesses the confirm gesture upgrades.

.. CG-EXPLANATION-END id=const:SOURCE_BADGE

``function InspectLensBodyPanel``
---------------------------------

.. CG-BLOCK id=function:InspectLensBodyPanel lines=137-619

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/InspectLensBodyPanel.tsx
   :language: tsx
   :lines: 137-619
   :lineno-match:

.. CG-EXPLANATION-START id=function:InspectLensBodyPanel

**What this does.** The whole panel component. It fetches the formation's absences when it opens and loads the lens's boundary style, holds the name field and busy flags, and provides handlers to confirm one absence, confirm all inferred ones, save the name, change the boundary style, and offer a companion. It renders a modal with the present investigations, the absences grouped by source with confirm buttons, the name field, the boundary-style picker, and footer actions.

**Why it is here.** Each confirm promotes an inferred absence to manual on the server and updates local state optimistically before the refetch, so the band flips solid immediately. Every backend call is logged (entry, success, failure) per the observability rules. Companion creation requires a named lens, so the handler surfaces a short inline error and focuses the name field rather than failing silently. The cancellation flags on the fetch effects stop a late response from a previous target overwriting the current one.

.. CG-EXPLANATION-END id=function:InspectLensBodyPanel

