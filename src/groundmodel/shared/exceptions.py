"""Domain and infrastructure exception hierarchy."""

from __future__ import annotations

from uuid import UUID


class GroundModelError(Exception):
    """Base exception for all ground model errors."""


class ParseError(GroundModelError):
    """Raised when a data file cannot be parsed."""


class DomainValidationError(GroundModelError):
    """Raised when domain invariants are violated."""


class NotFoundError(GroundModelError):
    """Raised when a requested resource does not exist."""


class RepositoryError(GroundModelError):
    """Raised on unexpected database or repository failures."""


class DuplicateCptError(GroundModelError):
    """Raised when a CPT with the same project_id + test_id already exists in this project."""

    def __init__(self, message: str, existing_id: UUID) -> None:
        """Initialise with a human-readable message and the ID of the existing record."""
        super().__init__(message)
        self.existing_id = existing_id


class CptRefreshConfirmationRequiredError(GroundModelError):
    """Raised when re-importing a CPT would overwrite stored data unconfirmed.

    Replacing an existing CPT's series is IRREVERSIBLE — the previous parse is
    gone and every contact anchored on it now sits against different depths.
    ``docs/ux.md`` ("Reversible vs irreversible") makes a confirmation dialog
    the only protection against that class of mistake, so the import refuses
    until the caller re-posts with ``confirm_refresh=true``.

    Carries the diff the dialog shows, so the engineer decides on numbers
    rather than on a filename.

    Parameters
    ----------
    existing_id : UUID
        Row that would be overwritten.
    name : str
        Display name of the stored CPT.
    old_max_depth_m, new_max_depth_m : float | None
        Deepest reading before and after, in metres.
    old_n_rows, new_n_rows : int | None
        Row counts before and after.
    n_errors, n_warnings : int
        Issue counts from the FRESH parse.
    """

    def __init__(
        self,
        existing_id: UUID,
        name: str,
        *,
        old_max_depth_m: float | None,
        new_max_depth_m: float | None,
        old_n_rows: int | None,
        new_n_rows: int | None,
        n_errors: int,
        n_warnings: int,
    ) -> None:
        """Initialise with the row identity and the old-vs-new diff."""
        super().__init__(
            f"CPT {name!r} is already in this project; re-importing replaces its stored "
            f"data ({old_n_rows} rows to {old_max_depth_m} m → {new_n_rows} rows to "
            f"{new_max_depth_m} m). Confirm to replace."
        )
        self.existing_id = existing_id
        self.name = name
        self.old_max_depth_m = old_max_depth_m
        self.new_max_depth_m = new_max_depth_m
        self.old_n_rows = old_n_rows
        self.new_n_rows = new_n_rows
        self.n_errors = n_errors
        self.n_warnings = n_warnings


class CptRefreshRefusedError(GroundModelError):
    """Raised when a fresh parse is too broken to overwrite stored data with.

    A refresh is destructive and has no undo, so a file that parsed to nothing
    usable must never replace a good series — a truncated download or the wrong
    revision of a file would otherwise silently destroy the stored measurement.
    Refused regardless of confirmation: the engineer cannot consent their way
    into overwriting good data with an empty parse.

    Parameters
    ----------
    reason : str
        Machine-readable reason (``"no_rows"`` / ``"parse_errors"``).
    message : str
        Human-readable refusal naming what is wrong with the file.
    """

    def __init__(self, reason: str, message: str) -> None:
        """Initialise with the named reason and the human-readable message."""
        super().__init__(message)
        self.reason = reason


class LithoLayerOverlapError(GroundModelError):
    """Raised when a litho-layer edit would overlap an accepted sibling on its column.

    The ``litho_layer_accepted_no_overlap`` exclusion constraint is the hard
    guarantee; this exception is the clean translation of that DB violation so
    the API answers 409 instead of a raw 500. Carries the offending layer id.
    """

    def __init__(self, layer_id: UUID) -> None:
        """Initialise with the id of the layer whose edit was rejected."""
        super().__init__(
            f"litho layer {layer_id} edit would overlap an accepted layer on the same investigation"
        )
        self.layer_id = layer_id


