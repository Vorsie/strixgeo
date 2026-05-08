"""Shared DOV (Databank Ondergrond Vlaanderen) parser primitives.

Holds constants and helpers that are common to every DOV-derived parser
(CPT sonderings, boreholes, samples, observations) — WFS endpoint URL,
namespaces, coordinate transformer, permkey regex. Test-type-specific
constants (layer names, URL prefixes per resource) live alongside their
respective parsers, in ``cpt/dov/`` and ``borehole/dov/``.
"""
