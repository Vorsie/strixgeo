desktop.renderer.src.utils.investigationDate
============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/investigationDate.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/investigationDate.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../desktop/src/renderer/src/utils/investigationDate.ts
   :language: typescript
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file is a tolerant parser for investigation start dates. The comment explains why tolerance is needed: borehole list items carry a well-formed ISO date, but CPT items carry a raw date string straight from the GEF/DOV parser that may be a full date with hyphens or slashes, a four-digit year only, or something unparseable from an old file. Both arrive as either a string or nothing in the frontend.

**Why it is here.** The reason is recorded in the comment: the two data sources format dates differently, so a shared parser must accept several shapes rather than assume one, or the CPT dates would be dropped.

.. CG-EXPLANATION-END id=module-header

``function parseInvestigationDate``
-----------------------------------

.. CG-BLOCK id=function:parseInvestigationDate lines=33-90

.. literalinclude:: ../../../desktop/src/renderer/src/utils/investigationDate.ts
   :language: typescript
   :lines: 33-90
   :lineno-match:

.. CG-EXPLANATION-START id=function:parseInvestigationDate

**What this does.** Turns a raw date string into a date value. It treats an empty or missing input as no date; it accepts a full date written with either hyphens or slashes and reads it as a calendar day; it accepts a bare four-digit year as the first of January of that year; and it returns nothing for anything else. Every accepted date is fixed at midnight UTC.

**Why it is here.** The docstring records the choices. Slashes are normalised to hyphens so both spellings match one pattern; a year-only value floors to the first of January so a coarse filter never excludes an item by giving it a later-than-real date; and out-of-range values (like a thirteenth month, or a year outside 1800–2100) are rejected rather than silently rolled over. Using midnight UTC everywhere means dates from different sources compare fairly regardless of the local time zone, since these values are used only for comparison, not display.

.. CG-EXPLANATION-END id=function:parseInvestigationDate

``function isWithinDateRange``
------------------------------

.. CG-BLOCK id=function:isWithinDateRange lines=91-104

.. literalinclude:: ../../../desktop/src/renderer/src/utils/investigationDate.ts
   :language: typescript
   :lines: 91-104
   :lineno-match:

.. CG-EXPLANATION-START id=function:isWithinDateRange

**What this does.** Returns whether an item's date falls within an inclusive from–to range. It parses all three inputs; if neither bound is set every item passes; an item with no parseable date is excluded once any bound is set; and otherwise the item passes when it is within both bounds.

**Why it is here.** The docstring records that it deliberately takes raw strings and is pure, so callers depend only on stable text inputs and no per-render date object leaks into a memo dependency array. The semantics are shared by the CPT and borehole list filters so the two tabs cannot diverge, and excluding a dateless item once a range is set is the least surprising behaviour once the engineer has constrained dates.

.. CG-EXPLANATION-END id=function:isWithinDateRange

