desktop.renderer.src.utils.sectionDisplayName
=============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/sectionDisplayName.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/sectionDisplayName.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-6

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionDisplayName.ts
   :language: typescript
   :lines: 1-6
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file's one job is to turn a section's stored name into the label shown on screen. It brings in the ``Translator`` type (the active-language text lookup) and then defines two *patterns* — a pattern is a small rule that tests whether a piece of text has a given shape. The two patterns recognise the app's two automatic default names, ``Cross-section N`` and ``Tie-section N``, where N is a number.

**Why it is here.** The comment records the rule: only the exact, untouched default names that the section generator writes are translated; a section the engineer has renamed carries an arbitrary name and must be shown exactly as typed. This is the app's translate-at-the-presentation-boundary rule (CLAUDE.md; docs/ux.md) — the engine stores the raw English name and never rewrites it, and the desktop translates a name only when it is about to be displayed.

.. CG-EXPLANATION-END id=module-header

``const CROSS_SECTION_DEFAULT``
-------------------------------

.. CG-BLOCK id=const:CROSS_SECTION_DEFAULT lines=7-7

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionDisplayName.ts
   :language: typescript
   :lines: 7-7
   :lineno-match:

.. CG-EXPLANATION-START id=const:CROSS_SECTION_DEFAULT

**What this does.** The pattern that matches exactly the text ``Cross-section`` followed by a number, and remembers that number.

**Why it is here.** It recognises the automatic cross-section default name so that this one name — and only this one — is translated for display; a section the engineer renamed will not match and so is left alone.

.. CG-EXPLANATION-END id=const:CROSS_SECTION_DEFAULT

``const TIE_SECTION_DEFAULT``
-----------------------------

.. CG-BLOCK id=const:TIE_SECTION_DEFAULT lines=8-24

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionDisplayName.ts
   :language: typescript
   :lines: 8-24
   :lineno-match:

.. CG-EXPLANATION-START id=const:TIE_SECTION_DEFAULT

**What this does.** The matching pattern for the automatic tie-section default name, followed by the documentation for the function below. The documentation states what the helper returns: the translated label for the two default names, and the raw name unchanged for any section the user has renamed.

**Why it is here.** The docstring records the reason: the stored ``section.name`` stays the English canonical default with no data migration, so this single helper gives the inspector row, the delete dialog and the header strip one consistent label producer, and any custom name survives untouched.

.. CG-EXPLANATION-END id=const:TIE_SECTION_DEFAULT

``function sectionDisplayName``
-------------------------------

.. CG-BLOCK id=function:sectionDisplayName lines=25-31

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionDisplayName.ts
   :language: typescript
   :lines: 25-31
   :lineno-match:

.. CG-EXPLANATION-START id=function:sectionDisplayName

**What this does.** The function itself. It takes a section and the translator. If the name matches the cross-section default it returns the translated cross-section label carrying the captured number; if it matches the tie-section default it returns the translated tie label; otherwise it returns the name unchanged.

**Why it is here.** This is a *pure function* — its result depends only on its inputs, with no side effects — and a *formatter*: a pure function that turns a value into display text. Doing the translation here, at the moment of display, is the presentation-boundary rule in action: the raw name is the single source of truth and the label is derived from it every time it is shown.

.. CG-EXPLANATION-END id=function:sectionDisplayName

