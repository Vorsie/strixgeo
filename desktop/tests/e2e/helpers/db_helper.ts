/**
 * Read-only PostgreSQL helper for the Strix smoke harness.
 *
 * Connects to the integration DB (``DATABASE_URL`` env var, must end in
 * ``_integration`` or ``_test``) to assert post-interaction DB state.
 * Every method opens a fresh connection per call and releases it
 * immediately — no pooling, no persistent state, no writes.
 *
 * The safety guard mirrors the backend's integration-test guard: if
 * ``DATABASE_URL`` does not end in ``_integration`` or ``_test``, every
 * call throws before touching the DB so the dev DB can't be read
 * mistakenly (reading is safe, but the guard prevents accidental misuse).
 *
 * Table mapping (matches the ORM models — do NOT invent table names):
 * - Contacts live in ``formation_contact`` (joined to ``geological_model``
 *   filtered by ``kind = 'lithostratigraphic'``).
 * - Litho models are rows in ``geological_model`` with ``kind = 'lithostratigraphic'``.
 * - Formation absences live in ``formation_absence`` (joined to
 *   ``geological_formation`` to reach ``app_project_id``).
 * - Lens metadata lives in ``litho_lens`` keyed by
 *   ``(model_id, formation_id, body_ordinal)``.
 * - Correlation edges live in ``litho_correlation_edge`` (joined to
 *   ``geological_model`` filtered by ``kind = 'lithostratigraphic'``).
 */

import { Client } from 'pg'

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://groundmodel:groundmodel@localhost:5433/groundmodel_integration'

/**
 * Verify the DATABASE_URL is pointing at a test/integration DB.
 *
 * Raises
 * ------
 * Error
 *   If the URL does not end in ``_integration`` or ``_test``.
 */
function assertTestDb(): void {
  const url = DATABASE_URL.toLowerCase()
  if (!url.endsWith('_integration') && !url.endsWith('_test')) {
    throw new Error(
      `db_helper: DATABASE_URL must end in _integration or _test.\n` +
        `Current value: ${DATABASE_URL}\n` +
        'Set DATABASE_URL to point at groundmodel_integration.',
    )
  }
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  assertTestDb()
  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

/**
 * Count lithostratigraphic contacts (``formation_contact`` rows via
 * ``geological_model`` with ``kind='lithostratigraphic'``) for a project.
 *
 * Parameters
 * ----------
 * projectId : string
 *   UUID of the app project.
 *
 * Returns
 * -------
 * number
 *   Row count.
 */
export async function countContacts(projectId: string): Promise<number> {
  return withClient(async (client) => {
    const res = await client.query<{ n: string }>(
      `SELECT COUNT(*) AS n
         FROM formation_contact fc
         JOIN geological_model gm ON gm.id = fc.model_id
        WHERE gm.app_project_id = $1
          AND gm.kind = 'lithostratigraphic'`,
      [projectId],
    )
    return parseInt(res.rows[0].n, 10)
  })
}

/**
 * Count correlation edges (``litho_correlation_edge`` rows) for a project's
 * lithostratigraphic models.
 *
 * Parameters
 * ----------
 * projectId : string
 *   UUID of the app project.
 *
 * Returns
 * -------
 * number
 *   Row count.
 */
export async function countCorrelationEdges(projectId: string): Promise<number> {
  return withClient(async (client) => {
    const res = await client.query<{ n: string }>(
      `SELECT COUNT(*) AS n
         FROM litho_correlation_edge lce
         JOIN geological_model gm ON gm.id = lce.model_id
        WHERE gm.app_project_id = $1
          AND gm.kind = 'lithostratigraphic'`,
      [projectId],
    )
    return parseInt(res.rows[0].n, 10)
  })
}

/**
 * List formation-absence rows for a project.
 *
 * Each absence row represents a (formation, investigation) pair where the
 * formation is absent at the investigation's location. Used to assert that
 * the bulk-accept flow triggered exactly one ``recompute-all-absences`` pass.
 *
 * The ``formation_absence`` table has no direct project FK; we reach the
 * project via ``formation_absence.formation_id → geological_formation.id``
 * and then filter on ``geological_formation.app_project_id``.
 *
 * Parameters
 * ----------
 * projectId : string
 *   UUID of the app project.
 *
 * Returns
 * -------
 * Array of objects with ``formation_id`` and ``investigation_id``.
 */
export async function listFormationAbsences(
  projectId: string,
): Promise<Array<{ formation_id: string; investigation_id: string }>> {
  return withClient(async (client) => {
    const res = await client.query<{ formation_id: string; investigation_id: string }>(
      `SELECT fa.formation_id,
              fa.investigation_id
         FROM formation_absence fa
         JOIN geological_formation f ON f.id = fa.formation_id
        WHERE f.app_project_id = $1`,
      [projectId],
    )
    return res.rows
  })
}

/**
 * Fetch a lens metadata row by its body ordinal within a lithostratigraphic
 * model for a project.
 *
 * The ``litho_lens`` table is keyed by ``(model_id, formation_id, body_ordinal)``.
 * This helper finds the first lens in the project's litho model that has the
 * given ``body_ordinal``, regardless of which formation it belongs to.
 *
 * Parameters
 * ----------
 * projectId : string
 *   UUID of the app project.
 * bodyOrdinal : number
 *   0-based body ordinal assigned by the correlation-graph resolver.
 *
 * Returns
 * -------
 * Object with ``id`` and ``name``, or ``null`` if not found.
 */
export async function getLensByOrdinal(
  projectId: string,
  bodyOrdinal: number,
): Promise<{ id: string; name: string | null } | null> {
  return withClient(async (client) => {
    const res = await client.query<{ id: string; name: string | null }>(
      `SELECT ll.id, ll.name
         FROM litho_lens ll
        WHERE ll.app_project_id = $1
          AND ll.body_ordinal = $2
        LIMIT 1`,
      [projectId, bodyOrdinal],
    )
    return res.rows[0] ?? null
  })
}

/**
 * Count auto-correlated edges (``source = 'auto'``) for a project's
 * lithostratigraphic models.
 *
 * Parameters
 * ----------
 * projectId : string
 *   UUID of the app project.
 *
 * Returns
 * -------
 * number
 *   Row count.
 */
export async function countAutoCorrelationEdges(projectId: string): Promise<number> {
  return withClient(async (client) => {
    const res = await client.query<{ n: string }>(
      `SELECT COUNT(*) AS n
         FROM litho_correlation_edge lce
         JOIN geological_model gm ON gm.id = lce.model_id
        WHERE gm.app_project_id = $1
          AND gm.kind = 'lithostratigraphic'
          AND lce.source = 'auto'`,
      [projectId],
    )
    return parseInt(res.rows[0].n, 10)
  })
}

/**
 * Fetch all lithostratigraphic model IDs for a project.
 *
 * Parameters
 * ----------
 * projectId : string
 *   UUID of the app project.
 *
 * Returns
 * -------
 * string[]
 *   Array of geological_model UUIDs where kind = 'lithostratigraphic'.
 */
export async function listLithoModelIds(projectId: string): Promise<string[]> {
  return withClient(async (client) => {
    const res = await client.query<{ id: string }>(
      `SELECT id
         FROM geological_model
        WHERE app_project_id = $1
          AND kind = 'lithostratigraphic'`,
      [projectId],
    )
    return res.rows.map((r) => r.id)
  })
}
