"""Cross-layer constants + reference codelists.

The layer rule (CLAUDE.md "Architecture": API → Application → Domain ←
Infrastructure) forbids the API layer importing from the domain layer.
Pure constant / enum / codelist modules consumed by more than one layer
live here instead — ``shared/`` is the explicitly cross-layer-permitted
home (debt #54).
"""
