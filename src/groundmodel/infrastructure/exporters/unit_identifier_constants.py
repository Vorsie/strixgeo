"""Constants for the export unit-identifier scheme (debt #104).

The scheme is a published contract: an engineer reading a DXF layer
list or a Plaxis material list must be able to key a script on it, and
the same token must appear identically in every artefact we write. So
the tokens live here rather than inline in each exporter — a change to
the scheme is a change to ONE file, and the tests import the same
values the exporters emit.
"""

from __future__ import annotations

# Leading token of a geotechnical unit's identifier. Kept verbose
# (``NAD-`` rather than ``N``) because the receiving engineer reads it
# in a CAD layer manager with no legend to explain an abbreviation.
NAD_TOKEN_PREFIX = "NAD-"

# Zero-pad width for the NAD packing class. Classes run 1..31, and CAD
# layer managers / Plaxis material lists sort as TEXT — without the pad,
# "NAD-21" sorts before "NAD-6" and the list reads scrambled. Two digits
# covers the whole 1..31 vocabulary; a wider class number still renders
# (``format`` widens rather than truncates), it just stops sorting.
NAD_TOKEN_DIGITS = 2

# Joins the class token to the soil token: ``NAD-06_ZAND``. Underscore
# rather than the hyphen used between identifier and display name, so a
# reader (and a regex) can tell the two joins apart.
UNIT_ID_SOIL_SEPARATOR = "_"

# Joins the machine identifier to the human display name in a DXF layer
# name and a Plaxis material identification.
UNIT_ID_NAME_SEPARATOR = " - "

# Appended to the SECOND and later PLAXIS material that would otherwise
# claim an identification already taken (``... #2``). PLAXIS accepts a
# free-form identification, so the plain ordinal reads better there than
# the formation short id the DXF has to use for its length-capped,
# case-folded layer names.
DUPLICATE_MATERIAL_SUFFIX = " #"

# Characters DXF forbids in a layer name. Duplicated nowhere else: the
# DXF exporter's own sanitiser imports this set, and the identifier
# builder strips against it so a dirty upstream soil token can never
# push an illegal character into a layer name.
DXF_FORBIDDEN_LAYER_CHARS = frozenset("<>/\\\":;?*|='")

# Mapping-table chrome. Shared by the DXF (model-space TEXT) and the
# Plaxis script (docstring header) so the engineer sees one table shape
# whichever artefact reached them.
MAPPING_TABLE_TITLE = "UNIT MAPPING TABLE"
MAPPING_TABLE_RULE_CHAR = "-"
MAPPING_TABLE_GAP = "  "
MAPPING_TABLE_ABSENT = "n/a"
# First-column heading — names the artefact-side identity so the reader
# knows which column matches the list in front of them. Both PLAXIS
# exporters (2D section + 3D project) pass the same one.
MAPPING_TABLE_DXF_LAYER_HEADING = "DXF layer"
MAPPING_TABLE_PLAXIS_MATERIAL_HEADING = "Plaxis material"
MAPPING_TABLE_NAD_HEADING = "NAD class"
MAPPING_TABLE_SOIL_HEADING = "Soil"
MAPPING_TABLE_NAME_HEADING = "Strix unit"
MAPPING_TABLE_ID_HEADING = "Strix formation id"

# Column that appears only on a THINNED artefact (debt #104b). Merging
# two same-NAD units erases a litho / geological boundary the engineer
# drew; naming the absorbed units here is what keeps that auditable in
# the delivered file rather than only in the app.
MAPPING_TABLE_ABSORBED_HEADING = "Absorbed units"
MAPPING_TABLE_ABSORBED_JOIN = " + "

# Column that appears only when at least one unit crosses more than one
# geological formation (debt #278, R2). A body may span geological
# boundaries, so its geological attribution is a LIST — every formation
# it falls in, shallowest first — not a single majority stamp. Named
# here so a downstream reader can see the crossing that the single-value
# geological label would have hidden. Absent on a geology-agnostic
# export, which keeps every existing artefact byte-identical.
MAPPING_TABLE_GEO_HEADING = "Geo"
MAPPING_TABLE_GEO_JOIN = " + "
