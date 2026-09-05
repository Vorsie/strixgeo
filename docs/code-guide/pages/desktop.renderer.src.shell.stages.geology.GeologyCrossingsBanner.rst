desktop.renderer.src.shell.stages.geology.GeologyCrossingsBanner
================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geology/GeologyCrossingsBanner.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geology/GeologyCrossingsBanner.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyCrossingsBanner.tsx
   :language: tsx
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file — the surface-crossing validation banners for the geology inspector — and imports the warning and info icons, the crossing-issue response type from the API client, and the translator. A crossing is where two geological surfaces overlap in a physically impossible way (one formation's top passing through another). The comment lays out three states: surfaces stale (validation deliberately skipped), the validator request errored, and a list of detected crossings.

**Why it is here.** Extracted verbatim from the inspector (debt #201); presentation only — the parent owns the crossings-validation hook and the click handler. The API is the engine the desktop talks to over web addresses (it never touches the database directly); ``GapIssueResponse`` is the JSON shape one detected issue comes back in.

.. CG-EXPLANATION-END id=module-header

``interface GeologyCrossingsBannerProps``
-----------------------------------------

.. CG-BLOCK id=interface:GeologyCrossingsBannerProps lines=22-54

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyCrossingsBanner.tsx
   :language: tsx
   :lines: 22-54
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeologyCrossingsBannerProps

**What this does.** Declares the banner's inputs: a flag that surfaces are stale (so the validator was skipped), a flag that the validator request errored, the list of detected crossing issues, a callback to navigate to the section that owns an issue's contacts, and the translator.

**Why it is here.** The three flags and the issue list are computed by the parent's validation hook; this component only decides which banner to show, so it takes them all as props.

.. CG-EXPLANATION-END id=interface:GeologyCrossingsBannerProps

``function GeologyCrossingsBanner``
-----------------------------------

.. CG-BLOCK id=function:GeologyCrossingsBanner lines=55-151

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyCrossingsBanner.tsx
   :language: tsx
   :lines: 55-151
   :lineno-match:

.. CG-EXPLANATION-START id=function:GeologyCrossingsBanner

**What this does.** Renders up to three banners depending on the inputs: a neutral "not checked yet" info banner when the surfaces are stale; an amber "check failed" alert when the validator request errored; and an amber list of detected crossings, where each row is a clickable button (when it carries contact ids) that jumps to the section owning those contacts.

**Why it is here.** The pending banner is a neutral info tone, not an amber alarm, because a stale or unbuilt model is not a known problem — only an unchecked one (debt #18); it clears itself once a Build refreshes the surfaces. The failed banner exists because silence would read as "no crossings" and the engineer would Build and export on unvalidated data (audit F10). Clicking a crossing row navigates straight to the offending section so it can be fixed.

.. CG-EXPLANATION-END id=function:GeologyCrossingsBanner

