StrixGeo User Manual
====================

StrixGeo builds and manages the unified subsurface dataset for a ground
engineering project. It ingests your CPT and borehole data, lets you interpret
it into a three-level ground model (geological → lithostratigraphic →
geotechnical), and exports that model to the design tools you already use
(Plaxis, D-Stability, D-Sheet Piling, DXF).

This manual explains, in plain English, **what the program does at every stage**
and — in chapter 3 — **exactly how every calculation is performed**, with the
equation, the published reference, the validity rule the software applies, and a
worked number you can reproduce yourself.

A note on scope, in one sentence: StrixGeo produces a **characterisation** of the
ground — the model geometry, the soil-behaviour classification, the packing
class, and descriptive statistics. It does **not** perform design calculations
(bearing capacity, settlement, slope stability, pile or wall design). Those run
in your downstream tool, using StrixGeo's export as their input. Chapter 1
explains where that line is drawn and why.

.. toctree::
   :maxdepth: 2
   :caption: Contents
   :numbered:

   chapters/01-what-strixgeo-is
   chapters/02-stages
   chapters/03-methods
   chapters/04-references