class VoxelGridTooLargeError(GroundModelError):
    """Raised when a requested 3-D voxel build resolves to more cells than the budget.

    Deliberately NOT a ``ValueError``: ``BuildVoxelLithoModel`` treats a
    ``ValueError`` out of the labeller as "this model is unbuildable" and CLEARS
    the stored 3-D solids, so a spacing the engineer can simply retype must not
    travel that path.

    The router maps this exception to HTTP 422 (Unprocessable Entity).

    Parameters
    ----------
    message : str
        Human-readable refusal naming the resolved grid and a spacing that fits.
    suggested_horizontal_m : float
        The horizontal spacing at which the same model WOULD fit the budget, so
        the client can offer it rather than making the engineer guess.
    """

    def __init__(self, message: str, suggested_horizontal_m: float) -> None:
        """Initialise with the refusal message and the spacing that would fit."""
        super().__init__(message)
        self.suggested_horizontal_m = suggested_horizontal_m


class CrossLithoBodyCorrelationError(GroundModelError):
    """Raised when a geotech packing correlation crosses lithostratigraphic body boundaries.

    A NAD packing class is always a subdivision inside ONE lithostratigraphic
    body; a packing edge must never connect two bands that belong to different
    litho bodies.  "Same lithology" alone is insufficient — two separate sand
    bodies must not be allowed to merge into one packing body.

    The router maps this exception to HTTP 422 (Unprocessable Entity).
    """

    def __init__(self, band_a: str | None = None, band_b: str | None = None) -> None:
        """Initialise, naming the two judged bands when the caller knows them.

        Parameters
        ----------
        band_a : str | None
            Description of the first band (e.g. ``"KLEI (NAD 23) on
            GEO-22/115-S10"``); omitted -> the generic sentence alone.
        band_b : str | None
            Description of the second band.
        """
        named = f"{band_a} and {band_b} are" if band_a and band_b else "these bands are"
        super().__init__(
            f"{named} in different litho bodies — correlate the lithology first in the litho stage"
        )


class CrossingCorrelationError(GroundModelError):
    """Raised when a packing correlation would cross another tie in its gap.

    Owner ruling, 2026-08-17: *"Ties shouldn't be able to cross ... When someone
    tries to draw a crossing tie, send a toast and reject the tie?"*

    A crossing is a HARD CONFLICT by his §8 Q4 ruling: the renderer suspends
    BOTH ties and neither side bands.  So a crossing that lands does not merely
    look wrong — it silently kills the fill on that gap, and the engineer finds
    out later with no idea which gesture caused it.  Refusing at the write is
    the only moment he still has the gesture in mind.

    The message names the COLUMNS and DEPTHS of the tie that is in the way,
    never a database id: his verdict on the existing crossing warning was *"i
    can't rule, unclear for me which tests, don't see gap numbers in the app"*.

    The router maps this exception to HTTP 422 (Unprocessable Entity).
    """

    def __init__(self, standing: str) -> None:
        """Initialise, naming the tie the gesture would have crossed.

        Parameters
        ----------
        standing : str
            The tie in the way, in the engineer's own vocabulary, e.g.
            ``"GEO-23/125-S9 at 8.10 m to 1411-GEO-23/126-B3 at 9.00 m"``.
        """
        super().__init__(
            f"This tie would cross the existing tie {standing} — two ties that cross "
            "leave both bands unfilled, so redraw one of them first"
        )


