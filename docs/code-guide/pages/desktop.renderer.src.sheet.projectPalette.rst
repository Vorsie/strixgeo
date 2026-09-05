desktop.renderer.src.sheet.projectPalette
=========================================

.. CG-PAGE source=desktop/src/renderer/src/sheet/projectPalette.ts complete=true

*Source file:* ``desktop/src/renderer/src/sheet/projectPalette.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/projectPalette.ts
   :language: typescript
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line comment and the import of the fixed project palette (a *palette* is a small list of chosen colours). The comment says this file maps each project key to a palette slot in the order the projects first appear.

**Why it is here.** The owner asked that every distinct project get its own colour on the map and legend. This file is the one place that decides which colour each project gets, following the spec's ``Colours`` rule.

.. CG-EXPLANATION-END id=module-header

``const NO_PROJECT_KEY``
------------------------

.. CG-BLOCK id=const:NO_PROJECT_KEY lines=5-6

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/projectPalette.ts
   :language: typescript
   :lines: 5-6
   :lineno-match:

.. CG-EXPLANATION-START id=const:NO_PROJECT_KEY

**What this does.** A special marker value used as the key for investigations whose name carries no project.

**Why it is here.** Investigations with no project still need to be grouped together and coloured; a single reserved marker gives them one shared bucket. It is shown to the reader through the translation system as ``(no project)`` / ``(geen project)``, never printed raw.

.. CG-EXPLANATION-END id=const:NO_PROJECT_KEY

``function normaliseProjectKey``
--------------------------------

.. CG-BLOCK id=function:normaliseProjectKey lines=7-16

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/projectPalette.ts
   :language: typescript
   :lines: 7-16
   :lineno-match:

.. CG-EXPLANATION-START id=function:normaliseProjectKey

**What this does.** Returns the given project key unchanged, except that an empty key is replaced by the no-project marker.

**Why it is here.** So an investigation with no project is treated as one consistent group everywhere, rather than as a blank that could be handled differently in different places.

.. CG-EXPLANATION-END id=function:normaliseProjectKey

``function assignProjectColours``
---------------------------------

.. CG-BLOCK id=function:assignProjectColours lines=17-25

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/projectPalette.ts
   :language: typescript
   :lines: 17-25
   :lineno-match:

.. CG-EXPLANATION-START id=function:assignProjectColours

**What this does.** Given the project key of every investigation in order — the on-profile ones first in A to A′ order, then the off-profile map points — it walks the list and gives each project not seen before the next palette slot, wrapping back to the start after the eight colours run out. It returns a lookup from project key to colour slot.

**Why it is here.** Colours are assigned by first appearance from A along the profile, so the projects nearest the start of the section get the first, most distinct colours — the order the spec fixes. Wrapping after eight is deliberate: the palette has eight colour-blind-safe hues and colours may repeat past that, since position on the map also helps tell projects apart.

.. CG-EXPLANATION-END id=function:assignProjectColours

``function projectColour``
--------------------------

.. CG-BLOCK id=function:projectColour lines=26-28

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/projectPalette.ts
   :language: typescript
   :lines: 26-28
   :lineno-match:

.. CG-EXPLANATION-START id=function:projectColour

**What this does.** Returns the actual colour string for a given palette slot, wrapping around the eight-colour list if the number is larger than eight.

**Why it is here.** A tiny shared lookup so every part of the sheet — the profile codes, the map dots, the project legend — reads the same colour for the same slot from one source, with no second copy of the palette.

.. CG-EXPLANATION-END id=function:projectColour

