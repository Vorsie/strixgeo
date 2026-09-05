desktop.renderer.src.utils.horizontalCrs
========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/horizontalCrs.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/horizontalCrs.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../desktop/src/renderer/src/utils/horizontalCrs.ts
   :language: typescript
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file lists the horizontal coordinate systems a cross-section is allowed to use, and turns an EPSG number into a label and a block reason. The comment explains the core constraint: a cross-section's along-distance is a plain straight-line distance in the section's own units, so only a projected metric coordinate system is valid; a geographic one measured in degrees would silently produce geometry at a tiny wrong scale in every export. So section creation is gated on this allowlist, with a tooltip naming the coordinate system, rather than on merely "a coordinate system is set".

**Why it is here.** The reason is recorded in the comment (debt #31). A *CRS* is a coordinate reference system, and an *EPSG* number names a specific one (for example EPSG:31370 is Belgian Lambert 72); distances are only metres in a projected metric CRS. Because a degrees-based system would corrupt every export without any visible error, the code refuses section creation unless the system is on this metric allowlist. The list mirrors the backend's own, and the comment says to keep both in sync when adding a country.

.. CG-EXPLANATION-END id=module-header

``const SUPPORTED_SECTION_HORIZONTAL_EPSGS``
--------------------------------------------

.. CG-BLOCK id=const:SUPPORTED_SECTION_HORIZONTAL_EPSGS lines=12-19

.. literalinclude:: ../../../desktop/src/renderer/src/utils/horizontalCrs.ts
   :language: typescript
   :lines: 12-19
   :lineno-match:

.. CG-EXPLANATION-START id=const:SUPPORTED_SECTION_HORIZONTAL_EPSGS

**What this does.** The set of EPSG numbers a section may be created or exported in: Belgian Lambert 72 and 2008, the Dutch RD New system, and two UTM zone-31N systems.

**Why it is here.** These are the projected metric systems that cover Belgium and the Netherlands, the platform's target region — each measures position in metres, so a straight-line along-distance is a true distance.

.. CG-EXPLANATION-END id=const:SUPPORTED_SECTION_HORIZONTAL_EPSGS

``const HCRS_LABEL_BY_EPSG``
----------------------------

.. CG-BLOCK id=const:HCRS_LABEL_BY_EPSG lines=20-29

.. literalinclude:: ../../../desktop/src/renderer/src/utils/horizontalCrs.ts
   :language: typescript
   :lines: 20-29
   :lineno-match:

.. CG-EXPLANATION-START id=const:HCRS_LABEL_BY_EPSG

**What this does.** A lookup from each supported EPSG number to a human-readable label naming the system and its code.

**Why it is here.** So a tooltip or metadata field can show the engineer the actual system by name, not just a bare number.

.. CG-EXPLANATION-END id=const:HCRS_LABEL_BY_EPSG

``function isSupportedSectionCrs``
----------------------------------

.. CG-BLOCK id=function:isSupportedSectionCrs lines=30-37

.. literalinclude:: ../../../desktop/src/renderer/src/utils/horizontalCrs.ts
   :language: typescript
   :lines: 30-37
   :lineno-match:

.. CG-EXPLANATION-START id=function:isSupportedSectionCrs

**What this does.** Returns whether a section may be created or exported in a given coordinate system, by checking the EPSG number against the allowlist. A missing system is unsupported.

**Why it is here.** This is the single test the create-gate uses, so "is this system valid for a section" is answered the same way everywhere.

.. CG-EXPLANATION-END id=function:isSupportedSectionCrs

``function horizontalCrsLabel``
-------------------------------

.. CG-BLOCK id=function:horizontalCrsLabel lines=38-52

.. literalinclude:: ../../../desktop/src/renderer/src/utils/horizontalCrs.ts
   :language: typescript
   :lines: 38-52
   :lineno-match:

.. CG-EXPLANATION-START id=function:horizontalCrsLabel

**What this does.** Returns a readable label for an EPSG number: the mapped name when known, a bare "EPSG:<number>" for an unmapped code, and "no CRS" when none is set.

**Why it is here.** The docstring notes it is honest over wrong — it never guesses a name it does not have — so the engineer always sees either the real name or the raw code, never a misleading label.

.. CG-EXPLANATION-END id=function:horizontalCrsLabel

``function sectionCrsBlockReason``
----------------------------------

.. CG-BLOCK id=function:sectionCrsBlockReason lines=53-68

.. literalinclude:: ../../../desktop/src/renderer/src/utils/horizontalCrs.ts
   :language: typescript
   :lines: 53-68
   :lineno-match:

.. CG-EXPLANATION-START id=function:sectionCrsBlockReason

**What this does.** Returns why section creation is blocked for a given coordinate system, or nothing when it is fine. When none is set it asks the engineer to set a metric default in project metadata; when one is set but unsupported it names the system and explains that cross-section geometry needs metres.

**Why it is here.** The docstring records that this is the single source of truth for the create-gate tooltip, so the toolbar and the empty-state prompt stay in lockstep (debt #31), and that the message names the actual system so the engineer knows what to fix, not merely that something is broken.

.. CG-EXPLANATION-END id=function:sectionCrsBlockReason

