"""DOV (Databank Ondergrond Vlaanderen) borehole parsers.

* ``dov_boring_parser`` parses ``/data/boring/{permkey}.xml`` into a
  ``BoreholeParseResult`` carrying the borehole header, drill segments,
  and field-log intervals.
* ``dov_interpretation_parser`` (Phase B2) parses
  ``/data/interpretatie/{permkey}.xml`` into an ``Observation`` with its
  layers and admixtures.

Constants live in ``dov_constants.py`` per the project convention.
"""
