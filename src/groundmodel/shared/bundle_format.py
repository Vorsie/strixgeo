"""Bundle (.gmproj) format-version constants.

These live in ``shared`` — the common floor every layer may import — so both
the API schema (which sets the ``format_version`` default and rejects old
versions on restore) AND the infrastructure build/restore path can reference
them without infrastructure depending on the API layer. The clean-architecture
rule is that dependencies flow ``API → Application → Domain ← Infrastructure``;
a constant imported by both ends belongs at the shared floor, not in an API
schema module.

See CLAUDE.md "Backwards Compatibility" for the version-bump contract and the
``ProjectBundleRequest`` schema docstring for the full v4 payload shape.
"""

from __future__ import annotations

# Current bundle format version. Bumped when the bundle shape changes in a way
# readers must branch on; new saves always emit this version.
#
# v4 (A4 of the unified litho boundary model) — every geological-model payload
# nests a ``litho_layers`` array carrying the Shape A primitives (id,
# formation_id, anchor, depth_top_m, depth_base_m, status, source, confidence,
# ...). Geological models emit an empty list; litho models emit ALL layers
# (pending / accepted / rejected). The ``contacts`` array stays populated on
# litho models too for now (correlation edges + legacy FE keep working through
# the cut-over).
BUNDLE_FORMAT_VERSION = 4

# Versions a current build accepts on restore. v3 stays parseable (the FC↔LL
# trigger fills litho_layer from contacts on the way in), v4 is the current
# writer. Backwards-compat is suspended pre-ship per the memory files; once
# shipped, every older version stays in this set forever with an explicit
# upgrade chain.
SUPPORTED_BUNDLE_VERSIONS: frozenset[int] = frozenset({3, 4})
