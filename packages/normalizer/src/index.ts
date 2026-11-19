/**
 * Path normalization for API routes.
 *
 * A request path can carry an account, a contract, a transaction hash, a user ID or a secret.
 * Each path segment is matched against an ordered list of rules and replaced by a placeholder,
 * so what is stored is the shape of the route and never the identifier.
 *
 * Stellar keys are matched by shape (first letter, length, base32 alphabet) and not by checksum,
 * on purpose: a mistyped secret seed must be redacted too.
 */

/** Stellar strkeys are base32 (RFC 4648 alphabet), without padding. */
const B32 = "[A-Z2-7]";

const SECRET_SEED = new RegExp(`(?:^|[^A-Z2-7])S${B32}{55}(?:$|[^A-Z2-7])`);
const MUXED_ACCOUNT = new RegExp(`^M${B32}{68}$`);
const ACCOUNT = new RegExp(`^G${B32}{55}$`);
const CONTRACT = new RegExp(`^C${B32}{55}$`);
// Claimable balance (B), liquidity pool (L), signed payload (P), pre-authorized transaction (T),
// muxed contract (W), hash-x (X). Lengths run from 56 to 165 characters: a signed payload's
// length depends on its payload.
const OTHER_STRKEY = new RegExp(`^[BLPTWX]${B32}{55,164}$`);
const ASSET = new RegExp(`^[A-Za-z0-9]{1,12}[-:]G${B32}{55}$`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_64 = /^[0-9a-f]{64}$/i;
const HEX_PREFIXED = /^0x[0-9a-f]+$/i;
const HEX_LONG = /^(?=.*[a-f])[0-9a-f]{16,}$/i;
const INTEGER = /^\d+$/;
const JWT = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]*)?$/;
// Opaque base64url value: long, with lower case, upper case and digits. A lower-case slug is left alone.
const OPAQUE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z0-9_-]{32,}={0,2}$/;

export const LONG_SEGMENT = 64;

export interface Rule {
  /** Position in the ordered list: the first rule that matches wins. */
  readonly order: number;
  readonly name: string;
  readonly placeholder: string;
  matches(segment: string): boolean;
}

const rule = (order: number, name: string, placeholder: string, matches: (s: string) => boolean): Rule => ({
  order,
  name,
  placeholder,
  matches,
});

/** The ordered rule set. Order matters: a secret seed is checked first, wherever it sits in the segment. */
export const RULES: readonly Rule[] = [
  rule(1, "Stellar secret seed", ":redacted", (s) => SECRET_SEED.test(s)),
  rule(2, "Muxed account", ":muxed", (s) => MUXED_ACCOUNT.test(s)),
  rule(3, "Account", ":account", (s) => ACCOUNT.test(s)),
  rule(4, "Contract", ":contract", (s) => CONTRACT.test(s)),
  rule(5, "Other Stellar key", ":strkey", (s) => OTHER_STRKEY.test(s)),
  rule(6, "Asset (code and issuer)", ":asset", (s) => ASSET.test(s)),
  rule(7, "UUID", ":uuid", (s) => UUID.test(s)),
  rule(8, "64-character hex", ":hash", (s) => HEX_64.test(s)),
  rule(9, "Other hex value", ":hex", (s) => HEX_PREFIXED.test(s) || HEX_LONG.test(s)),
  rule(10, "Integer", ":id", (s) => INTEGER.test(s)),
  rule(11, "Opaque token", ":token", (s) => JWT.test(s) || OPAQUE.test(s)),
  rule(12, "Long segment", ":long", (s) => s.length > LONG_SEGMENT),
];

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Normalizes one path segment: the placeholder of the first matching rule, or the segment unchanged. */
export function normalizeSegment(segment: string): string {
  const decoded = decode(segment);
  for (const r of RULES) {
    if (r.matches(decoded)) return r.placeholder;
  }
  return segment;
}

/**
 * Normalizes a request path or a route. The query string, the fragment and a trailing slash are
 * dropped first. A full URL is reduced to its path. A route already set by the caller
 * (`/accounts/:id`) goes through the same rules, so a raw address is never kept as a route.
 */
export function normalizePath(input: string): string {
  let path = input;
  const scheme = path.indexOf("://");
  if (scheme !== -1) {
    const afterHost = path.indexOf("/", scheme + 3);
    path = afterHost === -1 ? "/" : path.slice(afterHost);
  }
  const cut = path.search(/[?#]/);
  if (cut !== -1) path = path.slice(0, cut);

  const segments = path.split("/").filter((s) => s !== "");
  return "/" + segments.map(normalizeSegment).join("/");
}
