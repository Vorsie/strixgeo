desktop.renderer.src.components.sections.CptDataColumn
======================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/CptDataColumn.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/CptDataColumn.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-49

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CptDataColumn.tsx
   :language: tsx
   :lines: 1-49
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file that draws a CPT's depth-series curves on the cross-section as one shared horizontal band centred on the column: cone resistance qc reading rightward, friction ratio Rf mirrored leftward, and sleeve friction fs, pore pressure u2, and total resistance q_total as optional overlays. The imports pull in React's memory hook, the CPT plot type, and the channel definitions and default scales.

**Why it is here.** The layout follows the DOV 'lengteprofiel' report page-3 convention so an engineer reads the section the way they read the official CPT graph. The docstring is explicit about what is deliberately left out: per-CPT auto-scaling (the whole point of DOV is one shared scale across the section) and coloured soil-behaviour-type fills (a Phase 5 concern).

.. CG-EXPLANATION-END id=module-header

``const QC_COLOR``
------------------

.. CG-BLOCK id=const:QC_COLOR lines=50-50

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CptDataColumn.tsx
   :language: tsx
   :lines: 50-50
   :lineno-match:

.. CG-EXPLANATION-START id=const:QC_COLOR

**What this does.** A constant — the colour of the qc (cone resistance) curve, black.

**Why it is here.** Black marks the cone-resistance family; qc is the primary trace the engineer reads the column for.

.. CG-EXPLANATION-END id=const:QC_COLOR

``const QT_COLOR``
------------------

.. CG-BLOCK id=const:QT_COLOR lines=51-51

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CptDataColumn.tsx
   :language: tsx
   :lines: 51-51
   :lineno-match:

.. CG-EXPLANATION-START id=const:QT_COLOR

**What this does.** A constant — the colour of the q_total curve, a dark grey close to black.

**Why it is here.** It sits in the same near-black cone-resistance family as qc, drawn dashed to set it apart (it applies to mechanical cones only).

.. CG-EXPLANATION-END id=const:QT_COLOR

``const RF_COLOR``
------------------

.. CG-BLOCK id=const:RF_COLOR lines=52-52

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CptDataColumn.tsx
   :language: tsx
   :lines: 52-52
   :lineno-match:

.. CG-EXPLANATION-START id=const:RF_COLOR

**What this does.** A constant — the colour of the Rf (friction ratio) curve, brown.

**Why it is here.** It matches the borelog's Rf chart so the friction ratio reads consistently across the app.

.. CG-EXPLANATION-END id=const:RF_COLOR

``const FS_COLOR``
------------------

.. CG-BLOCK id=const:FS_COLOR lines=53-53

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CptDataColumn.tsx
   :language: tsx
   :lines: 53-53
   :lineno-match:

.. CG-EXPLANATION-START id=const:FS_COLOR

**What this does.** A constant — the colour of the fs (sleeve friction) curve, green.

**Why it is here.** A distinct colour so the optional sleeve-friction overlay is told apart from the other traces.

.. CG-EXPLANATION-END id=const:FS_COLOR

``const U2_COLOR``
------------------

.. CG-BLOCK id=const:U2_COLOR lines=54-55

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CptDataColumn.tsx
   :language: tsx
   :lines: 54-55
   :lineno-match:

.. CG-EXPLANATION-START id=const:U2_COLOR

**What this does.** A constant — the colour of the u2 (pore pressure) curve, purple.

**Why it is here.** A distinct colour so the optional pore-pressure overlay is told apart from the other traces.

.. CG-EXPLANATION-END id=const:U2_COLOR

``const GRID_COLOR``
--------------------

.. CG-BLOCK id=const:GRID_COLOR lines=56-56

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CptDataColumn.tsx
   :language: tsx
   :lines: 56-56
   :lineno-match:

.. CG-EXPLANATION-START id=const:GRID_COLOR

**What this does.** A constant — the colour of the reference gridlines, a light grey.

**Why it is here.** A light tone marks the reference lines without competing with the data curves.

.. CG-EXPLANATION-END id=const:GRID_COLOR

``const TRACK_BG``
------------------

.. CG-BLOCK id=const:TRACK_BG lines=57-59

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CptDataColumn.tsx
   :language: tsx
   :lines: 57-59
   :lineno-match:

.. CG-EXPLANATION-START id=const:TRACK_BG

**What this does.** A constant — the white background behind the curves.

**Why it is here.** A white track makes the thin curves readable; its opacity is controlled separately so it does not muddy an overlaying interpretation band.

.. CG-EXPLANATION-END id=const:TRACK_BG

``const DEFAULT_CARD_VEIL_OPACITY``
-----------------------------------

.. CG-BLOCK id=const:DEFAULT_CARD_VEIL_OPACITY lines=60-60

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CptDataColumn.tsx
   :language: tsx
   :lines: 60-60
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_CARD_VEIL_OPACITY

**What this does.** A constant — the default opacity of the white track background.

**Why it is here.** It is the historical value kept as the default so a caller that does not care (the geological axis, the test harness) renders exactly as before.

