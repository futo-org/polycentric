/**
 * Alias resolution: maps an alias like `user@domain.com` to the polycentric
 * identity it points at, by looking it up at the domain's
 * `/.well-known/polycentric.json`.
 *
 * The server's notification worker has a Rust port of this
 * (`services/server/src/service/notifications/alias_resolver.rs`). Keep the
 * two in sync.
 */

/** Give up on a slow/unresponsive domain rather than hang the resolver. */
const RESOLVE_TIMEOUT_MS = 10_000;

const HEX_CHARS = new Set('0123456789abcdefABCDEF');

/**
 * Whether `s` is a polycentric identity string.
 */
export function isIdentityKey(s: string): boolean {
  return s.length > 0 && Array.from(s).every((c) => HEX_CHARS.has(c));
}

/**
 * The `/.well-known/polycentric.json` document: a map of alias local-parts to
 * the polycentric identity (hex) each points at. A domain may list every alias
 * it serves here; the client looks up the one it queried.
 */
interface AliasDocument {
  names?: Record<string, string>;
}

// Conservative allow-list for an alias's local part — deliberately tighter than
// RFC 7565's `userpart` (which also permits `!$&'()*+,;=` and %-encoding):
// letters, digits, dot, underscore, hyphen.
const LOCAL_CHARS = new Set(
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-',
);

/** A DNS label: 1+ of `[A-Za-z0-9-]`, not starting or ending with a hyphen. */
function isHostLabel(label: string): boolean {
  if (label.length === 0 || label.startsWith('-') || label.endsWith('-')) {
    return false;
  }
  return Array.from(label).every(
    (c) =>
      (c >= 'a' && c <= 'z') ||
      (c >= 'A' && c <= 'Z') ||
      (c >= '0' && c <= '9') ||
      c === '-',
  );
}

/**
 * Parse an alias into its `acct` form and domain. Accepts `user@domain.com`
 * with an optional leading `@`, validated with conservative allow-lists: the
 * local part is limited to letters/digits/`._-`, and the domain must be a
 * dotted hostname (two or more LDH labels). Returns null otherwise.
 */
function parseAlias(
  alias: string,
): { acct: string; local: string; domain: string } | null {
  // Trim, then drop a single optional leading '@' (e.g. "@user@domain.com").
  let acct = alias.trim();
  if (acct.startsWith('@')) {
    acct = acct.slice(1);
  }

  let local: string;
  let domain: string;
  const parts = acct.split('@');
  if (parts.length === 1) {
    // A bare domain (`domain.com`) points at the domain's wildcard entry:
    // the identity listed under `*` in its polycentric.json.
    local = '*';
    domain = parts[0];
  } else if (parts.length === 2) {
    // Lowercase the local part so the query, the names-map lookup, and alias
    // comparison are all case-insensitive on a single canonical form.
    local = parts[0].toLowerCase();
    domain = parts[1];

    // Local part: non-empty, every character in the conservative allow-list.
    if (
      local.length === 0 ||
      !Array.from(local).every((c) => LOCAL_CHARS.has(c))
    ) {
      return null;
    }
  } else {
    return null;
  }

  // Domain: a dotted hostname — two or more non-empty LDH labels.
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every(isHostLabel)) {
    return null;
  }

  return { acct, local, domain };
}

/**
 * Canonicalise an alias for equality comparison: its parsed `acct`
 * (`local@domain`, no leading `@`), lowercased. Returns null when the alias is
 * malformed.
 */
export function normalizeAlias(alias: string): string | null {
  const parsed = parseAlias(alias);
  return parsed ? parsed.acct.toLowerCase() : null;
}

/**
 * Resolve an alias (`user@domain.com`) to a polycentric identity.
 *
 * Returns null when the alias is malformed, the lookup fails (network error,
 * timeout, non-2xx, unparseable body), or the domain's `polycentric.json`
 * carries no entry for the alias.
 */
export async function resolveAlias(alias: string): Promise<string | null> {
  const parsed = parseAlias(alias);
  if (!parsed) {
    return null;
  }

  const url =
    `https://${parsed.domain}/.well-known/polycentric.json` +
    `?alias=${encodeURIComponent(parsed.local)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);

  let doc: AliasDocument;
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      // A 404 here just means the domain doesn't know this alias — expected,
      // not worth a warning.
      return null;
    }
    doc = (await response.json()) as AliasDocument;
  } catch (error) {
    // Network error / timeout / unparseable body: surface for debugging rather
    // than swallowing silently, but still resolve to "not found".
    console.warn(`alias lookup failed for ${parsed.acct}:`, error);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }

  const identity = doc.names?.[parsed.local];
  if (!identity || !isIdentityKey(identity)) {
    return null;
  }

  return identity;
}
