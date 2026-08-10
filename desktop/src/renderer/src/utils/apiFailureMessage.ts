/**
 * The sentence to show when an API call failed.
 *
 * ``post()`` throws ``new Error(detail.detail)`` for any non-2xx, so on a 422 the
 * message IS the domain refusal — the one that names what was refused and where to fix
 * it. Replacing that with a house sentence is how a precise refusal becomes "something
 * went wrong": the owner met exactly that when a contact drag was refused and the app
 * answered "The contact could not be moved — nothing was changed", which told him
 * neither that it was a refusal nor what he had hit.
 *
 * The fallback is for the shapes that carry no message: a network failure, a thrown
 * non-Error, an empty detail.
 *
 * @param err - Whatever the call threw.
 * @param fallback - Sentence to use when the error carries none of its own.
 * @returns The message to put in front of the engineer.
 */
export function apiFailureMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim() !== '') return err.message
  return fallback
}
