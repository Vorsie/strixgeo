"""Pydantic request and response schemas.

Schemas are organised by resource:

* ``schemas/cpt/`` — CPT routes
* ``schemas/borehole/`` — Borehole routes
* ``schemas/validation_issue_schema.py`` — shared by both

Convention: one Pydantic class per file, named after the class in
``snake_case``. ``__init__`` modules are intentionally empty so each
class is imported through its own module path (no implicit re-exports).
"""