class DemExtentRefusedError(GroundModelError):
    """Raised when a DEM tile request's extent cannot be a real place.

    Guards the WCS providers against extents that no upstream can answer:
    coordinates outside the project CRS's own area of use (the classic case is
    an extent anchored at (0,0) — section-space or zeroed coordinates that were
    never map coordinates), a non-finite bound, or a span so large the tile
    would be hundreds of megapixels.

    Deliberately NOT an ``httpx`` error: this request never reaches the
    network. The router maps it to HTTP 422 (Unprocessable Entity) with the
    refused extent quoted, so the caller sees WHICH numbers were wrong instead
    of a generic "DEM service unavailable".

    Parameters
    ----------
    message : str
        Human-readable refusal naming the extent and the accepted domain.
    extent : tuple[float, float, float, float]
        The refused ``(min_x, min_y, max_x, max_y)``, echoed to the client.
    """

    def __init__(self, message: str, extent: tuple[float, float, float, float]) -> None:
        """Initialise with the refusal message and the offending extent."""
        super().__init__(message)
        self.extent = extent


class DemUpstreamRecentlyFailedError(GroundModelError):
    """Raised when a DEM tile key failed upstream a short time ago.

    The negative cache (see ``dem_negative_cache.py``) remembers the exact tile
    key a PERMANENT upstream request failure occurred for. Re-asking for the
    same key inside the TTL raises this instead of re-issuing the request — a UI
    that re-mounts and re-fetches cannot turn one bad extent into a request
    flood.

    The routers map it to 502 on ``/dem/sample`` (the section's surface line is
    optional — the panel renders without it) and to 503 on the ground-surface
    build (the build cannot proceed and the caller should retry later). Both are
    documented in ``docs/api.md``.

    Parameters
    ----------
    message : str
        Human-readable message naming the key and how long ago it failed.
    retry_after_seconds : float
        Seconds until the key is retried against the network.
    """

    def __init__(self, message: str, retry_after_seconds: float) -> None:
        """Initialise with the message and the remaining suppression window."""
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


class IncompleteRecomputeCoverageError(GroundModelError):
    """Raised when a body-identity recompute does not speak for every section.

    The recompute REPLACES a model's geometry facts wholesale (audit P1-3,
    2026-08-18): a payload that covers only a subset of the project's sections
    would silently erase the omitted sections' connectivity evidence and split
    persisted bodies on the next resolver run.  The backend cannot infer
    completeness from geometry alone, so the payload names its sections and
    the set must EQUAL the project's — a stale or partially loaded client is
    refused, never obeyed.

    The router maps this exception to HTTP 422 (Unprocessable Entity).
    """


class EmptyRecomputePayloadError(GroundModelError):
    """Raised when a body-identity recompute arrives with no partition content.

    The recompute REPLACES a model's geometry facts wholesale, so a payload
    with zero sections or zero regions is never a legitimate "nothing is
    connected" statement — it is a frontend that fired before its data loaded
    (or whose section assembly failed). Accepting it would wipe every
    geometric merge and silently split bodies across the model. The router
    maps this to 422; the frontend gates its triggers on data-loaded and
    treats the 422 as a bug signal, not a user error.
    """


class DovImportTooLargeError(GroundModelError):
    """Raised when a DOV import would discover more features than the ceiling.

    DOV discovery counts features cheaply (``resultType=hits``) BEFORE any XML
    is downloaded. When the recursive bbox-split resolves more than
    ``DOV_MAX_IMPORT_FEATURES`` unique rows the import stops here — before the
    download phase fans out to thousands of parallel HTTP GETs — so a mis-drawn
    box can never launch a runaway import. The bbox area guard on the request
    schema already refuses continent-sized boxes; this is the second line, for a
    genuinely dense area under the size limit.

    The synchronous import endpoints map this to HTTP 422; the SSE background
    path emits a terminal ``{"type": "error", "code": "dov_import_too_large"}``
    event carrying the same message.

    Parameters
    ----------
    discovered : int
        Number of features the discovery phase found.
    limit : int
        The ceiling that was exceeded (``DOV_MAX_IMPORT_FEATURES``).
    """

    def __init__(self, discovered: int, limit: int) -> None:
        """Initialise with the discovered count and the exceeded ceiling."""
        super().__init__(
            f"this area holds {discovered} DOV records, above the {limit}-record import "
            f"limit; draw a smaller area or split the import"
        )
        self.discovered = discovered
        self.limit = limit


