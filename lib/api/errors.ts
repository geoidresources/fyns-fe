// Presentation helpers for backend error messages.
//
// Deliberately dependency-free: `client.ts` imports `@/lib/auth`, and the `@/`
// alias does not resolve under `node --test`, so anything that needs unit
// coverage cannot live there.

/**
 * Strip a Go package namespace from the front of a backend error message before
 * showing it to a user. The services wrap sentinel errors in the idiomatic
 * `package: detail` form (e.g. `measurements: invalid compute params`), which is
 * useful in logs and meaningless in a toast.
 *
 * Deliberately conservative: only a single leading `word: ` is removed, and only
 * when the word is a bare lowercase identifier. That leaves alone anything a
 * user would actually want to read — sentences, `EPSG:32756`, `https://…`, and
 * multi-part messages whose first segment carries real meaning.
 */
export function stripErrNamespace(message: string): string {
  return message.replace(/^[a-z][a-z0-9_]*: /, "");
}
