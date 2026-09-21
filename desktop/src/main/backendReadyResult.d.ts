/**
 * The single source of truth for the ``api:ready`` IPC result shape.
 *
 * A readiness wait answers one of three things: ``true`` (the backend is
 * serving), ``false`` (a real failure — the process exited, a foreign process
 * holds the port, or every readiness window was spent), or ``'still-starting'``
 * (alive but past this window's budget, ask again). A caller that treats the
 * truthy STRING as "ready" would proceed over a backend that is not up yet, so
 * the union must be named in ONE place and referenced everywhere.
 *
 * It lives in a dependency-free DECLARATION module so BOTH sides of the IPC can
 * name it without duplicating the union: the main process (``backendProbe.ts``,
 * which re-exports it), the preload bridge (``preload/index.ts``), and the
 * renderer's ambient contract (``renderer/src/electronApi.d.ts``). A ``.d.ts``
 * with no imports carries no runtime, so a renderer type-import of it never
 * drags the node-only main module graph (``crypto`` and friends) into the
 * renderer's TypeScript project, and the composite renderer project accepts a
 * declaration file it does not itself list.
 *
 * @module main/backendReadyResult
 */

/** A readiness wait either succeeds, fails, or needs another long-start window. */
export type BackendReadyResult = true | false | 'still-starting'
