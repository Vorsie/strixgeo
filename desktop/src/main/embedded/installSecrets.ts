/**
 * The secrets one packaged install generates for itself, once.
 *
 * Two of them, sharing a lifecycle and therefore a file:
 *
 *  * The **database password**. The dev stack ships
 *    ``groundmodel:groundmodel`` in docker-compose, which is fine for a
 *    container bound to loopback on one developer's box and is not fine on a
 *    shared office machine, where any other local account could open the
 *    cluster and read every project.
 *  * The backend's **SECRET_KEY**. A packaged build runs with
 *    ``ENVIRONMENT=production``, under which the backend refuses to start on
 *    the shipped ``change-me`` default (audit #16) — correctly, since a
 *    constant baked into every copy of a distributed binary is not a secret.
 *
 * Both are generated on first launch and read back on every later one.
 *
 * @module main/embedded/installSecrets
 */

/**
 * The character set generated secrets are drawn from.
 *
 * Deliberately narrow: alphanumerics only. The password travels through a URL
 * (percent-encoded, but belt and braces) and through ``initdb --pwfile``,
 * where a quote or a backslash is the kind of character that works on nine
 * machines and corrupts the tenth. 62 symbols over 32 characters is ~190 bits.
 */
export const SECRET_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** Default generated-secret length, in characters. */
const SECRET_LENGTH = 32

/** The database role the app owns. */
const DATABASE_USER = 'strixgeo'

/** The database the schema lives in. */
const DATABASE_NAME = 'groundmodel'

/** One install's generated secrets. */
export interface InstallSecrets {
  user: string
  password: string
  database: string
  /** Value handed to the backend as ``SECRET_KEY``. */
  secretKey: string
}

/** The single file this module reads and writes. */
export interface SecretsIo {
  /** Return the file's contents, or null when it does not exist. */
  read: () => string | null
  /** Create or replace the file. */
  write: (text: string) => void
}

/** A source of cryptographically random bytes. */
export type RandomBytes = (count: number) => Uint8Array

/**
 * Generate one secret from the safe alphabet.
 *
 * @param randomBytes - Random-byte source. Injected so tests are deterministic;
 *   production passes ``crypto.randomBytes``.
 * @param length - Number of characters. Defaults to {@link SECRET_LENGTH}.
 * @returns The generated secret.
 */
export function generateSecret(
  randomBytes: RandomBytes,
  length: number = SECRET_LENGTH,
): string {
  const bytes = randomBytes(length)
  let secret = ''
  for (let i = 0; i < length; i += 1) {
    secret += SECRET_ALPHABET[bytes[i] % SECRET_ALPHABET.length]
  }
  return secret
}

/**
 * Return this install's secrets, creating them on first launch.
 *
 * @param io - Reader/writer for the secrets file.
 * @param path - The file's absolute path, used in the failure message.
 * @param randomBytes - Random-byte source for a first-launch generation.
 * @returns The stored (or freshly generated and stored) secrets.
 * @throws Error If the file exists but cannot be read. The cluster was
 *   initialised WITH that password and it cannot be re-derived, so generating
 *   a replacement would silently lock the user out of an otherwise intact data
 *   directory. Failing here keeps the recovery — delete the data directory and
 *   reopen the ``.strix`` — a decision someone makes.
 */
export function loadOrCreateSecrets(
  io: SecretsIo,
  path: string,
  randomBytes: RandomBytes,
): InstallSecrets {
  const existing = io.read()
  if (existing !== null) {
    const stored = parseSecrets(existing, path)
    if (stored.secretKey.length > 0) return stored
    // Only the password is unrecoverable — it is baked into the cluster. A
    // missing key is regenerated and written back rather than treated as
    // corruption, because refusing here would make a fully usable data
    // directory unopenable over a secret that nothing has used yet.
    const topped: InstallSecrets = { ...stored, secretKey: generateSecret(randomBytes) }
    io.write(JSON.stringify(topped, null, 2))
    return topped
  }
  const created: InstallSecrets = {
    user: DATABASE_USER,
    password: generateSecret(randomBytes),
    database: DATABASE_NAME,
    secretKey: generateSecret(randomBytes),
  }
  io.write(JSON.stringify(created, null, 2))
  return created
}

/** Parse stored secrets, or throw naming the file. */
function parseSecrets(text: string, path: string): InstallSecrets {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = null
  }
  const record = parsed as Partial<InstallSecrets> | null
  if (!record || typeof record.password !== 'string' || record.password.length === 0) {
    throw new Error(
      `the database credentials file could not be read: ${path}. ` +
        'The database cannot be opened without it.',
    )
  }
  return {
    user: typeof record.user === 'string' ? record.user : DATABASE_USER,
    password: record.password,
    database: typeof record.database === 'string' ? record.database : DATABASE_NAME,
    // Empty string means "absent" to the caller, which tops it up.
    secretKey: typeof record.secretKey === 'string' ? record.secretKey : '',
  }
}