class DovUnreachableError(GroundModelError):
    """Raised when DOV answered NONE of a fan-out's calls for a network reason.

    An external service being slow or down is a degraded path, not a server
    error. A fan-out (e.g. the Virtuele Boring predictions sweep) skips each
    call that fails with a transport error and returns the rest; only when
    EVERY call failed that way is there nothing to return, and this is
    raised. The predictions router maps it to HTTP 503 with ``code =
    "dov_unreachable"``.

    Parameters
    ----------
    failed_calls : int
        How many calls failed (all of them).
    error_classes : dict[str, int]
        Transport-error class name -> count, e.g. ``{"ConnectTimeout": 63}``.
    """

    def __init__(self, failed_calls: int, error_classes: dict[str, int]) -> None:
        """Initialise with the failed-call count and the error-class tally."""
        tally = ", ".join(f"{name} x{count}" for name, count in sorted(error_classes.items()))
        super().__init__(f"DOV did not answer any of {failed_calls} call(s) ({tally})")
        self.failed_calls = failed_calls
        self.error_classes = error_classes


class DuplicateImportJobError(GroundModelError):
    """Raised when an import for the same scope is already running.

    The job registry refuses a second ``start()`` that carries the same
    de-duplication ``key`` (built from the resource kind + bbox + project) while
    the first job's task is still running. Without this a double-click or an
    over-eager retry would launch a second identical DOV import that races the
    first on the same cache directory and DB rows.

    The import-stream endpoints map this to HTTP 409, echoing the running job's
    id so the client can attach to the existing SSE stream instead.

    Parameters
    ----------
    job_id : UUID
        The id of the already-running job for this scope.
    """

    def __init__(self, job_id: UUID) -> None:
        """Initialise with the id of the job already running for this scope."""
        super().__init__(f"an import for this area is already running (job {job_id})")
        self.job_id = job_id


class BuildCancelled(GroundModelError):
    """Raised inside a voxel 3-D build when a cooperative cancel is requested.

    The voxel build's CPU phases run in an ``asyncio.to_thread`` worker that
    Python cannot forcibly kill, so cancellation is COOPERATIVE: a
    :class:`threading.Event` is checked between voxel columns (in
    :func:`~groundmodel.domain.services.voxel_litho.label_voxels.label_voxels`)
    and between phases (in
    :class:`~groundmodel.application.build_voxel_litho_model.BuildVoxelLithoModel`).
    When the flag is set the worker raises this, the use case rolls its session
    back so a cancelled build writes NOTHING, and the background-job coroutine
    emits a terminal ``{"type": "error", "code": "build_cancelled"}`` SSE event.

    Deliberately NOT a ``ValueError``: the labeller's "unbuildable model" arm
    catches ``ValueError`` and CLEARS the stored 3-D solids, and a cancel must
    leave the previous model exactly as it was.
    """


class BodyPartitionContentionError(GroundModelError):
    """Raised when a body-partition write waits past ``lock_timeout`` for its lock.

    ``lock_body_partition`` serialises every body-partition rewrite for one
    model on a transaction-scoped advisory lock. Under ``lock_timeout`` (set on
    the session), the blocking acquire aborts rather than hanging forever if
    another writer holds the lock for the whole window. That abort surfaces as
    asyncpg's ``LockNotAvailableError``; the helper catches it and raises this
    so the API answers a clean 409 that names the operation instead of a raw
    500 (or, worse, a hung request).

    The router maps this exception to HTTP 409 with ``code =
    "body_partition_locked"``.

    Parameters
    ----------
    operation : str
        Human name of the caller that gave up waiting, e.g.
        ``"bodies/recompute"``.
    model_id : UUID
        The model whose partition lock could not be acquired.
    """

    def __init__(self, operation: str, model_id: UUID) -> None:
        """Initialise, naming the waiting operation and the contended model."""
        super().__init__(
            f"the body model {model_id} is busy: {operation!r} waited past the lock timeout "
            "for another body-partition write (correlate / accept / band edit / subdivide / "
            "bodies/recompute) to finish. Try again in a moment"
        )
        self.operation = operation
        self.model_id = model_id
