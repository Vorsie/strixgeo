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
 * Count lithostratigraphic contacts (``litho_contact`` rows) for a project.
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
         FROM litho_contact lc
         JOIN litho_model lm ON lm.id = lc.litho_model_id
        WHERE lm.app_project_id = $1`,
      [projectId],
    )
    return parseInt(res.rows[0].n, 10)
  })
}

/**
 * Count correlation edges (``litho_correlation_edge`` rows) for a project.
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
         JOIN litho_model lm ON lm.id = lce.litho_model_id
        WHERE lm.app_project_id = $1`,
      [projectId],
    )
    return parseInt(res.rows[0].n, 10)
  })
}

/**
 * List formation-absence rows for a project.
 *
 * Each absence row represents a (litho model, investigation, geological
 * formation) triple where the formation is absent in the CPT column.
 * Used to assert that the bulk-accept flow triggered exactly one
 * ``recompute-all-absences`` pass.
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
      `SELECT lfa.geological_formation_id AS formation_id,
              lfa.investigation_id
         FROM litho_formation_absence lfa
         JOIN litho_model lm ON lm.id = lfa.litho_model_id
        WHERE lm.app_project_id = $1`,
      [projectId],
    )
    return res.rows
  })
}

/**
 * Fetch a lens row by its instance ordinal within a litho model.
 *
 * Parameters
 * ----------
 * projectId : string
 *   UUID of the app project.
 * ordinal : number
 *   Instance ordinal (1-based) of the lens within the litho model.
 *
 * Returns
 * -------
 * Object with ``id`` and ``name``, or ``null`` if not found.
 */
export async function getLensByOrdinal(
  projectId: string,
  ordinal: number,
): Promise<{ id: string; name: string | null } | null> {
  return withClient(async (client) => {
    const res = await client.query<{ id: string; name: string | null }>(
      `SELECT li.id, li.name
         FROM litho_instance li
         JOIN litho_model lm ON lm.id = li.litho_model_id
        WHERE lm.app_project_id = $1
          AND li.instance_ordinal = $2
        LIMIT 1`,
      [projectId, ordinal],
    )
    return res.rows[0] ?? null
  })
}

/**
 * Fetch all litho-model IDs for a project.
 *
 * Parameters
 * ----------
 * projectId : string
 *   UUID of the app project.
 *
 * Returns
 * -------
 * string[]
 *   Array of litho model UUIDs.
 */
export async function listLithoModelIds(projectId: string): Promise<string[]> {
  return withClient(async (client) => {
    const res = await client.query<{ id: string }>(
      `SELECT id FROM litho_model WHERE app_project_id = $1`,
      [projectId],
    )
    return res.rows.map((r) => r.id)
  })
}
