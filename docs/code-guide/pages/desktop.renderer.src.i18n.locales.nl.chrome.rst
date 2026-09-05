desktop.renderer.src.i18n.locales.nl.chrome
===========================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/locales/nl/chrome.ts complete=true

*Source file:* ``desktop/src/renderer/src/i18n/locales/nl/chrome.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/nl/chrome.ts
   :language: typescript
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and opens ``CHROME_NL`` — the Dutch (Belgian) mirror of the English ``chrome`` catalogue. It carries the same keys, with Belgian-Flemish strings, for the app's outer frame: the shared buttons, the boot and backend messages, the project launcher, the metadata dialog and the workflow-stage rail. It is the Dutch side.

**Why it is here.** The interface text lives in per-language catalogues so a component asks for a text by its key and gets the string for the active language; a companion test (``localeParity``) checks that English and Dutch carry exactly the same keys. The header explains the review convention: a ``// FLAG alt: a | b — why`` line above a key marks a term the owner still has to rule on, and the review table is generated from those comments so it can never drift from the file.

.. CG-EXPLANATION-END id=module-header

``const CHROME_NL``
-------------------

.. CG-BLOCK id=const:CHROME_NL lines=10-314

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/nl/chrome.ts
   :language: typescript
   :lines: 10-314
   :lineno-match:

.. CG-EXPLANATION-START id=const:CHROME_NL

**What this does.** The Dutch strings for the app frame, key for key against the English file, under the same group banners (common, app, welcome, project, spine/shell). Domain and interface vocabulary you can read in it includes "Sondering(en)" for CPT, "boring(en)" for borehole, "dwarsprofiel" for a cross-section, and "Peil" for elevation. Values keep the same ``{name}`` / ``{version}`` slots as English so the number or name drops into the reordered Dutch sentence.

**Why it is here.** The comments record owner rulings and judgement calls: "Peil" is FLAGGED against "Hoogte/Niveau" because peil is the BE mTAW word for an absolute level; the reversible row-hide (``common.remove``) was renamed to "Verwijderen" (owner 2026-09-03), so the irreversible database delete reads the emphatic "Definitief verwijderen" to stay distinct (docs/ux.md); and the owner chose "Herstelde sessie" and "Werkvolgorde" for two headings. Domain tokens such as soil and DOV names are never translated here — only at the presentation boundary.

.. CG-EXPLANATION-END id=const:CHROME_NL

