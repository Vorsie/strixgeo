// Thrown when the 3-D build's inputs did not all load.
//
// Audit 2026-08-02, Class 1: the build path used to swallow a failed
// per-section correlation fetch (→ zero edges for that section) and a failed
// body-boundary fetch (→ no hand-drawn overrides at all), then persist the
// resulting model behind a green "Built N bodies" toast. The distinguishing
// property this error carries is that its message is written FOR THE ENGINEER
// — the build handler surfaces `message` verbatim in an error toast instead of
// the generic connection copy.
//
// Follow-up (not built in this pass): the audit's structural fix is one shared
// `PartialResult<T> { value, failedCount, failures[] }` across every fan-out,
// with toast severity derived from `failedCount` rather than chosen by the
// caller. This class is the surgical per-site version of that idea.

/**
 * A build was cancelled because one of its inputs could not be loaded.
 *
 * Carries a user-facing message: the build handler shows it as-is, so it must
 * name what failed and what to do about it.
 *
 * No ``Object.setPrototypeOf`` here: ``tsconfig.web.json`` targets ES2020, so
 * ``class ... extends Error`` emits a native class and the prototype chain is
 * intact — ``instanceof`` works. (The line was here with an "ES5 target"
 * justification that did not match the build, and ``ApiError``, whose
 * ``instanceof`` is far more load-bearing, never had it — audit 2026-08-02.)
 */
export class VoxelBuildInputsError extends Error {
  /**
   * @param message User-facing explanation — named sections/inputs + "retry".
   */
  constructor(message: string) {
    super(message)
    this.name = 'VoxelBuildInputsError'
  }
}
