desktop.renderer.src.hooks.useProjectBodyRecompute
==================================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useProjectBodyRecompute.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useProjectBodyRecompute.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-44

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProjectBodyRecompute.ts
   :language: typescript
   :lines: 1-44
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening comment and its imports. The comment names this hook's three jobs; then it pulls in four React hooks (``useCallback``, ``useEffect``, ``useMemo``, ``useRef`` — ``useMemo`` caches a computed value so it is only recomputed when its inputs change), two payload-assembly helpers, the position/layer/section types, the debounced scheduler from the ``useBodyRecompute`` page, and a helper that maps a formation row to its packing class.

**Why it is here.** This hook is the shell-level wiring around the debounced scheduler introduced on the ``desktop.renderer.src.hooks.useBodyRecompute`` page. The comment records why it is mounted once in ``App`` and not inside the Sections stage (owner ruling 2026-08-12): the inputs it assembles — investigations, layers, sections, edges — are loaded by the shell no matter which stage is on screen, so a litho edit must still recompute litho even while the user is looking at another stage. Its three jobs are the project-open trigger (schedule one recompute per model when a project finishes loading), the nonce watch (turn each mutation's counter bump into a debounced schedule), and holding the scheduler plus the bridge to the toolbar's manual button.

.. CG-EXPLANATION-END id=module-header

``const sectionsBodyRecomputeCallback``
---------------------------------------

.. CG-BLOCK id=const:sectionsBodyRecomputeCallback lines=45-64

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProjectBodyRecompute.ts
   :language: typescript
   :lines: 45-64
   :lineno-match:

.. CG-EXPLANATION-START id=const:sectionsBodyRecomputeCallback

**What this does.** A tiny shared holder with one field, ``current``, that starts as null and later holds the manual recompute function. The toolbar reads it to fire a recompute for the active axis's model.

**Why it is here.** The docstring calls this a module-ref bridge, the same pattern as ``lithoVoxelRequestCallback``: the toolbar button has no access to the scheduler that lives inside this hook, so the hook writes its ``recomputeNow`` function into this shared holder every redraw and the toolbar calls it from there.

.. CG-EXPLANATION-END id=const:sectionsBodyRecomputeCallback

``const sectionsDividePartitionCallback``
-----------------------------------------

.. CG-BLOCK id=const:sectionsDividePartitionCallback lines=65-71

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProjectBodyRecompute.ts
   :language: typescript
   :lines: 65-71
   :lineno-match:

.. CG-EXPLANATION-START id=const:sectionsDividePartitionCallback

**What this does.** A second module-ref bridge, the same shape as the one above, holding the function that assembles the 2-D geometry the toolbar's “4 · Divide boreholes” button needs for one section.

**Why it is here.** The docstring records that the divide reads each borehole column off the 2-D geometry it stands in (owner ruling 2026-08-15), and this hook is where the inputs that geometry is built from already live — the visible sections, every investigation's position, and the geotech bands — while the toolbar has none of them. Returning null when the geometry cannot be assembled makes the divide fall back to the engine's donor rule, exactly as before the geometry existed.

.. CG-EXPLANATION-END id=const:sectionsDividePartitionCallback

``interface UseProjectBodyRecomputeArgs``
-----------------------------------------

.. CG-BLOCK id=interface:UseProjectBodyRecomputeArgs lines=72-124

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProjectBodyRecompute.ts
   :language: typescript
   :lines: 72-124
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseProjectBodyRecomputeArgs

**What this does.** Describes everything this wiring reads: the project id; the visible sections, CPTs and boreholes; the litho model's id and layer rows; the geotech model's id, band rows, a loaded flag and its formation rows; the two coordinator counters (one per axis) that mutation sites bump; and the toast function.

**Why it is here.** The docstrings record several guards. ``geotechLayersLoaded`` disambiguates an empty ``geotechLayers`` array — the data bus clears the array before every refetch and on a failed load, so emptiness alone cannot mean “nothing is committed”. ``geotechFormations`` carries the class identity: the model keeps one formation row per (class, litho parent, geological parent), so identity evidence must compare the CLASS, never the row (owner 2026-08-21, one mass one body, debt #278). The two nonce counters are how any mutation site anywhere in the app asks for a recompute without knowing about this hook.

.. CG-EXPLANATION-END id=interface:UseProjectBodyRecomputeArgs

``function useProjectBodyRecompute``
------------------------------------

.. CG-BLOCK id=function:useProjectBodyRecompute lines=125-333

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProjectBodyRecompute.ts
   :language: typescript
   :lines: 125-333
   :lineno-match:

.. CG-EXPLANATION-START id=function:useProjectBodyRecompute

**What this does.** The hook itself. It first unpacks its inputs, then builds three cached values: ``geotechPackingClassOf`` (a lookup from a formation row to its class, cached with ``useMemo`` so it only rebuilds when the formations change), ``investigations`` (the CPTs and boreholes merged into one position list), and ``buildPayload`` (the function that assembles the data to send for one model — it picks the litho or geotech layer snapshot by the model id, and for a geotech target it also frames the picture on the litho model). It also builds ``buildDividePartitionForSection`` for the divide button. It then starts the debounced scheduler from the ``useBodyRecompute`` page, passing these builders and a ``dataLoaded`` flag that is true once any section exists. It writes ``recomputeNow`` and the divide builder into the two module-ref bridges every redraw, and an effect nulls them on unmount. The rest is the three jobs: a once-per-open marker set that resets when the project changes; two project-open trigger effects (one litho, one geotech) that schedule a single recompute when a model's data has loaded; and two nonce-watch effects that schedule a recompute whenever their counter changes. It returns the scheduler's two functions.

**Why it is here.** The debounce, single-flight and supersede machinery all live in the scheduler introduced on the ``desktop.renderer.src.hooks.useBodyRecompute`` page; this hook only decides WHEN to schedule. The whole design is event-driven on purpose: a once-marker is consumed only when the gate is actually open and the schedule really happens, and a nonce bump that arrives while the gate is closed is left unconsumed, so both re-fire the moment the data loads — fixing the 2026-08-12 defect where the old stage-entry trigger was consumed before its data was ready and the litho model never recomputed on entry. The geotech triggers additionally wait for the litho frame to load, because the geotech identity is framed on the litho picture the render shows (owner ruling R6, debt #278); firing before the litho layers land would frame it on an empty model. The once-marker reset effect is declared before the trigger effects so it runs first on the redraw where the project id changes (effects run in declaration order), and the last-nonce refs are seeded with the mount-time value so mounting never reads a pre-existing counter as a fresh mutation. The bridge-nulling on unmount is guarded to fire only while the shared holder still points at this instance's function, so an older instance tearing down cannot wipe a bridge a newer instance already claimed (debt #276).

.. CG-EXPLANATION-END id=function:useProjectBodyRecompute

