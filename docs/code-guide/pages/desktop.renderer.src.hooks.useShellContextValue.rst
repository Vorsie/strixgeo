desktop.renderer.src.hooks.useShellContextValue
===============================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useShellContextValue.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useShellContextValue.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useShellContextValue.ts
   :language: typescript
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Two imports: the ``useMemo`` hook and the ``ShellContextValue`` type. This tiny header opens the file that assembles the one big shared value the whole app shell reads.

**Why it is here.** A *context* is a shared value the whole component tree can read without each parent passing it down by hand; this file builds that value once, so the header needs only the memo hook and the value's declared shape.

.. CG-EXPLANATION-END id=module-header

``interface UseShellContextValueArgs``
--------------------------------------

.. CG-BLOCK id=interface:UseShellContextValueArgs lines=5-178

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useShellContextValue.ts
   :language: typescript
   :lines: 5-178
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseShellContextValueArgs

**What this does.** A long list of inputs — every piece of state and every action the shell needs (the project, the lifecycle flags and handlers, the investigations, the sections, the overlays, the selection coordinator, and more). Each input is typed by pointing at the exact slot it will occupy in the final shared value. These lines also carry the documentation of the function below.

**Why it is here.** Naming each input by its place in the shared value documents the whole shell surface in one spot, and — as the function explains — lets a newly-added field be tracked automatically rather than by hand.

.. CG-EXPLANATION-END id=interface:UseShellContextValueArgs

``function useShellContextValue``
---------------------------------

.. CG-BLOCK id=function:useShellContextValue lines=179-422

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useShellContextValue.ts
   :language: typescript
   :lines: 179-422
   :lineno-match:

.. CG-EXPLANATION-START id=function:useShellContextValue

**What this does.** Assembles the shared shell value with a single ``useMemo`` (a cached computed value). It splits ``geo`` out of the arguments, unpacks the rest, builds the grouped shared value, and derives the memo's dependency array automatically from the plain argument fields plus ``geo``'s individual fields.

**Why it is here.** This is a verbatim relocation of what used to be an inline memo inside the ``App`` component (debt #12): the body and its dependency list are byte-identical to the original, so behaviour is unchanged by construction. ``geo`` is broken down into its individual fields because the geological-model hook returns a freshly-identified object on every redraw — depending on the whole object would make the memo recompute every single time (debt #53). The dependency array is built from the argument values themselves, so adding a field can never leave the dependency list drifting behind the body; a dropped name would be a compile error instead of a silent stale-context bug. The ``eslint-disable`` carries a ``// reason:`` comment noting that this auto-derived list IS the load-bearing safety mechanism and that the linter only understands a fixed written-out list — exactly what has been replaced on purpose — and a companion test pins the failure modes so a future slip fails loudly rather than serving stale context across the whole app.

.. CG-EXPLANATION-END id=function:useShellContextValue

