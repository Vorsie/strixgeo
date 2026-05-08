"""Lab-test parsers — DOV today, future formats later.

DOV grain-size, Atterberg, CaCO3, organic, and water-content tests are all
exposed through the same ``monster:observaties`` WFS layer (filtered by
``parametergroep``) and per-observation XML at ``/data/observatie/{permkey}.xml``.
Phase B3 adds the grain-size parser; the other lab tests share the
observation-XML envelope and will land as separate parsers when their
ingestion pipelines come online.
"""
