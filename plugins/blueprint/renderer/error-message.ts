/**
 * The text of a caught value: an Error's message, or the value itself as
 * text, since `throw` takes any value.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