.. CG-EXPLANATION-END id=const:DEFAULT_CARD_VEIL_OPACITY

``const TRACK_BORDER``
----------------------

.. CG-BLOCK id=const:TRACK_BORDER lines=61-61

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CptDataColumn.tsx
   :language: tsx
   :lines: 61-61
   :lineno-match:

.. CG-EXPLANATION-START id=const:TRACK_BORDER

**What this does.** A constant — the colour of the thin line down each edge of the track.

**Why it is here.** A faint border marks the band's extent without drawing attention.

.. CG-EXPLANATION-END id=const:TRACK_BORDER

``const LABEL_FILL``
--------------------

.. CG-BLOCK id=const:LABEL_FILL lines=62-67

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CptDataColumn.tsx
   :language: tsx
   :lines: 62-67
   :lineno-match:

.. CG-EXPLANATION-START id=const:LABEL_FILL

**What this does.** A constant — the colour of the gridline value labels.

**Why it is here.** A muted grey keeps the small scale labels legible but subordinate.

.. CG-EXPLANATION-END id=const:LABEL_FILL

``const FS_FULL_SCALE_MPA``
---------------------------

.. CG-BLOCK id=const:FS_FULL_SCALE_MPA lines=68-68

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CptDataColumn.tsx
   :language: tsx
   :lines: 68-68
   :lineno-match:

.. CG-EXPLANATION-START id=const:FS_FULL_SCALE_MPA

**What this does.** A constant — the full-scale value for the sleeve-friction axis, 0.5 MPa.

**Why it is here.** It is sensitive enough for typical soft-soil readings while keeping the trace inside the shared band; per-CPT auto-scaling is deliberately not done, as that would defeat the one-scale-across-the-section rule.

.. CG-EXPLANATION-END id=const:FS_FULL_SCALE_MPA

``const U2_FULL_SCALE_MPA``
---------------------------

.. CG-BLOCK id=const:U2_FULL_SCALE_MPA lines=69-70

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CptDataColumn.tsx
   :language: tsx
   :lines: 69-70
   :lineno-match:

.. CG-EXPLANATION-START id=const:U2_FULL_SCALE_MPA

**What this does.** A constant — the full-scale value for the pore-pressure axis, 1.0 MPa.

**Why it is here.** Same reasoning as the sleeve-friction scale above — a fixed sensitivity that keeps the trace inside the band and honours the shared-scale rule.

.. CG-EXPLANATION-END id=const:U2_FULL_SCALE_MPA

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=71-126

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CptDataColumn.tsx
   :language: tsx
   :lines: 71-126
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs: the CPT plot data and type, which channels are on, the band half-width and column screen X, the surface elevation and plot bounds, the elevation-to-screen converter, whether to show gridline labels, an overlay-only mode, the section-wide qc full scale, and the track-veil opacity.

**Why it is here.** The section-wide qc scale is passed in so every column reads on the same axis. The overlay mode lets the panel draw a second pass of just the reference gridlines on top of the soil fill bands, which would otherwise drown the thin lines. The veil opacity is dropped where an interpretation band paints over the track, because an opaque white backing under a translucent band makes the fill look like it stops at the column edge.

.. CG-EXPLANATION-END id=interface:Props

``function CptDataColumn``
--------------------------

.. CG-BLOCK id=function:CptDataColumn lines=127-507

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CptDataColumn.tsx
   :language: tsx
   :lines: 127-507
   :lineno-match:

.. CG-EXPLANATION-START id=function:CptDataColumn

**What this does.** The component. It pre-computes each sample's screen Y once, decides which channels apply for this CPT type, and computes the band's vertical extent and the gridline positions. In overlay mode it emits only the reference gridlines, their labels, and the qc and Rf curves; otherwise it draws the white track, the gridlines and labels, a surface tick, and every enabled curve.

**Why it is here.** The screen-Y memo is declared before any early exit so the hook order stays stable even when no channel is enabled (Rules of Hooks). The qc and Rf curves ride up into the overlay pass because they carry the reference lines and qc is the trace the engineer reads the column for, while fs, u2, and q_total stay in the first pass to avoid a second full render. The whole group ignores pointer events so it never intercepts a contact or suggestion drag.

.. CG-EXPLANATION-END id=function:CptDataColumn

``function curvePath``
----------------------

.. CG-BLOCK id=function:curvePath lines=508-541

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CptDataColumn.tsx
   :language: tsx
   :lines: 508-541
   :lineno-match:

.. CG-EXPLANATION-START id=function:curvePath

**What this does.** A helper *function* (a named piece of reusable logic) that turns a depth-versus-value series into an SVG *path* — a string of move and line commands describing the curve. It walks the samples, plots each rightward or leftward from the axis by its fraction of the full scale, clips out-of-scale spikes to the band edge, and breaks the curve into separate pieces at missing (NoData) samples.

**Why it is here.** The direction argument lets one function draw both the rightward channels (qc, fs, q_total) and the mirrored leftward ones (Rf, u2). Breaking the line at missing samples means the curve never bridges a straight line across a data gap — engineers expect a gap, not an invented value.

.. CG-EXPLANATION-END id=function:curvePath

