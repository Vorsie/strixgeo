groundmodel.domain.services.surface_bound
=========================================

.. CG-PAGE source=src/groundmodel/domain/services/surface_bound.py complete=true

*Source file:* ``src/groundmodel/domain/services/surface_bound.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../src/groundmodel/domain/services/surface_bound.py
   :language: python
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces a value object that wraps a triangulated geological band surface and answers "what elevation does this band sit at here?" queries. It imports the TIN evaluator and its nearest-vertex fallback and the TIN type.

**Why it is here.** The voxel litho builder uses these surfaces to confine the labelled grid to a single geological band, because the geological surfaces are the band's hard top and base (owner directive 2026-06-11: geology prevails, litho interfingers only within each geological unit). It is pure data plus geometry, with no I/O, so the 3-D builder can bound itself against the parent geological model without touching the database.

.. CG-EXPLANATION-END id=module-header

Class ``SurfaceBound`` — header
-------------------------------

.. CG-BLOCK id=class:SurfaceBound lines=20-58

.. literalinclude:: ../../../src/groundmodel/domain/services/surface_bound.py
   :language: python
   :lines: 20-58
   :lineno-match:

.. CG-EXPLANATION-START id=class:SurfaceBound

**What this does.** A frozen holder for one band surface: its vertices as map-coordinate-plus-elevation triples, its triangles as index triples, and a prebuilt TIN view kept in a private field that is not part of the value.

**Why it is here.** It is used as a curved top or base so a build is confined to one geological band. The docstring is careful to call it a frozen handle to mesh data, not a value key: it carries lists, so it is not hashable and its lists are mutable, and it mirrors the standard TIN convention so a band surface can be lifted straight from a cached formation-surface TIN. The private TIN view is excluded from equality and the constructor so it does not affect identity.

.. CG-EXPLANATION-END id=class:SurfaceBound

Method ``SurfaceBound``. ``def from_tin``
-----------------------------------------

.. CG-BLOCK id=method:SurfaceBound.from_tin lines=59-84

.. literalinclude:: ../../../src/groundmodel/domain/services/surface_bound.py
   :language: python
   :lines: 59-84
   :lineno-match:

.. CG-EXPLANATION-START id=method:SurfaceBound.from_tin

**What this does.** Builds a bound from an existing cached TIN, reusing that TIN directly as the evaluation surface rather than re-triangulating.

**Why it is here.** The parent model's formation-surface TINs are lifted into band surfaces, and this is the single place that unpacks their vertices and triangles so no caller has to. It reuses the caller's prebuilt TIN — identical mesh — instead of the equivalent one the initialiser would otherwise build, saving a copy and a re-triangulation.

.. CG-EXPLANATION-END id=method:SurfaceBound.from_tin

Method ``SurfaceBound``. ``def __post_init__``
----------------------------------------------

.. CG-BLOCK id=method:SurfaceBound.__post_init__ lines=85-99

.. literalinclude:: ../../../src/groundmodel/domain/services/surface_bound.py
   :language: python
   :lines: 85-99
   :lineno-match:

.. CG-EXPLANATION-START id=method:SurfaceBound.__post_init__

**What this does.** Builds the TIN view once, right after construction, storing it in the private field through the low-level setter that is the only way to write a field on a frozen object.

**Why it is here.** Before this cache, every elevation query rebuilt a fresh TIN, which was wasteful in the band-assignment hot loop where each surface is sampled once per investigation. Building it once and reusing it makes that loop cheap.

.. CG-EXPLANATION-END id=method:SurfaceBound.__post_init__

Method ``SurfaceBound``. ``def evaluate``
-----------------------------------------

.. CG-BLOCK id=method:SurfaceBound.evaluate lines=100-131

.. literalinclude:: ../../../src/groundmodel/domain/services/surface_bound.py
   :language: python
   :lines: 100-131
   :lineno-match:

.. CG-EXPLANATION-START id=method:SurfaceBound.evaluate

**What this does.** Returns the band's elevation at a map point. It interpolates within the triangulated surface; when the point falls outside every triangle it falls back to the nearest vertex's elevation, and it raises an error only when the surface has no vertices at all.

**Why it is here.** It reuses the TIN view built once at construction so the interpolation is not re-derived per call. The nearest-vertex fallback matches the band-assignment convention used elsewhere, so a query just outside the surface footprint still returns a usable elevation rather than nothing; only a truly empty surface, which cannot supply any fallback, is an error.

.. CG-EXPLANATION-END id=method:SurfaceBound.evaluate

